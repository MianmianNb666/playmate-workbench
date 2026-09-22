-- 派Mini：预存套餐 + 附赠权益
-- 预存是主体，权益作为该笔预存套餐的赠送内容，可一次包含多项。

alter table public.wallet_presets
  add column if not exists bundled_benefits jsonb not null default '[]'::jsonb;

alter table public.wallet_presets
  drop constraint if exists wallet_presets_bundled_benefits_array_check;
alter table public.wallet_presets
  add constraint wallet_presets_bundled_benefits_array_check
  check (jsonb_typeof(bundled_benefits) = 'array');

-- 记录某笔余额/权益来自哪个预存套餐，便于老板档案后续展示来源。
alter table public.customer_prepaid_ledger
  add column if not exists preset_id uuid references public.wallet_presets(id) on delete set null;

alter table public.customer_benefit_ledger
  add column if not exists preset_id uuid references public.wallet_presets(id) on delete set null;

create index if not exists customer_prepaid_ledger_preset_idx
  on public.customer_prepaid_ledger(user_id, preset_id, created_at desc);

create index if not exists customer_benefit_ledger_preset_idx
  on public.customer_benefit_ledger(user_id, preset_id, created_at desc);

-- 原子发放一个预存套餐：先加余额，再发放套餐附赠的多项权益。
create or replace function public.apply_prepaid_package(
  p_customer_id uuid,
  p_preset_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
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
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  select * into v_preset
  from public.wallet_presets
  where id = p_preset_id and user_id = v_user and is_active = true;
  if not found then raise exception 'preset_not_found'; end if;

  if v_preset.preset_type <> 'prepaid' then
    raise exception 'preset_not_prepaid';
  end if;

  if coalesce(v_preset.amount,0) <= 0 then
    raise exception 'invalid_prepaid_amount';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and user_id = v_user
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  if v_customer.shop_id <> v_preset.shop_id then
    raise exception 'customer_shop_mismatch';
  end if;

  v_before := coalesce(v_customer.prepaid_balance,0);
  v_after := round((v_before + v_preset.amount)::numeric,2);

  update public.customers
  set prepaid_balance = v_after
  where id = p_customer_id and user_id = v_user;

  insert into public.customer_prepaid_ledger(
    user_id, shop_id, customer_id, kind, delta,
    balance_before, balance_after, related_record_id, note, preset_id
  ) values (
    v_user, v_customer.shop_id, p_customer_id, 'topup', v_preset.amount,
    v_before, v_after, null, v_preset.name, v_preset.id
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(v_preset.bundled_benefits,'[]'::jsonb))
  loop
    v_name := btrim(coalesce(v_item->>'name',''));
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 1);
    v_unit := coalesce(nullif(btrim(v_item->>'unit'),''),'个');
    v_days := nullif(v_item->>'expires_days','')::integer;

    if v_name = '' or v_qty <= 0 then
      continue;
    end if;

    v_exp := case when v_days is not null and v_days > 0 then now() + make_interval(days => v_days) else null end;

    select id, quantity into v_benefit_id, v_b_before
    from public.customer_benefits
    where user_id = v_user
      and customer_id = p_customer_id
      and lower(name) = lower(v_name)
    for update;

    if not found then
      v_b_before := 0;
      v_b_after := round(v_qty::numeric,2);
      insert into public.customer_benefits(
        user_id, shop_id, customer_id, name, quantity, unit_label, expires_at, note
      ) values (
        v_user, v_customer.shop_id, p_customer_id, v_name, v_b_after, v_unit, v_exp,
        '来自预存套餐：' || v_preset.name
      ) returning id into v_benefit_id;
    else
      v_b_before := coalesce(v_b_before,0);
      v_b_after := round((v_b_before + v_qty)::numeric,2);
      update public.customer_benefits
      set quantity = v_b_after,
          unit_label = v_unit,
          expires_at = case when v_exp is not null then v_exp else expires_at end,
          note = '来自预存套餐：' || v_preset.name
      where id = v_benefit_id and user_id = v_user;
    end if;

    insert into public.customer_benefit_ledger(
      user_id, shop_id, customer_id, benefit_id, benefit_name,
      kind, delta, quantity_before, quantity_after, related_record_id, note, preset_id
    ) values (
      v_user, v_customer.shop_id, p_customer_id, v_benefit_id, v_name,
      'grant', v_qty, v_b_before, v_b_after, null,
      '预存套餐附赠：' || v_preset.name, v_preset.id
    );

    v_granted := v_granted || jsonb_build_array(jsonb_build_object(
      'name', v_name,
      'quantity', v_qty,
      'unit', v_unit,
      'expires_at', v_exp
    ));
  end loop;

  return jsonb_build_object(
    'balance_before', v_before,
    'balance_after', v_after,
    'amount', v_preset.amount,
    'benefits', v_granted
  );
end;
$$;

grant execute on function public.apply_prepaid_package(uuid,uuid) to authenticated;
