-- 陪玩工作台 V1.7：Owner 管理端
-- 整份复制到 Supabase SQL Editor -> Run
-- 已把当前工作台账号 jiaj200405@gmail.com 设为 Owner。
-- 如果以后 Owner 邮箱更换，只需要改最后一段邮箱。

-- V1.7 Owner 管理端
-- 管理端能力：用户使用期、邀请码、店铺上下架、加时记录。
-- 普通用户无法调用这些管理 RPC。

begin;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create table if not exists public.admin_time_adjustments (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  added_days integer not null,
  old_valid_until timestamptz,
  new_valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.admin_time_adjustments enable row level security;
revoke all on public.admin_time_adjustments from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.app_admins a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  display_name text,
  valid_until timestamptz,
  has_access boolean,
  days_left integer,
  shop_count bigint,
  record_count bigint
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
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    coalesce(p.display_name,'')::text,
    ua.valid_until,
    (ua.valid_until is not null and ua.valid_until > now()) as has_access,
    case
      when ua.valid_until is null then 0
      else greatest(0,ceil(extract(epoch from (ua.valid_until-now()))/86400.0)::int)
    end as days_left,
    (select count(*) from public.shops s where s.user_id=u.id) as shop_count,
    (select count(*) from public.consumption_records r where r.user_id=u.id) as record_count
  from auth.users u
  left join public.user_access ua on ua.user_id=u.id
  left join public.user_profiles p on p.user_id=u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_grant_days(
  p_user_id uuid,
  p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_old timestamptz;
  v_base timestamptz;
  v_new timestamptz;
begin
  if not public.is_app_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  if p_days not in (7,30,90,365) then
    raise exception '仅支持 7 / 30 / 90 / 365 天';
  end if;

  select valid_until
  into v_old
  from public.user_access
  where user_id=p_user_id
  for update;

  if not found then
    v_old := null;
    v_base := now();
    v_new := v_base + make_interval(days=>p_days);

    insert into public.user_access(user_id,valid_from,valid_until)
    values(p_user_id,now(),v_new);
  else
    v_base := case when v_old>now() then v_old else now() end;
    v_new := v_base + make_interval(days=>p_days);

    update public.user_access
    set valid_until=v_new, updated_at=now()
    where user_id=p_user_id;
  end if;

  insert into public.admin_time_adjustments(
    admin_user_id,target_user_id,added_days,old_valid_until,new_valid_until
  )
  values(auth.uid(),p_user_id,p_days,v_old,v_new);

  return jsonb_build_object(
    'success',true,
    'added_days',p_days,
    'valid_until',v_new
  );
end;
$$;

revoke all on function public.admin_grant_days(uuid,integer) from public, anon;
grant execute on function public.admin_grant_days(uuid,integer) to authenticated;

create or replace function public.admin_generate_invite(
  p_purpose text,
  p_duration_days integer,
  p_use_mode text default 'single',
  p_max_uses integer default 1,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  return public.admin_create_invite_code(
    p_purpose,
    p_duration_days,
    p_use_mode,
    p_max_uses,
    p_label,
    p_expires_at
  );
end;
$$;

revoke all on function public.admin_generate_invite(text,integer,text,integer,text,timestamptz)
from public, anon;
grant execute on function public.admin_generate_invite(text,integer,text,integer,text,timestamptz)
to authenticated;

create or replace function public.admin_list_invites()
returns table (
  id uuid,
  label text,
  purpose text,
  duration_days integer,
  use_mode text,
  max_uses integer,
  used_count integer,
  is_active boolean,
  expires_at timestamptz,
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
    i.id,i.label,i.purpose,i.duration_days,i.use_mode,
    i.max_uses,i.used_count,i.is_active,i.expires_at,i.created_at
  from public.invite_codes i
  order by i.created_at desc
  limit 300;
end;
$$;

revoke all on function public.admin_list_invites() from public, anon;
grant execute on function public.admin_list_invites() to authenticated;

create or replace function public.admin_list_time_logs()
returns table (
  id uuid,
  target_email text,
  added_days integer,
  old_valid_until timestamptz,
  new_valid_until timestamptz,
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
    l.id,
    u.email::text,
    l.added_days,
    l.old_valid_until,
    l.new_valid_until,
    l.created_at
  from public.admin_time_adjustments l
  join auth.users u on u.id=l.target_user_id
  order by l.created_at desc
  limit 300;
end;
$$;

revoke all on function public.admin_list_time_logs() from public, anon;
grant execute on function public.admin_list_time_logs() to authenticated;

create or replace function public.admin_list_shops()
returns table (
  id uuid,
  name text,
  owner_email text,
  is_active boolean,
  item_count bigint,
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
    s.created_at
  from public.shops s
  left join auth.users u on u.id=s.user_id
  order by s.created_at desc;
end;
$$;

revoke all on function public.admin_list_shops() from public, anon;
grant execute on function public.admin_list_shops() to authenticated;

create or replace function public.admin_set_shop_active(
  p_shop_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  update public.shops
  set is_active=p_active, updated_at=now()
  where id=p_shop_id;

  if not found then
    return jsonb_build_object('success',false,'reason','NOT_FOUND');
  end if;

  return jsonb_build_object('success',true,'is_active',p_active);
end;
$$;

revoke all on function public.admin_set_shop_active(uuid,boolean) from public, anon;
grant execute on function public.admin_set_shop_active(uuid,boolean) to authenticated;

commit;

-- 部署完成后，需要在 SQL Editor 单独把自己的账号加入管理员：
-- insert into public.app_admins(user_id)
-- select id from auth.users where email='你的登录邮箱'
-- on conflict(user_id) do nothing;


-- 当前 Owner
insert into public.app_admins(user_id)
select id
from auth.users
where lower(email)=lower('jiaj200405@gmail.com')
on conflict(user_id) do nothing;
