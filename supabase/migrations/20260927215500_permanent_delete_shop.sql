-- Permanent deletion for shops that are already in PaiMini's recycle bin.
-- Keeps normal "delete shop" behavior as soft-delete; only this RPC performs the irreversible step.

create or replace function public.permanently_delete_shop(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_shop_name text;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select s.name, s.deleted_at
    into v_shop_name, v_deleted_at
  from public.shops s
  where s.id = p_shop_id
    and s.user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'reason', 'NOT_FOUND_OR_NOT_OWNER',
      'message', '店铺不存在，或你不是这家店的创建者。'
    );
  end if;

  if v_deleted_at is null then
    return jsonb_build_object(
      'success', false,
      'reason', 'NOT_IN_RECYCLE_BIN',
      'message', '只能彻底删除已经移入回收站的店铺。'
    );
  end if;

  -- bot_messages uses ON DELETE SET NULL for shop_id, so remove those rows
  -- explicitly before deleting the shop. Other PaiMini shop-owned data uses
  -- foreign keys tied to shops and is removed by the shop delete.
  if to_regclass('public.bot_messages') is not null then
    delete from public.bot_messages
    where shop_id = p_shop_id
      and owner_user_id = v_user_id;
  end if;

  delete from public.shops
  where id = p_shop_id
    and user_id = v_user_id;

  return jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'shop_name', v_shop_name
  );

exception
  when foreign_key_violation then
    return jsonb_build_object(
      'success', false,
      'reason', 'RELATED_DATA_BLOCKED',
      'message', '还有关联数据阻止彻底删除，请联系管理员检查数据库关联规则。'
    );
end;
$$;

revoke all on function public.permanently_delete_shop(uuid) from public;
grant execute on function public.permanently_delete_shop(uuid) to authenticated;
