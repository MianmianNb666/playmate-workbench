-- Phase 3 hotfix: list_my_shop_members
-- Fix PL/pgSQL output-column ambiguity around `joined_at`.
-- Read-only RPC only; no membership write behavior changes.

begin;

create or replace function public.list_my_shop_members(p_shop_id uuid)
returns table(
  user_id uuid,
  display_name text,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists(
    select 1
    from public.shops s
    where s.id = p_shop_id
      and s.user_id = auth.uid()
  ) then
    raise exception 'SHOP_OWNER_ONLY';
  end if;

  return query
  select q.user_id, q.display_name, q.email, q.role, q.joined_at
  from (
    select
      u.id::uuid as user_id,
      coalesce(p.display_name, '')::text as display_name,
      coalesce(u.email, '')::text as email,
      'owner'::text as role,
      s.created_at::timestamptz as joined_at
    from public.shops s
    join auth.users u on u.id = s.user_id
    left join public.user_profiles p on p.user_id = u.id
    where s.id = p_shop_id

    union all

    select
      u.id::uuid as user_id,
      coalesce(p.display_name, '')::text as display_name,
      coalesce(u.email, '')::text as email,
      'member'::text as role,
      m.joined_at::timestamptz as joined_at
    from public.shop_members m
    join auth.users u on u.id = m.user_id
    left join public.user_profiles p on p.user_id = u.id
    where m.shop_id = p_shop_id
  ) as q
  order by q.joined_at;
end;
$$;

revoke all on function public.list_my_shop_members(uuid) from public, anon;
grant execute on function public.list_my_shop_members(uuid) to authenticated;

commit;
