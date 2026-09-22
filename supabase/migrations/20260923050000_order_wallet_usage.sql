-- 派Mini：派单联动预存余额 / 权益
-- 规则：
-- 1) 本单消费金额仍按完整订单金额计入累计消费。
-- 2) 预存抵扣只改变本次另付金额，不减少累计消费。
-- 3) 权益是通用库存，本阶段只记录“使用了什么 / 用了多少”，不自动改订单价格。
-- 4) 保存订单、扣预存、扣权益必须在同一个数据库事务里完成，避免半保存。

begin;

alter table public.consumption_records
  add column if not exists order_group_id uuid;

alter table public.consumption_records
  add column if not exists cash_due numeric(12,2);

-- 兼容线上旧表仍保留的字段。
alter table public.consumption_records
  add column if not exists item_name text;

alter table public.consumption_records
  add column if not exists unit_label text;

update public.consumption_records
set item_name = coalesce(item_name,item_name_snapshot)
where item_name is null;

update public.consumption_records
set unit_label = coalesce(unit_label,unit_label_snapshot,'次')
where unit_label is null;

create index if not exists consumption_records_order_group_idx
  on public.consumption_records(user_id,order_group_id,occurred_at desc);

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
  v_balance_before numeric(12,2);
  v_balance_after numeric(12,2);
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
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not public.has_active_access() then
    raise exception 'account_read_only_expired';
  end if;

  if p_shop_id is null or p_customer_id is null then
    raise exception 'shop_and_customer_required';
  end if;

  if jsonb_typeof(coalesce(p_records,'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_records)=0 then
    raise exception 'order_records_required';
  end if;

  if jsonb_array_length(p_records) > 100 then
    raise exception 'too_many_order_lines';
  end if;

  if jsonb_typeof(coalesce(p_benefits_used,'[]'::jsonb)) <> 'array' then
    raise exception 'invalid_benefits_payload';
  end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id
    and user_id=v_user
    and shop_id=p_shop_id
  for update;

  if not found then
    raise exception 'customer_not_found';
  end if;

  if not exists(
    select 1
    from public.shops s
    where s.id=p_shop_id
      and s.is_active=true
      and (
        s.user_id=v_user
        or public.is_shop_member(s.id)
      )
  ) then
    raise exception 'shop_not_available';
  end if;

  -- 计算整单金额，金额必须非负。
  for v_row in select value from jsonb_array_elements(p_records)
  loop
    v_amount := round(coalesce(nullif(v_row->>'amount','')::numeric,0),2);
    if v_amount < 0 then
      raise exception 'invalid_order_amount';
    end if;
    v_total := v_total + v_amount;
  end loop;

  v_total := round(v_total,2);
  if v_prepaid > v_total then
    raise exception 'prepaid_exceeds_order_total';
  end if;

  v_balance_before := coalesce(v_customer.prepaid_balance,0);
  if v_prepaid > v_balance_before then
    raise exception 'insufficient_prepaid_balance';
  end if;

  v_balance_after := round(v_balance_before-v_prepaid,2);
  v_cash_due := round(v_total-v_prepaid,2);

  -- 同一权益不能在一次请求里重复出现，避免重复扣库存。
  if exists(
    select 1
    from jsonb_array_elements(p_benefits_used) e
    group by e->>'benefit_id'
    having count(*)>1
  ) then
    raise exception 'duplicate_benefit_usage';
  end if;

  -- 先锁定并扣权益。整个函数失败时 PostgreSQL 会整体回滚。
  for v_b in select value from jsonb_array_elements(p_benefits_used)
  loop
    v_use_qty := round(coalesce(nullif(v_b->>'quantity','')::numeric,0),2);
    if v_use_qty <= 0 then
      continue;
    end if;

    select * into v_stock
    from public.customer_benefits cb
    where cb.id=nullif(v_b->>'benefit_id','')::uuid
      and cb.user_id=v_user
      and cb.customer_id=p_customer_id
      and cb.shop_id=p_shop_id
    for update;

    if not found then
      raise exception 'benefit_not_found';
    end if;

    if v_stock.expires_at is not null and v_stock.expires_at < now() then
      raise exception 'benefit_expired:%',v_stock.name;
    end if;

    if coalesce(v_stock.quantity,0) < v_use_qty then
      raise exception 'insufficient_benefit_quantity:%',v_stock.name;
    end if;

    v_after_qty := round((v_stock.quantity-v_use_qty)::numeric,2);

    update public.customer_benefits
    set quantity=v_after_qty
    where id=v_stock.id and user_id=v_user;

    v_benefit_snapshot := v_benefit_snapshot || jsonb_build_array(
      jsonb_build_object(
        'benefit_id',v_stock.id,
        'name',v_stock.name,
        'quantity',v_use_qty,
        'unit',v_stock.unit_label,
        'quantity_before',v_stock.quantity,
        'quantity_after',v_after_qty
      )
    );
  end loop;

  if v_prepaid > 0 then
    update public.customers
    set prepaid_balance=v_balance_after
    where id=p_customer_id and user_id=v_user;
  end if;

  select coalesce(sum(amount),0)
  into v_history
  from public.consumption_records
  where user_id=v_user and customer_id=p_customer_id;

  v_running := v_history;

  -- 保存所有项目行。同一整单共享 order_group_id。
  v_count := 0;
  for v_row in select value from jsonb_array_elements(p_records)
  loop
    v_count := v_count + 1;
    v_amount := round(coalesce(nullif(v_row->>'amount','')::numeric,0),2);
    v_original := round(coalesce(nullif(v_row->>'original_amount','')::numeric,v_amount),2);
    v_discount := greatest(0,least(100,coalesce(nullif(v_row->>'discount_rate_snapshot','')::numeric,100)));
    v_qty := coalesce(nullif(v_row->>'quantity','')::numeric,1);

    insert into public.consumption_records(
      user_id,shop_id,customer_id,item_id,
      customer_name_snapshot,item_name,item_name_snapshot,companion_name,
      unit_price_snapshot,unit_label,unit_label_snapshot,unit_minutes_snapshot,
      quantity,duration_input,amount,original_amount,discount_rate_snapshot,
      previous_total,new_total,note,report_text,occurred_at,
      order_group_id,prepaid_used,prepaid_balance_after,benefits_used,cash_due
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
      case when v_count=1 then v_balance_after else null end,
      case when v_count=1 then v_benefit_snapshot else '[]'::jsonb end,
      case when v_count=1 then v_cash_due else null end
    )
    returning id into v_record_id;

    if v_first_record_id is null then
      v_first_record_id := v_record_id;
    end if;

    v_record_ids := v_record_ids || jsonb_build_array(v_record_id);
    v_running := round(v_running+v_amount,2);
  end loop;

  -- 资金流水只记一次，关联整单第一条消费记录。
  if v_prepaid > 0 then
    insert into public.customer_prepaid_ledger(
      user_id,shop_id,customer_id,kind,delta,
      balance_before,balance_after,related_record_id,note
    ) values (
      v_user,p_shop_id,p_customer_id,'consume',-v_prepaid,
      v_balance_before,v_balance_after,v_first_record_id,'派单使用预存'
    );
  end if;

  -- 权益流水同样只对本次整单各记一次。
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
    'success',true,
    'order_group_id',v_group_id,
    'record_ids',v_record_ids,
    'order_total',v_total,
    'history_before',v_history,
    'history_after',v_running,
    'prepaid_used',v_prepaid,
    'prepaid_balance_after',v_balance_after,
    'cash_due',v_cash_due,
    'benefits_used',v_benefit_snapshot
  );
end;
$$;

revoke all on function public.save_order_with_wallet(uuid,uuid,jsonb,numeric,jsonb)
from public, anon;

grant execute on function public.save_order_with_wallet(uuid,uuid,jsonb,numeric,jsonb)
to authenticated;

commit;
