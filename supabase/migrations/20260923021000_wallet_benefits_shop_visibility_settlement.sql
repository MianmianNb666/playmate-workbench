-- 派Mini：店铺公开/私密 + 老板预存/权益 + 报备结算变量
-- 2026-09-23
-- 设计原则：
-- 1) 私密店铺仅创建者可见；公开店铺沿用现有共享价目表逻辑。
-- 2) 预存余额有流水，禁止只改余额不留痕；提供原子 RPC 调整余额。
-- 3) 权益支持自定义名称/数量/单位/有效期，并有增减流水。
-- 4) 预存/权益模板可保存后在价格表界面一键发放给老板。
-- 5) 团抽/派抽/到手默认百分比保存到报备设置；单笔订单可保存快照。

-- ---------- 店铺公开 / 私密 ----------
alter table public.shops
  add column if not exists visibility text not null default 'public';

alter table public.shops
  drop constraint if exists shops_visibility_check;
alter table public.shops
  add constraint shops_visibility_check
  check (visibility in ('public','private'));

-- 私密店铺只有店主本人可见；公开且启用的店铺可被其他登录用户看到。
drop policy if exists shops_select_authenticated on public.shops;
drop policy if exists shops_select_own on public.shops;
create policy shops_select_authenticated
on public.shops for select to authenticated
using (
  user_id = (select auth.uid())
  or (is_active = true and visibility = 'public')
);

-- 分类和价格项目必须同时满足店铺公开，避免私密店铺价目表被旁路读取。
drop policy if exists price_categories_select_authenticated on public.price_categories;
drop policy if exists price_categories_select_own on public.price_categories;
create policy price_categories_select_authenticated
on public.price_categories for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1 from public.shops s
      where s.id = price_categories.shop_id
        and s.is_active = true
        and s.visibility = 'public'
    )
  )
);

drop policy if exists price_items_select_authenticated on public.price_items;
drop policy if exists price_items_select_own on public.price_items;
create policy price_items_select_authenticated
on public.price_items for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1 from public.shops s
      where s.id = price_items.shop_id
        and s.is_active = true
        and s.visibility = 'public'
    )
  )
);

-- ---------- 老板预存余额 ----------
alter table public.customers
  add column if not exists prepaid_balance numeric(12,2) not null default 0;

create table if not exists public.customer_prepaid_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind text not null default 'adjust',
  delta numeric(12,2) not null,
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  related_record_id uuid references public.consumption_records(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.customer_prepaid_ledger
  drop constraint if exists customer_prepaid_ledger_kind_check;
alter table public.customer_prepaid_ledger
  add constraint customer_prepaid_ledger_kind_check
  check (kind in ('topup','consume','refund','adjust'));

create index if not exists customer_prepaid_ledger_lookup_idx
  on public.customer_prepaid_ledger(user_id, customer_id, created_at desc);

alter table public.customer_prepaid_ledger enable row level security;
drop policy if exists customer_prepaid_ledger_select_own on public.customer_prepaid_ledger;
drop policy if exists customer_prepaid_ledger_insert_own on public.customer_prepaid_ledger;
drop policy if exists customer_prepaid_ledger_update_own on public.customer_prepaid_ledger;
drop policy if exists customer_prepaid_ledger_delete_own on public.customer_prepaid_ledger;
create policy customer_prepaid_ledger_select_own
on public.customer_prepaid_ledger for select to authenticated
using ((select auth.uid()) = user_id);
create policy customer_prepaid_ledger_insert_own
on public.customer_prepaid_ledger for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy customer_prepaid_ledger_update_own
on public.customer_prepaid_ledger for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy customer_prepaid_ledger_delete_own
on public.customer_prepaid_ledger for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.customer_prepaid_ledger to authenticated;

-- 原子调整余额并生成流水。前端以后只调用这个 RPC，不直接静默改 prepaid_balance。
create or replace function public.adjust_customer_prepaid(
  p_customer_id uuid,
  p_delta numeric,
  p_kind text default 'adjust',
  p_note text default null,
  p_related_record_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_shop uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind not in ('topup','consume','refund','adjust') then
    raise exception 'invalid_prepaid_kind';
  end if;

  select shop_id, prepaid_balance
    into v_shop, v_before
  from public.customers
  where id = p_customer_id and user_id = v_user
  for update;

  if not found then
    raise exception 'customer_not_found';
  end if;

  v_before := coalesce(v_before,0);
  v_after := round((v_before + coalesce(p_delta,0))::numeric,2);
  if v_after < 0 then
    raise exception 'insufficient_prepaid_balance';
  end if;

  update public.customers
  set prepaid_balance = v_after
  where id = p_customer_id and user_id = v_user;

  insert into public.customer_prepaid_ledger(
    user_id, shop_id, customer_id, kind, delta,
    balance_before, balance_after, related_record_id, note
  ) values (
    v_user, v_shop, p_customer_id, p_kind, round(coalesce(p_delta,0)::numeric,2),
    v_before, v_after, p_related_record_id, p_note
  );

  return v_after;
end;
$$;

grant execute on function public.adjust_customer_prepaid(uuid,numeric,text,text,uuid) to authenticated;

-- ---------- 老板权益 ----------
create table if not exists public.customer_benefits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  quantity numeric(12,2) not null default 0,
  unit_label text not null default '个',
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_benefit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  benefit_id uuid references public.customer_benefits(id) on delete set null,
  benefit_name text not null,
  kind text not null default 'adjust',
  delta numeric(12,2) not null,
  quantity_before numeric(12,2) not null,
  quantity_after numeric(12,2) not null,
  related_record_id uuid references public.consumption_records(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.customer_benefit_ledger
  drop constraint if exists customer_benefit_ledger_kind_check;
alter table public.customer_benefit_ledger
  add constraint customer_benefit_ledger_kind_check
  check (kind in ('grant','consume','return','adjust'));

create unique index if not exists customer_benefits_name_uidx
  on public.customer_benefits(user_id, customer_id, lower(name));
create index if not exists customer_benefits_lookup_idx
  on public.customer_benefits(user_id, customer_id, updated_at desc);
create index if not exists customer_benefit_ledger_lookup_idx
  on public.customer_benefit_ledger(user_id, customer_id, created_at desc);

drop trigger if exists customer_benefits_set_updated_at on public.customer_benefits;
create trigger customer_benefits_set_updated_at
before update on public.customer_benefits
for each row execute function public.set_updated_at();

alter table public.customer_benefits enable row level security;
alter table public.customer_benefit_ledger enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customer_benefits','customer_benefit_ledger']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end $$;

grant select, insert, update, delete on public.customer_benefits, public.customer_benefit_ledger to authenticated;

create or replace function public.adjust_customer_benefit(
  p_customer_id uuid,
  p_name text,
  p_delta numeric,
  p_kind text default 'adjust',
  p_unit_label text default '个',
  p_expires_at timestamptz default null,
  p_note text default null,
  p_related_record_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_shop uuid;
  v_benefit uuid;
  v_before numeric(12,2) := 0;
  v_after numeric(12,2);
  v_name text := btrim(coalesce(p_name,''));
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if v_name = '' then raise exception 'benefit_name_required'; end if;
  if p_kind not in ('grant','consume','return','adjust') then raise exception 'invalid_benefit_kind'; end if;

  select shop_id into v_shop
  from public.customers
  where id = p_customer_id and user_id = v_user;
  if not found then raise exception 'customer_not_found'; end if;

  select id, quantity into v_benefit, v_before
  from public.customer_benefits
  where user_id = v_user and customer_id = p_customer_id and lower(name) = lower(v_name)
  for update;

  if not found then
    v_before := 0;
    v_after := round(coalesce(p_delta,0)::numeric,2);
    if v_after < 0 then raise exception 'insufficient_benefit_quantity'; end if;
    insert into public.customer_benefits(
      user_id, shop_id, customer_id, name, quantity, unit_label, expires_at, note
    ) values (
      v_user, v_shop, p_customer_id, v_name, v_after,
      coalesce(nullif(btrim(p_unit_label),''),'个'), p_expires_at, p_note
    ) returning id into v_benefit;
  else
    v_before := coalesce(v_before,0);
    v_after := round((v_before + coalesce(p_delta,0))::numeric,2);
    if v_after < 0 then raise exception 'insufficient_benefit_quantity'; end if;
    update public.customer_benefits
    set quantity = v_after,
        unit_label = coalesce(nullif(btrim(p_unit_label),''), unit_label),
        expires_at = coalesce(p_expires_at, expires_at),
        note = coalesce(p_note, note)
    where id = v_benefit and user_id = v_user;
  end if;

  insert into public.customer_benefit_ledger(
    user_id, shop_id, customer_id, benefit_id, benefit_name,
    kind, delta, quantity_before, quantity_after, related_record_id, note
  ) values (
    v_user, v_shop, p_customer_id, v_benefit, v_name,
    p_kind, round(coalesce(p_delta,0)::numeric,2), v_before, v_after,
    p_related_record_id, p_note
  );

  return v_after;
end;
$$;

grant execute on function public.adjust_customer_benefit(uuid,text,numeric,text,text,timestamptz,text,uuid) to authenticated;

-- ---------- 预存 / 权益快捷模板 ----------
create table if not exists public.wallet_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  preset_type text not null,
  name text not null,
  amount numeric(12,2),
  benefit_name text,
  benefit_quantity numeric(12,2),
  benefit_unit text,
  expires_days integer,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallet_presets
  drop constraint if exists wallet_presets_type_check;
alter table public.wallet_presets
  add constraint wallet_presets_type_check
  check (preset_type in ('prepaid','benefit'));

create index if not exists wallet_presets_lookup_idx
  on public.wallet_presets(user_id, shop_id, is_active, sort_order, created_at);

drop trigger if exists wallet_presets_set_updated_at on public.wallet_presets;
create trigger wallet_presets_set_updated_at
before update on public.wallet_presets
for each row execute function public.set_updated_at();

alter table public.wallet_presets enable row level security;
drop policy if exists wallet_presets_select_own on public.wallet_presets;
drop policy if exists wallet_presets_insert_own on public.wallet_presets;
drop policy if exists wallet_presets_update_own on public.wallet_presets;
drop policy if exists wallet_presets_delete_own on public.wallet_presets;
create policy wallet_presets_select_own on public.wallet_presets for select to authenticated using ((select auth.uid()) = user_id);
create policy wallet_presets_insert_own on public.wallet_presets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy wallet_presets_update_own on public.wallet_presets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy wallet_presets_delete_own on public.wallet_presets for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.wallet_presets to authenticated;

-- ---------- 报备结算默认比例 ----------
alter table public.report_templates add column if not exists group_rate numeric(6,3) not null default 0;
alter table public.report_templates add column if not exists dispatch_rate numeric(6,3) not null default 0;
alter table public.report_templates add column if not exists takehome_rate numeric(6,3) not null default 100;
alter table public.report_templates add column if not exists takehome_auto boolean not null default true;

alter table public.report_templates
  drop constraint if exists report_templates_group_rate_check;
alter table public.report_templates
  add constraint report_templates_group_rate_check check (group_rate between 0 and 100);
alter table public.report_templates
  drop constraint if exists report_templates_dispatch_rate_check;
alter table public.report_templates
  add constraint report_templates_dispatch_rate_check check (dispatch_rate between 0 and 100);
alter table public.report_templates
  drop constraint if exists report_templates_takehome_rate_check;
alter table public.report_templates
  add constraint report_templates_takehome_rate_check check (takehome_rate between 0 and 100);

-- ---------- 单笔订单结算 / 预存 / 权益快照 ----------
alter table public.consumption_records add column if not exists group_rate numeric(6,3);
alter table public.consumption_records add column if not exists group_amount numeric(12,2);
alter table public.consumption_records add column if not exists dispatch_rate numeric(6,3);
alter table public.consumption_records add column if not exists dispatch_amount numeric(12,2);
alter table public.consumption_records add column if not exists takehome_rate numeric(6,3);
alter table public.consumption_records add column if not exists takehome_amount numeric(12,2);
alter table public.consumption_records add column if not exists source_text text;
alter table public.consumption_records add column if not exists prepaid_used numeric(12,2) not null default 0;
alter table public.consumption_records add column if not exists prepaid_balance_after numeric(12,2);
alter table public.consumption_records add column if not exists benefits_used jsonb not null default '[]'::jsonb;
alter table public.consumption_records add column if not exists benefits_granted jsonb not null default '[]'::jsonb;

-- 小票显示开关。
alter table public.receipt_settings add column if not exists show_settlement boolean not null default true;
alter table public.receipt_settings add column if not exists show_prepaid boolean not null default true;
alter table public.receipt_settings add column if not exists show_benefits boolean not null default true;
alter table public.receipt_settings add column if not exists show_source boolean not null default true;
