-- PaiMini 赠送余额 + 删除订单原路退回
-- 基于 stable-20260924-v16 后续主线。旧实充余额 prepaid_balance 保持原语义。

begin;

alter table public.customers
  add column if not exists gift_balance numeric(12,2) not null default 0;

alter table public.customer_prepaid_ledger
  add column if not exists balance_type text not null default 'paid';

alter table public.customer_prepaid_ledger
  drop constraint if exists customer_prepaid_ledger_balance_type_check;
alter table public.customer_prepaid_ledger
  add constraint customer_prepaid_ledger_balance_type_check
  check (balance_type in ('paid','gift'));

alter table public.consumption_records
  add column if not exists prepaid_paid_used numeric(12,2) not null default 0;
alter table public.consumption_records
  add column if not exists gift_balance_used numeric(12,2) not null default 0;

-- 单独调整赠送余额，并留下赠送余额流水。
create or replace function public.adjust_customer_gift_balance(
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
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('topup','consume','refund','adjust') then raise exception 'invalid_prepaid_kind'; end if;

  select shop_id, coalesce(gift_balance,0)
  into v_shop, v_before
  from public.customers
  where id=p_customer_id and user_id=v_user
  for update;

  if not found then raise exception 'customer_not_found'; end if;

  v_after := round((v_before + coalesce(p_delta,0))::numeric,2);
  if v_after < 0 then raise exception 'insufficient_gift_balance'; end if;

  update public.customers
  set gift_balance=v_after
  where id=p_customer_id and user_id=v_user;

  insert into public.customer_prepaid_ledger(
    user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,
    related_record_id,note,balance_type
  ) values (
    v_user,v_shop,p_customer_id,p_kind,round(coalesce(p_delta,0)::numeric,2),
    v_before,v_after,p_related_record_id,p_note,'gift'
  );

  return v_after;
end;
$$;

revoke all on function public.adjust_customer_gift_balance(uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.adjust_customer_gift_balance(uuid,numeric,text,text,uuid) to authenticated;

-- 保存订单：赠送余额优先，再扣实充余额。
create or replace function public.save_order_with_wallet(
  p_shop_id uuid,
  p_customer_id uuid,
  p_records jsonb,
  p_prepaid_used numeric default 0,
  p_benefits_used jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_customer public.customers%rowtype;
  v_row jsonb;
  v_b jsonb;
  v_stock public.customer_benefits%rowtype;
  v_prepaid numeric(12,2) := round(greatest(coalesce(p_prepaid_used,0),0)::numeric,2);
  v_total numeric(12,2) := 0;
  v_history numeric(12,2) := 0;
  v_running numeric(12,2) := 0;
  v_paid_before numeric(12,2);
  v_paid_after numeric(12,2);
  v_gift_before numeric(12,2);
  v_gift_after numeric(12,2);
  v_gift_used numeric(12,2) := 0;
  v_paid_used numeric(12,2) := 0;
  v_cash_due numeric(12,2);
  v_amount numeric(12,2);
  v_original numeric(12,2);
  v_discount numeric(5,2);
  v_qty numeric(12,4);
  v_use_qty numeric(12,2);
  v_after_qty numeric(12,2);
  v_group_id uuid := gen_random_uuid();
  v_first_record_id uuid;
  v_record_id uuid;
  v_record_ids jsonb := '[]'::jsonb;
  v_benefit_snapshot jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_count integer;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;
  if p_shop_id is null or p_customer_id is null then raise exception 'shop_and_customer_required'; end if;
  if jsonb_typeof(coalesce(p_records,'null'::jsonb)) <> 'array' or jsonb_array_length(p_records)=0 then raise exception 'order_records_required'; end if;
  if jsonb_array_length(p_records)>100 then raise exception 'too_many_order_lines'; end if;
  if jsonb_typeof(coalesce(p_benefits_used,'[]'::jsonb)) <> 'array' then raise exception 'invalid_benefits_payload'; end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id and user_id=v_user and shop_id=p_shop_id
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  if not exists(
    select 1 from public.shops s
    where s.id=p_shop_id and s.is_active=true
      and (s.user_id=v_user or public.is_shop_member(s.id))
  ) then raise exception 'shop_not_available'; end if;

  for v_row in select value from jsonb_array_elements(p_records)
  loop
    v_amount := round(coalesce(nullif(v_row->>'amount','')::numeric,0),2);
    if v_amount<0 then raise exception 'invalid_order_amount'; end if;
    v_total := v_total+v_amount;
  end loop;
  v_total:=round(v_total,2);
  if v_prepaid>v_total then raise exception 'prepaid_exceeds_order_total'; end if;

  v_paid_before:=coalesce(v_customer.prepaid_balance,0);
  v_gift_before:=coalesce(v_customer.gift_balance,0);
  if v_prepaid>(v_paid_before+v_gift_before) then raise exception 'insufficient_prepaid_balance'; end if;

  v_gift_used:=least(v_prepaid,v_gift_before);
  v_paid_used:=round(v_prepaid-v_gift_used,2);
  v_gift_after:=round(v_gift_before-v_gift_used,2);
  v_paid_after:=round(v_paid_before-v_paid_used,2);
  v_cash_due:=round(v_total-v_prepaid,2);

  if exists(
    select 1 from jsonb_array_elements(p_benefits_used) e
    group by e->>'benefit_id' having count(*)>1
  ) then raise exception 'duplicate_benefit_usage'; end if;

  for v_b in select value from jsonb_array_elements(p_benefits_used)
  loop
    v_use_qty:=round(coalesce(nullif(v_b->>'quantity','')::numeric,0),2);
    if v_use_qty<=0 then continue; end if;

    select * into v_stock
    from public.customer_benefits cb
    where cb.id=nullif(v_b->>'benefit_id','')::uuid
      and cb.user_id=v_user and cb.customer_id=p_customer_id and cb.shop_id=p_shop_id
    for update;
    if not found then raise exception 'benefit_not_found'; end if;
    if v_stock.expires_at is not null and v_stock.expires_at<now() then raise exception 'benefit_expired:%',v_stock.name; end if;
    if coalesce(v_stock.quantity,0)<v_use_qty then raise exception 'insufficient_benefit_quantity:%',v_stock.name; end if;

    v_after_qty:=round((v_stock.quantity-v_use_qty)::numeric,2);
    update public.customer_benefits set quantity=v_after_qty where id=v_stock.id and user_id=v_user;

    v_benefit_snapshot:=v_benefit_snapshot||jsonb_build_array(jsonb_build_object(
      'benefit_id',v_stock.id,'name',v_stock.name,'quantity',v_use_qty,'unit',v_stock.unit_label,
      'quantity_before',v_stock.quantity,'quantity_after',v_after_qty
    ));
  end loop;

  if v_prepaid>0 then
    update public.customers
    set prepaid_balance=v_paid_after,gift_balance=v_gift_after
    where id=p_customer_id and user_id=v_user;
  end if;

  select coalesce(sum(amount),0) into v_history
  from public.consumption_records
  where user_id=v_user and customer_id=p_customer_id;
  v_running:=v_history;

  v_count:=0;
  for v_row in select value from jsonb_array_elements(p_records)
  loop
    v_count:=v_count+1;
    v_amount:=round(coalesce(nullif(v_row->>'amount','')::numeric,0),2);
    v_original:=round(coalesce(nullif(v_row->>'original_amount','')::numeric,v_amount),2);
    v_discount:=greatest(0,least(100,coalesce(nullif(v_row->>'discount_rate_snapshot','')::numeric,100)));
    v_qty:=coalesce(nullif(v_row->>'quantity','')::numeric,1);

    insert into public.consumption_records(
      user_id,shop_id,customer_id,item_id,
      customer_name_snapshot,item_name,item_name_snapshot,companion_name,
      unit_price_snapshot,unit_label,unit_label_snapshot,unit_minutes_snapshot,
      quantity,duration_input,amount,original_amount,discount_rate_snapshot,
      previous_total,new_total,note,report_text,occurred_at,
      order_group_id,prepaid_used,prepaid_balance_after,benefits_used,cash_due,
      prepaid_paid_used,gift_balance_used
    ) values (
      v_user,p_shop_id,p_customer_id,nullif(v_row->>'item_id','')::uuid,
      coalesce(nullif(v_row->>'customer_name_snapshot',''),v_customer.name),
      coalesce(nullif(v_row->>'item_name',''),nullif(v_row->>'item_name_snapshot',''),'未命名项目'),
      coalesce(nullif(v_row->>'item_name_snapshot',''),nullif(v_row->>'item_name',''),'未命名项目'),
      nullif(v_row->>'companion_name',''),
      round(coalesce(nullif(v_row->>'unit_price_snapshot','')::numeric,0),2),
      coalesce(nullif(v_row->>'unit_label',''),nullif(v_row->>'unit_label_snapshot',''),'次'),
      coalesce(nullif(v_row->>'unit_label_snapshot',''),nullif(v_row->>'unit_label',''),'次'),
      nullif(v_row->>'unit_minutes_snapshot','')::integer,
      v_qty,nullif(v_row->>'duration_input',''),v_amount,v_original,v_discount,
      v_running,round(v_running+v_amount,2),nullif(v_row->>'note',''),nullif(v_row->>'report_text',''),v_now,
      v_group_id,
      case when v_count=1 then v_prepaid else 0 end,
      case when v_count=1 then v_paid_after+v_gift_after else null end,
      case when v_count=1 then v_benefit_snapshot else '[]'::jsonb end,
      case when v_count=1 then v_cash_due else null end,
      case when v_count=1 then v_paid_used else 0 end,
      case when v_count=1 then v_gift_used else 0 end
    ) returning id into v_record_id;

    if v_first_record_id is null then v_first_record_id:=v_record_id; end if;
    v_record_ids:=v_record_ids||jsonb_build_array(v_record_id);
    v_running:=round(v_running+v_amount,2);
  end loop;

  if v_gift_used>0 then
    insert into public.customer_prepaid_ledger(
      user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,related_record_id,note,balance_type
    ) values (
      v_user,p_shop_id,p_customer_id,'consume',-v_gift_used,v_gift_before,v_gift_after,
      v_first_record_id,'派单使用赠送余额','gift'
    );
  end if;

  if v_paid_used>0 then
    insert into public.customer_prepaid_ledger(
      user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,related_record_id,note,balance_type
    ) values (
      v_user,p_shop_id,p_customer_id,'consume',-v_paid_used,v_paid_before,v_paid_after,
      v_first_record_id,'派单使用实充余额','paid'
    );
  end if;

  for v_b in select value from jsonb_array_elements(v_benefit_snapshot)
  loop
    insert into public.customer_benefit_ledger(
      user_id,shop_id,customer_id,benefit_id,benefit_name,
      kind,delta,quantity_before,quantity_after,related_record_id,note
    ) values (
      v_user,p_shop_id,p_customer_id,(v_b->>'benefit_id')::uuid,v_b->>'name',
      'consume',-(v_b->>'quantity')::numeric,
      (v_b->>'quantity_before')::numeric,(v_b->>'quantity_after')::numeric,
      v_first_record_id,'派单使用权益'
    );
  end loop;

  return jsonb_build_object(
    'success',true,'order_group_id',v_group_id,'record_ids',v_record_ids,
    'order_total',v_total,'history_before',v_history,'history_after',v_running,
    'prepaid_used',v_prepaid,'paid_used',v_paid_used,'gift_used',v_gift_used,
    'paid_balance_after',v_paid_after,'gift_balance_after',v_gift_after,
    'prepaid_balance_after',v_paid_after+v_gift_after,'cash_due',v_cash_due,
    'benefits_used',v_benefit_snapshot
  );
end;
$$;

revoke all on function public.save_order_with_wallet(uuid,uuid,jsonb,numeric,jsonb) from public,anon;
grant execute on function public.save_order_with_wallet(uuid,uuid,jsonb,numeric,jsonb) to authenticated;

-- 删除整单，可选择原路退回余额/权益。所有操作同一事务完成。
create or replace function public.delete_order_with_wallet_restore(
  p_record_id uuid,
  p_restore_wallet boolean default true,
  p_restore_benefits boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_user uuid:=auth.uid();
  v_rec public.consumption_records%rowtype;
  v_first public.consumption_records%rowtype;
  v_customer public.customers%rowtype;
  v_b jsonb;
  v_stock public.customer_benefits%rowtype;
  v_paid numeric(12,2):=0;
  v_gift numeric(12,2):=0;
  v_paid_before numeric(12,2);
  v_gift_before numeric(12,2);
  v_qty numeric(12,2);
  v_group uuid;
  v_deleted integer:=0;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_rec from public.consumption_records
  where id=p_record_id and user_id=v_user for update;
  if not found then raise exception 'record_not_found'; end if;

  v_group:=v_rec.order_group_id;

  if v_group is not null then
    select * into v_first from public.consumption_records
    where user_id=v_user and order_group_id=v_group
    order by occurred_at,id limit 1 for update;
  else
    v_first:=v_rec;
  end if;

  select * into v_customer from public.customers
  where id=v_first.customer_id and user_id=v_user for update;
  if not found then raise exception 'customer_not_found'; end if;

  v_paid:=coalesce(v_first.prepaid_paid_used,0);
  v_gift:=coalesce(v_first.gift_balance_used,0);

  -- 兼容赠送余额功能上线前保存的旧单：旧 prepaid_used 全部视作实充。
  if v_paid=0 and v_gift=0 and coalesce(v_first.prepaid_used,0)>0 then
    v_paid:=v_first.prepaid_used;
  end if;

  if p_restore_wallet then
    v_paid_before:=coalesce(v_customer.prepaid_balance,0);
    v_gift_before:=coalesce(v_customer.gift_balance,0);

    update public.customers
    set prepaid_balance=round(v_paid_before+v_paid,2),
        gift_balance=round(v_gift_before+v_gift,2)
    where id=v_customer.id and user_id=v_user;

    if v_paid>0 then
      insert into public.customer_prepaid_ledger(
        user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,related_record_id,note,balance_type
      ) values (
        v_user,v_first.shop_id,v_customer.id,'refund',v_paid,v_paid_before,round(v_paid_before+v_paid,2),
        v_first.id,'删除订单退回实充余额','paid'
      );
    end if;
    if v_gift>0 then
      insert into public.customer_prepaid_ledger(
        user_id,shop_id,customer_id,kind,delta,balance_before,balance_after,related_record_id,note,balance_type
      ) values (
        v_user,v_first.shop_id,v_customer.id,'refund',v_gift,v_gift_before,round(v_gift_before+v_gift,2),
        v_first.id,'删除订单退回赠送余额','gift'
      );
    end if;
  end if;

  if p_restore_benefits then
    for v_b in select value from jsonb_array_elements(coalesce(v_first.benefits_used,'[]'::jsonb))
    loop
      v_qty:=round(coalesce(nullif(v_b->>'quantity','')::numeric,0),2);
      if v_qty<=0 then continue; end if;

      select * into v_stock from public.customer_benefits
      where id=nullif(v_b->>'benefit_id','')::uuid
        and user_id=v_user and customer_id=v_customer.id
      for update;

      if found then
        update public.customer_benefits set quantity=round(v_stock.quantity+v_qty,2)
        where id=v_stock.id and user_id=v_user;

        insert into public.customer_benefit_ledger(
          user_id,shop_id,customer_id,benefit_id,benefit_name,
          kind,delta,quantity_before,quantity_after,related_record_id,note
        ) values (
          v_user,v_first.shop_id,v_customer.id,v_stock.id,v_stock.name,
          'return',v_qty,v_stock.quantity,round(v_stock.quantity+v_qty,2),
          v_first.id,'删除订单退回权益'
        );
      end if;
    end loop;
  end if;

  if v_group is not null then
    delete from public.consumption_records where user_id=v_user and order_group_id=v_group;
  else
    delete from public.consumption_records where user_id=v_user and id=v_first.id;
  end if;
  get diagnostics v_deleted=row_count;

  return jsonb_build_object(
    'success',true,'deleted_records',v_deleted,
    'paid_refunded',case when p_restore_wallet then v_paid else 0 end,
    'gift_refunded',case when p_restore_wallet then v_gift else 0 end,
    'benefits_restored',p_restore_benefits
  );
end;
$$;

revoke all on function public.delete_order_with_wallet_restore(uuid,boolean,boolean) from public,anon;
grant execute on function public.delete_order_with_wallet_restore(uuid,boolean,boolean) to authenticated;

commit;
