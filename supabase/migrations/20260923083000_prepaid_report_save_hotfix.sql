-- PaiMini hotfix: prepaid issuing + report-rule saving + customer write compatibility.
-- Fixes found in the 2026-09-23 save-flow audit:
-- 1) apply_custom_prepaid_package was SECURITY INVOKER, but wallet hardening intentionally
--    revoked direct writes to prepaid balance / ledgers / benefits. The RPC therefore could
--    no longer issue prepaid packages.
-- 2) user_shop_report_rules was created after Supabase changed new-project Data API defaults
--    and the migration did not explicitly grant table privileges to authenticated.
-- 3) keep the customer write compatibility fix idempotently in this one-shot hotfix.

begin;

-- ---------------------------------------------------------------------------
-- A. Customer profile writes: keep normal profile save paths working while
--    system-owned user_id / prepaid_balance remain protected from browser writes.
-- ---------------------------------------------------------------------------

create or replace function public.protect_customer_system_fields()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.prepaid_balance := 0;
    elsif tg_op = 'UPDATE' then
      new.user_id := old.user_id;
      new.prepaid_balance := old.prepaid_balance;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_customer_system_fields_before_write
on public.customers;

create trigger protect_customer_system_fields_before_write
before insert or update on public.customers
for each row
execute function public.protect_customer_system_fields();

grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.consumption_records to authenticated;
grant select, insert, update, delete on public.report_templates to authenticated;
grant select, insert, update, delete on public.receipt_settings to authenticated;

-- ---------------------------------------------------------------------------
-- B. Report rules: explicitly expose this post-2026 table to authenticated users.
--    RLS still isolates rows by user. Expired accounts may read but may not write.
-- ---------------------------------------------------------------------------

create table if not exists public.user_shop_report_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  team_pct numeric(6,2) not null default 0 check (team_pct >= 0 and team_pct <= 100),
  dispatch_pct numeric(6,2) not null default 0 check (dispatch_pct >= 0 and dispatch_pct <= 100),
  takehome_pct numeric(6,2) not null default 100 check (takehome_pct >= 0 and takehome_pct <= 100),
  auto_takehome boolean not null default true,
  default_source text,
  updated_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

alter table public.user_shop_report_rules enable row level security;

revoke all on public.user_shop_report_rules from anon, authenticated;
grant select, insert, update, delete on public.user_shop_report_rules to authenticated;

drop policy if exists "report_rules_select_own" on public.user_shop_report_rules;
create policy "report_rules_select_own"
on public.user_shop_report_rules
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "report_rules_insert_own" on public.user_shop_report_rules;
create policy "report_rules_insert_own"
on public.user_shop_report_rules
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and public.has_active_access()
  and (
    public.is_shop_owner(shop_id)
    or public.is_shop_member(shop_id)
  )
);

drop policy if exists "report_rules_update_own" on public.user_shop_report_rules;
create policy "report_rules_update_own"
on public.user_shop_report_rules
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and public.has_active_access()
)
with check (
  (select auth.uid()) = user_id
  and public.has_active_access()
  and (
    public.is_shop_owner(shop_id)
    or public.is_shop_member(shop_id)
  )
);

drop policy if exists "report_rules_delete_own" on public.user_shop_report_rules;
create policy "report_rules_delete_own"
on public.user_shop_report_rules
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and public.has_active_access()
);

create index if not exists user_shop_report_rules_shop_idx
  on public.user_shop_report_rules(shop_id);

-- ---------------------------------------------------------------------------
-- C. Editable prepaid issue RPC.
--    This must be SECURITY DEFINER because the browser intentionally has no direct
--    write access to prepaid balances / wallet ledgers / benefit inventory.
--    The function performs its own auth, active-access and ownership checks.
-- ---------------------------------------------------------------------------

create or replace function public.apply_custom_prepaid_package(
  p_customer_id uuid,
  p_preset_id uuid,
  p_amount numeric,
  p_benefits jsonb default '[]'::jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_preset public.wallet_presets%rowtype;
  v_customer public.customers%rowtype;
  v_amount numeric(12,2) := round(greatest(coalesce(p_amount,0),0)::numeric,2);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_item jsonb;
  v_name text;
  v_qty numeric;
  v_unit text;
  v_days integer;
  v_exp timestamptz;
  v_benefit_id uuid;
  v_b_before numeric(12,2);
  v_b_after numeric(12,2);
  v_granted jsonb := '[]'::jsonb;
  v_note text;
  v_issue_id uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not public.has_active_access() then
    raise exception 'account_read_only_expired';
  end if;

  if v_amount <= 0 then
    raise exception 'invalid_prepaid_amount';
  end if;

  if jsonb_typeof(coalesce(p_benefits,'[]'::jsonb)) <> 'array' then
    raise exception 'invalid_benefits_payload';
  end if;

  select * into v_preset
  from public.wallet_presets
  where id = p_preset_id
    and user_id = v_user
    and preset_type = 'prepaid'
    and is_active = true;

  if not found then
    raise exception 'preset_not_found';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
    and user_id = v_user
  for update;

  if not found then
    raise exception 'customer_not_found';
  end if;

  if v_customer.shop_id <> v_preset.shop_id then
    raise exception 'customer_shop_mismatch';
  end if;

  v_before := coalesce(v_customer.prepaid_balance,0);
  v_after := round((v_before + v_amount)::numeric,2);
  v_note := coalesce(nullif(btrim(p_note),''), v_preset.name);

  update public.customers
  set prepaid_balance = v_after
  where id = p_customer_id
    and user_id = v_user;

  insert into public.customer_prepaid_ledger(
    user_id, shop_id, customer_id, kind, delta,
    balance_before, balance_after, related_record_id, note,
    preset_id, package_issue_id
  ) values (
    v_user, v_customer.shop_id, p_customer_id, 'topup', v_amount,
    v_before, v_after, null, v_note,
    v_preset.id, v_issue_id
  );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb))
  loop
    v_name := btrim(coalesce(v_item->>'name',''));
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric,1);
    v_unit := coalesce(nullif(btrim(v_item->>'unit'),''),'个');
    v_days := nullif(v_item->>'expires_days','')::integer;

    if v_name = '' or v_qty <= 0 then
      continue;
    end if;

    v_exp := case
      when v_days is not null and v_days > 0
        then now() + make_interval(days => v_days)
      else null
    end;

    select id, quantity
    into v_benefit_id, v_b_before
    from public.customer_benefits
    where user_id = v_user
      and customer_id = p_customer_id
      and lower(name) = lower(v_name)
    for update;

    if not found then
      v_b_before := 0;
      v_b_after := round(v_qty::numeric,2);

      insert into public.customer_benefits(
        user_id, shop_id, customer_id, name, quantity,
        unit_label, expires_at, note
      ) values (
        v_user, v_customer.shop_id, p_customer_id, v_name, v_b_after,
        v_unit, v_exp, '来自预存套餐：' || v_preset.name
      )
      returning id into v_benefit_id;
    else
      v_b_before := coalesce(v_b_before,0);
      v_b_after := round((v_b_before + v_qty)::numeric,2);

      update public.customer_benefits
      set quantity = v_b_after,
          unit_label = v_unit,
          expires_at = case when v_exp is not null then v_exp else expires_at end,
          note = '来自预存套餐：' || v_preset.name
      where id = v_benefit_id
        and user_id = v_user;
    end if;

    insert into public.customer_benefit_ledger(
      user_id, shop_id, customer_id, benefit_id, benefit_name,
      kind, delta, quantity_before, quantity_after,
      related_record_id, note, preset_id, package_issue_id
    ) values (
      v_user, v_customer.shop_id, p_customer_id, v_benefit_id, v_name,
      'grant', v_qty, v_b_before, v_b_after,
      null, '预存套餐附赠：' || v_preset.name, v_preset.id, v_issue_id
    );

    v_granted := v_granted || jsonb_build_array(
      jsonb_build_object(
        'name',v_name,
        'quantity',v_qty,
        'unit',v_unit,
        'expires_at',v_exp
      )
    );
  end loop;

  return jsonb_build_object(
    'success',true,
    'preset_id',v_preset.id,
    'preset_name',v_preset.name,
    'balance_before',v_before,
    'balance_after',v_after,
    'amount',v_amount,
    'benefits',v_granted,
    'package_issue_id',v_issue_id
  );
end;
$$;

revoke all on function public.apply_custom_prepaid_package(uuid,uuid,numeric,jsonb,text)
from public, anon;

grant execute on function public.apply_custom_prepaid_package(uuid,uuid,numeric,jsonb,text)
to authenticated;

commit;
