begin;

-- PaiMini：预存套餐赠送余额与整笔撤回统一关联。
-- 新发放的实充、赠送余额、赠送权益共用 package_issue_id。
-- 撤回严格按实际到账流水回收；任一资产已被消费则整笔拒绝。

create or replace function public.apply_custom_prepaid_package_with_gift(
  p_customer_id uuid,
  p_preset_id uuid,
  p_amount numeric,
  p_benefits jsonb default '[]'::jsonb,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth,extensions
as $$
declare
  v_user uuid:=auth.uid();
  v_gift numeric(12,2):=0;
  v_base jsonb;
  v_issue uuid;
  v_customer public.customers%rowtype;
  v_gift_before numeric(12,2):=0;
  v_gift_after numeric(12,2):=0;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  select coalesce(sum(case
    when coalesce(value->>'type','')='balance'
      or btrim(coalesce(value->>'name',''))='赠送余额'
      or (btrim(coalesce(value->>'unit',''))='元' and btrim(coalesce(value->>'name','')) like '%余额%')
    then greatest(coalesce(nullif(value->>'quantity','')::numeric,0),0)
    else 0 end),0)
  into v_gift
  from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb));

  v_base:=public.apply_custom_prepaid_package(
    p_customer_id,p_preset_id,p_amount,
    coalesce((
      select jsonb_agg(value)
      from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb))
      where not (
        coalesce(value->>'type','')='balance'
        or btrim(coalesce(value->>'name',''))='赠送余额'
        or (btrim(coalesce(value->>'unit',''))='元' and btrim(coalesce(value->>'name','')) like '%余额%')
      )
    ),'[]'::jsonb),
    p_note
  );

  v_issue:=nullif(v_base->>'package_issue_id','')::uuid;

  if v_gift>0 then
    select * into v_customer
    from public.customers
    where id=p_customer_id and user_id=v_user
    for update;
    if not found then raise exception 'customer_not_found'; end if;

    v_gift_before:=coalesce(v_customer.gift_balance,0);
    v_gift_after:=round(v_gift_before+v_gift,2);

    update public.customers set gift_balance=v_gift_after
    where id=p_customer_id and user_id=v_user;

    insert into public.customer_prepaid_ledger(
      user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,
      related_record_id,note,preset_id,package_issue_id,balance_type
    ) values (
      v_user,v_customer.shop_id,p_customer_id,'topup',v_gift,v_gift_before,v_gift_after,
      null,coalesce(nullif(btrim(p_note),''),'预存套餐附赠余额'),
      p_preset_id,v_issue,'gift'
    );
  end if;

  return v_base || jsonb_build_object(
    'gift_amount',v_gift,
    'gift_result',case when v_gift>0 then jsonb_build_object('balance_after',v_gift_after) else null end
  );
end;
$$;

revoke all on function public.apply_custom_prepaid_package_with_gift(uuid,uuid,numeric,jsonb,text) from public,anon;
grant execute on function public.apply_custom_prepaid_package_with_gift(uuid,uuid,numeric,jsonb,text) to authenticated;

create or replace function public.reverse_prepaid_topup(
  p_ledger_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,extensions
as $$
declare
  v_user uuid:=auth.uid();
  v_original public.customer_prepaid_ledger%rowtype;
  v_customer public.customers%rowtype;
  v_issue uuid;
  v_reverse_issue uuid:=gen_random_uuid();
  v_paid numeric(12,2):=0;
  v_gift numeric(12,2):=0;
  v_paid_before numeric(12,2):=0;
  v_paid_after numeric(12,2):=0;
  v_gift_before numeric(12,2):=0;
  v_gift_after numeric(12,2):=0;
  v_g record;
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
  if coalesce(v_original.balance_type,'paid')='gift' then raise exception 'reverse_from_paid_topup'; end if;

  if exists(select 1 from public.customer_prepaid_ledger r where r.reversal_of_id=v_original.id) then
    raise exception 'already_reversed';
  end if;

  if v_original.preset_id is not null and v_original.package_issue_id is null then
    raise exception 'legacy_package_requires_manual_adjustment';
  end if;

  v_issue:=v_original.package_issue_id;
  v_paid:=round(v_original.delta,2);

  if v_issue is not null then
    select coalesce(sum(l.delta),0) into v_gift
    from public.customer_prepaid_ledger l
    where l.user_id=v_user
      and l.customer_id=v_original.customer_id
      and l.package_issue_id=v_issue
      and l.kind='topup' and l.delta>0
      and coalesce(l.balance_type,'paid')='gift'
      and not exists(select 1 from public.customer_prepaid_ledger rr where rr.reversal_of_id=l.id);
  end if;

  select * into v_customer
  from public.customers
  where id=v_original.customer_id and user_id=v_user
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  v_paid_before:=coalesce(v_customer.prepaid_balance,0);
  v_gift_before:=coalesce(v_customer.gift_balance,0);
  if v_paid_before<v_paid then raise exception 'insufficient_prepaid_balance_for_reversal'; end if;
  if v_gift_before<v_gift then raise exception 'insufficient_gift_balance_for_reversal'; end if;

  if v_issue is not null then
    for v_b in
      select bl.* from public.customer_benefit_ledger bl
      where bl.user_id=v_user and bl.customer_id=v_original.customer_id
        and bl.package_issue_id=v_issue and bl.kind='grant' and bl.delta>0
        and not exists(select 1 from public.customer_benefit_ledger rr where rr.reversal_of_id=bl.id)
      order by bl.created_at,bl.id
    loop
      select * into v_stock from public.customer_benefits cb
      where cb.id=v_b.benefit_id and cb.user_id=v_user for update;
      if not found or coalesce(v_stock.quantity,0)<v_b.delta then
        raise exception 'package_benefit_already_used:%',v_b.benefit_name;
      end if;
    end loop;
  end if;

  v_paid_after:=round(v_paid_before-v_paid,2);
  v_gift_after:=round(v_gift_before-v_gift,2);
  update public.customers
  set prepaid_balance=v_paid_after,gift_balance=v_gift_after
  where id=v_customer.id and user_id=v_user;

  insert into public.customer_prepaid_ledger(
    user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,
    related_record_id,note,preset_id,package_issue_id,reversal_of_id,balance_type
  ) values (
    v_user,v_original.shop_id,v_original.customer_id,'refund',-v_paid,
    v_paid_before,v_paid_after,null,
    coalesce(nullif(btrim(coalesce(p_note,'')),''),'撤回预存：'||coalesce(v_original.note,'未备注')),
    v_original.preset_id,v_reverse_issue,v_original.id,'paid'
  );

  if v_issue is not null then
    for v_g in
      select l.* from public.customer_prepaid_ledger l
      where l.user_id=v_user and l.customer_id=v_original.customer_id
        and l.package_issue_id=v_issue and l.kind='topup' and l.delta>0
        and coalesce(l.balance_type,'paid')='gift'
        and not exists(select 1 from public.customer_prepaid_ledger rr where rr.reversal_of_id=l.id)
      order by l.created_at,l.id
    loop
      insert into public.customer_prepaid_ledger(
        user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,
        related_record_id,note,preset_id,package_issue_id,reversal_of_id,balance_type
      ) values (
        v_user,v_g.shop_id,v_g.customer_id,'refund',-v_g.delta,
        v_gift_before,v_gift_after,null,'撤回预存套餐赠送余额',
        v_g.preset_id,v_reverse_issue,v_g.id,'gift'
      );
    end loop;

    for v_b in
      select bl.* from public.customer_benefit_ledger bl
      where bl.user_id=v_user and bl.customer_id=v_original.customer_id
        and bl.package_issue_id=v_issue and bl.kind='grant' and bl.delta>0
        and not exists(select 1 from public.customer_benefit_ledger rr where rr.reversal_of_id=bl.id)
      order by bl.created_at,bl.id
    loop
      select * into v_stock from public.customer_benefits cb
      where cb.id=v_b.benefit_id and cb.user_id=v_user for update;
      v_b_after:=round(coalesce(v_stock.quantity,0)-v_b.delta,2);

      update public.customer_benefits
      set quantity=v_b_after,note='撤回预存套餐赠送'
      where id=v_stock.id and user_id=v_user;

      insert into public.customer_benefit_ledger(
        user_id,shop_id,customer_id,benefit_id,benefit_name,kind,delta,
        quantity_before,quantity_after,related_record_id,note,preset_id,
        package_issue_id,reversal_of_id
      ) values (
        v_user,v_b.shop_id,v_b.customer_id,v_b.benefit_id,v_b.benefit_name,
        'return',-v_b.delta,v_stock.quantity,v_b_after,null,
        '撤回预存套餐赠送',v_b.preset_id,v_reverse_issue,v_b.id
      );
    end loop;
  end if;

  return jsonb_build_object(
    'success',true,
    'paid_reversed',v_paid,
    'gift_reversed',v_gift,
    'paid_balance_after',v_paid_after,
    'gift_balance_after',v_gift_after,
    'prepaid_balance_after',v_paid_after+v_gift_after,
    'reversal_issue_id',v_reverse_issue
  );
end;
$$;

revoke all on function public.reverse_prepaid_topup(uuid,text) from public,anon;
grant execute on function public.reverse_prepaid_topup(uuid,text) to authenticated;

commit;
