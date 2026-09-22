-- 派Mini：老板余额 / 权益档案 + 资金流水加固
-- 目标：
-- 1) 余额、权益只能通过 RPC 变更，任何变更都必须留下流水。
-- 2) 流水表对前端只读，不能直接改写或删除。
-- 3) 预存套餐发放增加 package_issue_id，便于整笔撤销。
-- 4) 支持撤销一笔充值；新套餐充值会同时撤回尚未使用的附赠权益。

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------- 流水关联字段 ----------
alter table public.customer_prepaid_ledger
  add column if not exists package_issue_id uuid;

alter table public.customer_prepaid_ledger
  add column if not exists reversal_of_id uuid
  references public.customer_prepaid_ledger(id) on delete restrict;

alter table public.customer_benefit_ledger
  add column if not exists package_issue_id uuid;

alter table public.customer_benefit_ledger
  add column if not exists reversal_of_id uuid
  references public.customer_benefit_ledger(id) on delete restrict;

create index if not exists prepaid_ledger_package_issue_idx
  on public.customer_prepaid_ledger(user_id,customer_id,package_issue_id,created_at desc);

create index if not exists benefit_ledger_package_issue_idx
  on public.customer_benefit_ledger(user_id,customer_id,package_issue_id,created_at desc);

create unique index if not exists prepaid_ledger_one_reversal_uidx
  on public.customer_prepaid_ledger(reversal_of_id)
  where reversal_of_id is not null;

create unique index if not exists benefit_ledger_one_reversal_uidx
  on public.customer_benefit_ledger(reversal_of_id)
  where reversal_of_id is not null;

-- ---------- 客户端不能静默改余额 ----------
-- customers 仍允许正常建立 / 编辑顾客档案，但 prepaid_balance 不开放直接写入。
revoke insert, update on public.customers from authenticated;
grant insert (shop_id,name,contact,notes,discount_rate)
  on public.customers to authenticated;
grant update (shop_id,name,contact,notes,discount_rate)
  on public.customers to authenticated;

-- ---------- 流水和权益库存：前端只读，变更统一走 RPC ----------
revoke insert, update, delete on public.customer_prepaid_ledger from authenticated;
revoke insert, update, delete on public.customer_benefit_ledger from authenticated;
revoke insert, update, delete on public.customer_benefits from authenticated;

grant select on public.customer_prepaid_ledger to authenticated;
grant select on public.customer_benefit_ledger to authenticated;
grant select on public.customer_benefits to authenticated;

drop policy if exists customer_prepaid_ledger_insert_own on public.customer_prepaid_ledger;
drop policy if exists customer_prepaid_ledger_update_own on public.customer_prepaid_ledger;
drop policy if exists customer_prepaid_ledger_delete_own on public.customer_prepaid_ledger;

drop policy if exists customer_benefit_ledger_insert_own on public.customer_benefit_ledger;
drop policy if exists customer_benefit_ledger_update_own on public.customer_benefit_ledger;
drop policy if exists customer_benefit_ledger_delete_own on public.customer_benefit_ledger;

drop policy if exists customer_benefits_insert_own on public.customer_benefits;
drop policy if exists customer_benefits_update_own on public.customer_benefits;
drop policy if exists customer_benefits_delete_own on public.customer_benefits;

-- ---------- 原子调整预存余额 ----------
create or replace function public.adjust_customer_prepaid(
  p_customer_id uuid,
  p_delta numeric,
  p_kind text default 'adjust',
  p_note text default null,
  p_related_record_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_shop uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_delta numeric(12,2) := round(coalesce(p_delta,0)::numeric,2);
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;
  if p_kind not in ('topup','consume','refund','adjust') then raise exception 'invalid_prepaid_kind'; end if;
  if v_delta = 0 then raise exception 'zero_adjustment'; end if;

  if p_related_record_id is not null and not exists(
    select 1 from public.consumption_records r
    where r.id=p_related_record_id and r.user_id=v_user
  ) then
    raise exception 'record_not_found';
  end if;

  select shop_id, prepaid_balance
  into v_shop, v_before
  from public.customers
  where id=p_customer_id and user_id=v_user
  for update;

  if not found then raise exception 'customer_not_found'; end if;

  v_before := coalesce(v_before,0);
  v_after := round((v_before+v_delta)::numeric,2);
  if v_after < 0 then raise exception 'insufficient_prepaid_balance'; end if;

  update public.customers
  set prepaid_balance=v_after
  where id=p_customer_id and user_id=v_user;

  insert into public.customer_prepaid_ledger(
    user_id,shop_id,customer_id,kind,delta,
    balance_before,balance_after,related_record_id,note
  ) values (
    v_user,v_shop,p_customer_id,p_kind,v_delta,
    v_before,v_after,p_related_record_id,nullif(btrim(coalesce(p_note,'')),'')
  );

  return v_after;
end;
$$;

revoke all on function public.adjust_customer_prepaid(uuid,numeric,text,text,uuid) from public, anon;
grant execute on function public.adjust_customer_prepaid(uuid,numeric,text,text,uuid) to authenticated;

-- ---------- 原子调整权益 ----------
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
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_shop uuid;
  v_benefit uuid;
  v_before numeric(12,2) := 0;
  v_after numeric(12,2);
  v_name text := btrim(coalesce(p_name,''));
  v_delta numeric(12,2) := round(coalesce(p_delta,0)::numeric,2);
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;
  if v_name='' then raise exception 'benefit_name_required'; end if;
  if v_delta=0 then raise exception 'zero_adjustment'; end if;
  if p_kind not in ('grant','consume','return','adjust') then raise exception 'invalid_benefit_kind'; end if;

  if p_related_record_id is not null and not exists(
    select 1 from public.consumption_records r
    where r.id=p_related_record_id and r.user_id=v_user
  ) then
    raise exception 'record_not_found';
  end if;

  select shop_id into v_shop
  from public.customers
  where id=p_customer_id and user_id=v_user;
  if not found then raise exception 'customer_not_found'; end if;

  select id,quantity into v_benefit,v_before
  from public.customer_benefits
  where user_id=v_user
    and customer_id=p_customer_id
    and lower(name)=lower(v_name)
  for update;

  if not found then
    v_before := 0;
    v_after := round(v_delta::numeric,2);
    if v_after < 0 then raise exception 'insufficient_benefit_quantity'; end if;

    insert into public.customer_benefits(
      user_id,shop_id,customer_id,name,quantity,unit_label,expires_at,note
    ) values (
      v_user,v_shop,p_customer_id,v_name,v_after,
      coalesce(nullif(btrim(p_unit_label),''),'个'),p_expires_at,
      nullif(btrim(coalesce(p_note,'')),'')
    ) returning id into v_benefit;
  else
    v_before := coalesce(v_before,0);
    v_after := round((v_before+v_delta)::numeric,2);
    if v_after < 0 then raise exception 'insufficient_benefit_quantity'; end if;

    update public.customer_benefits
    set quantity=v_after,
        unit_label=coalesce(nullif(btrim(p_unit_label),''),unit_label),
        expires_at=coalesce(p_expires_at,expires_at),
        note=coalesce(nullif(btrim(coalesce(p_note,'')),''),note)
    where id=v_benefit and user_id=v_user;
  end if;

  insert into public.customer_benefit_ledger(
    user_id,shop_id,customer_id,benefit_id,benefit_name,
    kind,delta,quantity_before,quantity_after,related_record_id,note
  ) values (
    v_user,v_shop,p_customer_id,v_benefit,v_name,
    p_kind,v_delta,v_before,v_after,p_related_record_id,
    nullif(btrim(coalesce(p_note,'')),'')
  );

  return v_after;
end;
$$;

revoke all on function public.adjust_customer_benefit(uuid,text,numeric,text,text,timestamptz,text,uuid) from public, anon;
grant execute on function public.adjust_customer_benefit(uuid,text,numeric,text,text,timestamptz,text,uuid) to authenticated;

-- ---------- 预存套餐：用安全函数写余额 / 权益，并给同一批发放打 issue id ----------
create or replace function public.apply_prepaid_package(
  p_customer_id uuid,
  p_preset_id uuid
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
  v_issue_id uuid := gen_random_uuid();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  select * into v_preset
  from public.wallet_presets
  where id=p_preset_id and user_id=v_user and is_active=true;
  if not found then raise exception 'preset_not_found'; end if;
  if v_preset.preset_type<>'prepaid' then raise exception 'preset_not_prepaid'; end if;
  if coalesce(v_preset.amount,0)<=0 then raise exception 'invalid_prepaid_amount'; end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id and user_id=v_user
  for update;
  if not found then raise exception 'customer_not_found'; end if;
  if v_customer.shop_id<>v_preset.shop_id then raise exception 'customer_shop_mismatch'; end if;

  v_before := coalesce(v_customer.prepaid_balance,0);
  v_after := round((v_before+v_preset.amount)::numeric,2);

  update public.customers
  set prepaid_balance=v_after
  where id=p_customer_id and user_id=v_user;

  insert into public.customer_prepaid_ledger(
    user_id,shop_id,customer_id,kind,delta,
    balance_before,balance_after,related_record_id,note,preset_id,package_issue_id
  ) values (
    v_user,v_customer.shop_id,p_customer_id,'topup',v_preset.amount,
    v_before,v_after,null,v_preset.name,v_preset.id,v_issue_id
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(v_preset.bundled_benefits,'[]'::jsonb))
  loop
    v_name := btrim(coalesce(v_item->>'name',''));
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric,1);
    v_unit := coalesce(nullif(btrim(v_item->>'unit'),''),'个');
    v_days := nullif(v_item->>'expires_days','')::integer;

    if v_name='' or v_qty<=0 then continue; end if;

    v_exp := case
      when v_days is not null and v_days>0 then now()+make_interval(days=>v_days)
      else null
    end;

    select id,quantity into v_benefit_id,v_b_before
    from public.customer_benefits
    where user_id=v_user
      and customer_id=p_customer_id
      and lower(name)=lower(v_name)
    for update;

    if not found then
      v_b_before := 0;
      v_b_after := round(v_qty::numeric,2);
      insert into public.customer_benefits(
        user_id,shop_id,customer_id,name,quantity,unit_label,expires_at,note
      ) values (
        v_user,v_customer.shop_id,p_customer_id,v_name,v_b_after,v_unit,v_exp,
        '来自预存套餐：'||v_preset.name
      ) returning id into v_benefit_id;
    else
      v_b_before := coalesce(v_b_before,0);
      v_b_after := round((v_b_before+v_qty)::numeric,2);
      update public.customer_benefits
      set quantity=v_b_after,
          unit_label=v_unit,
          expires_at=case when v_exp is not null then v_exp else expires_at end,
          note='来自预存套餐：'||v_preset.name
      where id=v_benefit_id and user_id=v_user;
    end if;

    insert into public.customer_benefit_ledger(
      user_id,shop_id,customer_id,benefit_id,benefit_name,
      kind,delta,quantity_before,quantity_after,related_record_id,note,preset_id,package_issue_id
    ) values (
      v_user,v_customer.shop_id,p_customer_id,v_benefit_id,v_name,
      'grant',v_qty,v_b_before,v_b_after,null,
      '预存套餐附赠：'||v_preset.name,v_preset.id,v_issue_id
    );

    v_granted := v_granted || jsonb_build_array(jsonb_build_object(
      'name',v_name,'quantity',v_qty,'unit',v_unit,'expires_at',v_exp
    ));
  end loop;

  return jsonb_build_object(
    'balance_before',v_before,
    'balance_after',v_after,
    'amount',v_preset.amount,
    'benefits',v_granted,
    'package_issue_id',v_issue_id
  );
end;
$$;

revoke all on function public.apply_prepaid_package(uuid,uuid) from public, anon;
grant execute on function public.apply_prepaid_package(uuid,uuid) to authenticated;

-- ---------- 撤销一笔充值 ----------
-- 新版预存套餐会连同尚未使用的附赠权益一起撤回。
-- 若赠送权益已经被使用，整笔撤销会拒绝，避免出现负权益或半撤销。
create or replace function public.reverse_prepaid_topup(
  p_ledger_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_original public.customer_prepaid_ledger%rowtype;
  v_customer public.customers%rowtype;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_reverse_issue uuid := gen_random_uuid();
  v_b record;
  v_stock public.customer_benefits%rowtype;
  v_b_after numeric(12,2);
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  select * into v_original
  from public.customer_prepaid_ledger
  where id=p_ledger_id and user_id=v_user
  for update;

  if not found then raise exception 'ledger_not_found'; end if;
  if v_original.kind<>'topup' or v_original.delta<=0 then raise exception 'only_topup_can_reverse'; end if;

  if exists(
    select 1 from public.customer_prepaid_ledger r
    where r.reversal_of_id=v_original.id
  ) then
    raise exception 'already_reversed';
  end if;

  -- 旧版套餐流水没有 package_issue_id，无法可靠定位同批赠送权益。
  if v_original.preset_id is not null and v_original.package_issue_id is null then
    raise exception 'legacy_package_requires_manual_adjustment';
  end if;

  select * into v_customer
  from public.customers
  where id=v_original.customer_id and user_id=v_user
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  v_before := coalesce(v_customer.prepaid_balance,0);
  v_after := round((v_before-v_original.delta)::numeric,2);
  if v_after<0 then raise exception 'insufficient_prepaid_balance_for_reversal'; end if;

  -- 先检查套餐赠送权益是否仍足够撤回。
  if v_original.package_issue_id is not null then
    for v_b in
      select bl.*
      from public.customer_benefit_ledger bl
      where bl.user_id=v_user
        and bl.customer_id=v_original.customer_id
        and bl.package_issue_id=v_original.package_issue_id
        and bl.kind='grant'
        and bl.delta>0
      order by bl.created_at,bl.id
    loop
      select * into v_stock
      from public.customer_benefits cb
      where cb.id=v_b.benefit_id and cb.user_id=v_user
      for update;

      if not found or coalesce(v_stock.quantity,0)<v_b.delta then
        raise exception 'package_benefit_already_used:%',v_b.benefit_name;
      end if;
    end loop;
  end if;

  update public.customers
  set prepaid_balance=v_after
  where id=v_customer.id and user_id=v_user;

  insert into public.customer_prepaid_ledger(
    user_id,shop_id,customer_id,kind,delta,
    balance_before,balance_after,related_record_id,note,preset_id,
    package_issue_id,reversal_of_id
  ) values (
    v_user,v_original.shop_id,v_original.customer_id,'refund',-v_original.delta,
    v_before,v_after,null,
    coalesce(nullif(btrim(coalesce(p_note,'')),''),'撤销充值：'||coalesce(v_original.note,'未备注')),
    v_original.preset_id,v_reverse_issue,v_original.id
  );

  -- 撤回同批套餐赠送权益。
  if v_original.package_issue_id is not null then
    for v_b in
      select bl.*
      from public.customer_benefit_ledger bl
      where bl.user_id=v_user
        and bl.customer_id=v_original.customer_id
        and bl.package_issue_id=v_original.package_issue_id
        and bl.kind='grant'
        and bl.delta>0
      order by bl.created_at,bl.id
    loop
      select * into v_stock
      from public.customer_benefits cb
      where cb.id=v_b.benefit_id and cb.user_id=v_user
      for update;

      v_b_after := round((coalesce(v_stock.quantity,0)-v_b.delta)::numeric,2);

      update public.customer_benefits
      set quantity=v_b_after,
          note='撤销预存套餐赠送'
      where id=v_stock.id and user_id=v_user;

      insert into public.customer_benefit_ledger(
        user_id,shop_id,customer_id,benefit_id,benefit_name,
        kind,delta,quantity_before,quantity_after,related_record_id,note,preset_id,
        package_issue_id,reversal_of_id
      ) values (
        v_user,v_b.shop_id,v_b.customer_id,v_b.benefit_id,v_b.benefit_name,
        'return',-v_b.delta,v_stock.quantity,v_b_after,null,
        '撤销预存套餐赠送',v_b.preset_id,v_reverse_issue,v_b.id
      );
    end loop;
  end if;

  return jsonb_build_object(
    'success',true,
    'balance_before',v_before,
    'balance_after',v_after,
    'reversed_amount',v_original.delta,
    'reversal_issue_id',v_reverse_issue
  );
end;
$$;

revoke all on function public.reverse_prepaid_topup(uuid,text) from public, anon;
grant execute on function public.reverse_prepaid_topup(uuid,text) to authenticated;

commit;
