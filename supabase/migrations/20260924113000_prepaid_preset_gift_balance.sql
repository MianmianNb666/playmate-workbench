begin;
alter table public.wallet_presets add column if not exists gift_amount numeric(12,2) not null default 0 check (gift_amount >= 0);

create or replace function public.apply_custom_prepaid_package_with_gift(
  p_customer_id uuid,
  p_preset_id uuid,
  p_amount numeric,
  p_benefits jsonb default '[]'::jsonb,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_user uuid:=auth.uid();
  v_gift numeric(12,2):=0;
  v_base jsonb;
  v_gift_result jsonb;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;

  if not exists (
    select 1 from public.wallet_presets
    where id=p_preset_id and user_id=v_user and preset_type='prepaid' and is_active=true
  ) then raise exception 'preset_not_found'; end if;

  select coalesce(sum(
    case when coalesce(value->>'type','benefit')='balance'
      then greatest(coalesce(nullif(value->>'quantity','')::numeric,0),0)
      else 0 end
  ),0)
  into v_gift
  from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb));

  v_base:=public.apply_custom_prepaid_package(
    p_customer_id,p_preset_id,p_amount,
    coalesce((select jsonb_agg(value) from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb)) where coalesce(value->>'type','benefit')<>'balance'),'[]'::jsonb),
    p_note
  );

  if v_gift>0 then
    v_gift_result:=public.adjust_customer_gift_balance(
      p_customer_id,v_gift,'topup',
      coalesce(nullif(btrim(p_note),''),'预存套餐附赠余额'),
      null
    );
  end if;

  return v_base || jsonb_build_object('gift_amount',v_gift,'gift_result',v_gift_result);
end;
$$;

revoke all on function public.apply_custom_prepaid_package_with_gift(uuid,uuid,numeric,jsonb,text) from public,anon;
grant execute on function public.apply_custom_prepaid_package_with_gift(uuid,uuid,numeric,jsonb,text) to authenticated;
commit;
