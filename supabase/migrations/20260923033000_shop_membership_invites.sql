-- 派Mini：店铺成员制 + 加入邀请码 / 链接
-- 规则：
-- 1) 店铺默认不向所有登录用户公开，只允许店主本人和已加入成员读取。
-- 2) 店主可以复制邀请码 / 邀请链接、关闭邀请、重新生成邀请码。
-- 3) 普通成员只能读取共享店铺和价格表，不能修改店铺或共享价格表。
-- 4) 老板档案、消费记录、预存、权益等仍按各自 user_id 隔离，不因加入同一店铺而共享。
-- 5) 管理端继续通过 SECURITY DEFINER RPC 查看全部店铺，不受成员制 RLS 影响。

begin;

create extension if not exists pgcrypto with schema extensions;

-- 旧 visibility 字段保留兼容，但从本版本起不再作为正常用户的可见性判断。
alter table public.shops
  add column if not exists visibility text not null default 'private';

update public.shops
set visibility='private'
where visibility is distinct from 'private';

-- ---------- 店铺成员 ----------
create table if not exists public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (shop_id,user_id)
);

create index if not exists shop_members_user_idx
  on public.shop_members(user_id,joined_at desc);

alter table public.shop_members enable row level security;
revoke all on public.shop_members from anon, authenticated;

-- ---------- 店铺邀请 ----------
create table if not exists public.shop_invites (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  code text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shop_invites_code_upper_uidx
  on public.shop_invites(upper(code));

alter table public.shop_invites enable row level security;
revoke all on public.shop_invites from anon, authenticated;

-- 直接表权限全部关闭，加入 / 邀请统一走 RPC，避免泄露邀请码。

-- ---------- 权限辅助函数 ----------
create or replace function public.is_shop_owner(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.shops s
    where s.id=p_shop_id
      and s.user_id=auth.uid()
  );
$$;

revoke all on function public.is_shop_owner(uuid) from public, anon;
grant execute on function public.is_shop_owner(uuid) to authenticated;

create or replace function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.shop_members m
    where m.shop_id=p_shop_id
      and m.user_id=auth.uid()
  );
$$;

revoke all on function public.is_shop_member(uuid) from public, anon;
grant execute on function public.is_shop_member(uuid) to authenticated;

-- ---------- 生成随机加入码 ----------
create or replace function public.make_shop_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
begin
  loop
    v_code := 'PM-' || upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,16));
    exit when not exists(
      select 1 from public.shop_invites i where upper(i.code)=upper(v_code)
    );
  end loop;
  return v_code;
end;
$$;

revoke all on function public.make_shop_join_code() from public, anon, authenticated;

-- ---------- 店主读取 / 首次生成当前邀请码 ----------
create or replace function public.get_my_shop_invite(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.shop_invites%rowtype;
  v_code text;
  v_member_count bigint;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not exists(
    select 1 from public.shops s
    where s.id=p_shop_id and s.user_id=v_uid
  ) then
    raise exception 'SHOP_OWNER_ONLY';
  end if;

  select * into v_invite
  from public.shop_invites
  where shop_id=p_shop_id;

  if not found then
    if not public.has_active_access() then
      return jsonb_build_object(
        'success',true,
        'exists',false,
        'is_enabled',false,
        'member_count',(select count(*) from public.shop_members m where m.shop_id=p_shop_id)
      );
    end if;

    v_code := public.make_shop_join_code();
    insert into public.shop_invites(shop_id,code,is_enabled)
    values(p_shop_id,v_code,true)
    returning * into v_invite;
  end if;

  select count(*) into v_member_count
  from public.shop_members m
  where m.shop_id=p_shop_id;

  return jsonb_build_object(
    'success',true,
    'exists',true,
    'code',v_invite.code,
    'is_enabled',v_invite.is_enabled,
    'member_count',v_member_count,
    'updated_at',v_invite.updated_at
  );
end;
$$;

revoke all on function public.get_my_shop_invite(uuid) from public, anon;
grant execute on function public.get_my_shop_invite(uuid) to authenticated;

-- ---------- 开启 / 关闭邀请 ----------
create or replace function public.set_shop_invite_enabled(
  p_shop_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  if not exists(
    select 1 from public.shops s
    where s.id=p_shop_id and s.user_id=v_uid
  ) then
    raise exception 'SHOP_OWNER_ONLY';
  end if;

  select code into v_code
  from public.shop_invites
  where shop_id=p_shop_id;

  if not found then
    v_code := public.make_shop_join_code();
    insert into public.shop_invites(shop_id,code,is_enabled)
    values(p_shop_id,v_code,p_enabled);
  else
    update public.shop_invites
    set is_enabled=p_enabled, updated_at=now()
    where shop_id=p_shop_id;
  end if;

  return jsonb_build_object('success',true,'is_enabled',p_enabled,'code',v_code);
end;
$$;

revoke all on function public.set_shop_invite_enabled(uuid,boolean) from public, anon;
grant execute on function public.set_shop_invite_enabled(uuid,boolean) to authenticated;

-- ---------- 重新生成邀请码 ----------
create or replace function public.regenerate_shop_invite(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  if not exists(
    select 1 from public.shops s
    where s.id=p_shop_id and s.user_id=v_uid
  ) then
    raise exception 'SHOP_OWNER_ONLY';
  end if;

  v_code := public.make_shop_join_code();

  insert into public.shop_invites(shop_id,code,is_enabled,updated_at)
  values(p_shop_id,v_code,true,now())
  on conflict(shop_id) do update
  set code=excluded.code,
      is_enabled=true,
      updated_at=now();

  return jsonb_build_object('success',true,'code',v_code,'is_enabled',true);
end;
$$;

revoke all on function public.regenerate_shop_invite(uuid) from public, anon;
grant execute on function public.regenerate_shop_invite(uuid) to authenticated;

-- ---------- 通过加入码加入店铺 ----------
create or replace function public.join_shop_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_shop public.shops%rowtype;
  v_already boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  select s.* into v_shop
  from public.shop_invites i
  join public.shops s on s.id=i.shop_id
  where upper(i.code)=upper(trim(coalesce(p_code,'')))
    and i.is_enabled=true
    and s.is_active=true
    and exists(
      select 1
      from public.user_access ua
      where ua.user_id=s.user_id
        and ua.valid_until>now()
    )
  limit 1;

  if not found then
    return jsonb_build_object('success',false,'reason','INVALID_OR_CLOSED');
  end if;

  if v_shop.user_id=v_uid then
    return jsonb_build_object(
      'success',true,
      'reason','ALREADY_OWNER',
      'shop_id',v_shop.id,
      'shop_name',v_shop.name
    );
  end if;

  select exists(
    select 1 from public.shop_members m
    where m.shop_id=v_shop.id and m.user_id=v_uid
  ) into v_already;

  insert into public.shop_members(shop_id,user_id)
  values(v_shop.id,v_uid)
  on conflict(shop_id,user_id) do nothing;

  return jsonb_build_object(
    'success',true,
    'reason',case when v_already then 'ALREADY_JOINED' else 'JOINED' end,
    'shop_id',v_shop.id,
    'shop_name',v_shop.name
  );
end;
$$;

revoke all on function public.join_shop_by_code(text) from public, anon;
grant execute on function public.join_shop_by_code(text) to authenticated;

-- ---------- 成员退出店铺 ----------
create or replace function public.leave_joined_shop(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_active_access() then raise exception 'account_read_only_expired'; end if;

  if exists(
    select 1 from public.shops s
    where s.id=p_shop_id and s.user_id=v_uid
  ) then
    return jsonb_build_object('success',false,'reason','OWNER_CANNOT_LEAVE');
  end if;

  delete from public.shop_members
  where shop_id=p_shop_id and user_id=v_uid;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'success',v_count>0,
    'reason',case when v_count>0 then 'LEFT' else 'NOT_MEMBER' end
  );
end;
$$;

revoke all on function public.leave_joined_shop(uuid) from public, anon;
grant execute on function public.leave_joined_shop(uuid) to authenticated;

-- ---------- 普通用户可见范围：仅店主本人 + 已加入成员 ----------
drop policy if exists shops_select_authenticated on public.shops;
drop policy if exists shops_select_own on public.shops;
create policy shops_select_authenticated
on public.shops for select to authenticated
using (
  user_id=(select auth.uid())
  or (
    is_active=true
    and public.is_shop_member(id)
  )
);

-- 共享价格表同样只对店主和成员可见。
drop policy if exists price_categories_select_authenticated on public.price_categories;
drop policy if exists price_categories_select_own on public.price_categories;
create policy price_categories_select_authenticated
on public.price_categories for select to authenticated
using (
  user_id=(select auth.uid())
  or exists(
    select 1
    from public.shops s
    where s.id=price_categories.shop_id
      and s.is_active=true
      and public.is_shop_member(s.id)
  )
);

drop policy if exists price_items_select_authenticated on public.price_items;
drop policy if exists price_items_select_own on public.price_items;
create policy price_items_select_authenticated
on public.price_items for select to authenticated
using (
  user_id=(select auth.uid())
  or exists(
    select 1
    from public.shops s
    where s.id=price_items.shop_id
      and s.is_active=true
      and public.is_shop_member(s.id)
  )
);

-- ---------- 管理端：仍可查看全部店铺 ----------
-- 重新创建 admin_list_shops，新增成员数与邀请状态。
drop function if exists public.admin_list_shops();

create function public.admin_list_shops()
returns table (
  id uuid,
  name text,
  owner_email text,
  is_active boolean,
  item_count bigint,
  member_count bigint,
  invite_enabled boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  return query
  select
    s.id,
    s.name,
    u.email::text,
    s.is_active,
    (select count(*) from public.price_items pi where pi.shop_id=s.id) as item_count,
    (select count(*) from public.shop_members sm where sm.shop_id=s.id) as member_count,
    coalesce((select si.is_enabled from public.shop_invites si where si.shop_id=s.id),false) as invite_enabled,
    s.created_at
  from public.shops s
  left join auth.users u on u.id=s.user_id
  order by s.created_at desc;
end;
$$;

revoke all on function public.admin_list_shops() from public, anon;
grant execute on function public.admin_list_shops() to authenticated;

commit;
