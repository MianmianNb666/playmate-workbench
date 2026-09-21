-- 陪玩工作台 V1.5 邀请码 + 使用期限
-- 复制本文件全部内容到 Supabase SQL Editor -> Run
-- 注册：固定 7 天试用
-- 续费：7 / 30 / 90 / 365 天

-- 陪玩工作台 V1.5：邀请码注册 + 时长权限
-- 规则：
-- 1) 新用户注册必须使用“7天试用”注册邀请码。
-- 2) 登录不需要邀请码。
-- 3) 续费邀请码仅支持 7 / 30 / 90 / 365 天。
-- 4) 续费从“当前到期日”继续累加；如果已经过期，则从现在重新计算。
-- 5) 同一个账号不能重复兑换同一个邀请码。
-- 6) 邀请码明文不会存入数据库，只保存 SHA-256 哈希。

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text,
  purpose text not null,
  duration_days integer not null,
  use_mode text not null default 'single',
  max_uses integer,
  used_count integer not null default 0,
  is_active boolean not null default true,
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.invite_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null,
  duration_days integer not null,
  old_valid_until timestamptz,
  new_valid_until timestamptz not null,
  redeemed_at timestamptz not null default now()
);

alter table public.invite_codes
  drop constraint if exists invite_codes_purpose_check;
alter table public.invite_codes
  add constraint invite_codes_purpose_check
  check (purpose in ('signup','renewal'));

alter table public.invite_codes
  drop constraint if exists invite_codes_duration_check;
alter table public.invite_codes
  add constraint invite_codes_duration_check
  check (
    (purpose = 'signup' and duration_days = 7)
    or
    (purpose = 'renewal' and duration_days in (7,30,90,365))
  );

alter table public.invite_codes
  drop constraint if exists invite_codes_use_mode_check;
alter table public.invite_codes
  add constraint invite_codes_use_mode_check
  check (use_mode in ('single','multi'));

alter table public.invite_codes
  drop constraint if exists invite_codes_max_uses_check;
alter table public.invite_codes
  add constraint invite_codes_max_uses_check
  check (max_uses is null or max_uses > 0);

create unique index if not exists invite_redemptions_invite_user_unique
  on public.invite_redemptions(invite_id,user_id);

drop trigger if exists user_access_set_updated_at on public.user_access;
create trigger user_access_set_updated_at
before update on public.user_access
for each row execute function public.set_updated_at();

alter table public.user_access enable row level security;
alter table public.invite_codes enable row level security;
alter table public.invite_redemptions enable row level security;

drop policy if exists user_access_select_own on public.user_access;
create policy user_access_select_own
on public.user_access for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists invite_redemptions_select_own on public.invite_redemptions;
create policy invite_redemptions_select_own
on public.invite_redemptions for select to authenticated
using (user_id = (select auth.uid()));

-- 前端不能直接读取邀请码表，避免泄露管理信息。
revoke all on public.invite_codes from anon, authenticated;
grant select on public.user_access to authenticated;
grant select on public.invite_redemptions to authenticated;

create or replace function public.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.user_access ua
    where ua.user_id = auth.uid()
      and ua.valid_until > now()
  );
$$;

revoke all on function public.has_active_access() from public, anon;
grant execute on function public.has_active_access() to authenticated;

create or replace function public.get_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_access public.user_access%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'has_access',false,
      'valid_from',null,
      'valid_until',null,
      'days_left',0
    );
  end if;

  select *
  into v_access
  from public.user_access
  where user_id = auth.uid();

  if not found then
    return jsonb_build_object(
      'has_access',false,
      'valid_from',null,
      'valid_until',null,
      'days_left',0
    );
  end if;

  return jsonb_build_object(
    'has_access',v_access.valid_until > now(),
    'valid_from',v_access.valid_from,
    'valid_until',v_access.valid_until,
    'days_left',greatest(
      0,
      ceil(extract(epoch from (v_access.valid_until - now())) / 86400.0)
    )::integer
  );
end;
$$;

revoke all on function public.get_access_status() from public, anon;
grant execute on function public.get_access_status() to authenticated;

-- 注册时消费邀请码。只有 7 天 signup 码可以注册。
create or replace function public.handle_new_user_access()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_code text;
  v_hash text;
  v_invite public.invite_codes%rowtype;
  v_new_until timestamptz;
begin
  v_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code','')));

  if v_code = '' then
    raise exception '注册需要有效邀请码';
  end if;

  v_hash := encode(extensions.digest(v_code,'sha256'),'hex');

  update public.invite_codes ic
  set
    used_count = coalesce(ic.used_count,0) + 1,
    used_at = case when ic.use_mode = 'single' then now() else ic.used_at end,
    used_by = case when ic.use_mode = 'single' then new.id else ic.used_by end,
    is_active = case
      when ic.use_mode = 'single' then false
      when ic.max_uses is not null
       and coalesce(ic.used_count,0) + 1 >= ic.max_uses then false
      else true
    end
  where ic.code_hash = v_hash
    and ic.purpose = 'signup'
    and ic.duration_days = 7
    and ic.is_active = true
    and (ic.expires_at is null or ic.expires_at > now())
    and (
      (ic.use_mode = 'single' and ic.used_at is null)
      or
      (
        ic.use_mode = 'multi'
        and (ic.max_uses is null or coalesce(ic.used_count,0) < ic.max_uses)
      )
    )
  returning *
  into v_invite;

  if v_invite.id is null then
    raise exception '邀请码无效、已使用、已达使用上限或已过期';
  end if;

  v_new_until := now() + interval '7 days';

  insert into public.user_access(
    user_id,valid_from,valid_until,updated_at
  )
  values(
    new.id,now(),v_new_until,now()
  )
  on conflict(user_id) do update
  set
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    updated_at = now();

  insert into public.invite_redemptions(
    invite_id,user_id,purpose,duration_days,
    old_valid_until,new_valid_until
  )
  values(
    v_invite.id,new.id,'signup',7,
    null,v_new_until
  )
  on conflict(invite_id,user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_handle_new_user_access on auth.users;
create trigger trg_handle_new_user_access
after insert on auth.users
for each row execute function public.handle_new_user_access();

-- 已注册用户续费。
create or replace function public.redeem_renewal_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_invite public.invite_codes%rowtype;
  v_access public.user_access%rowtype;
  v_old_until timestamptz;
  v_base timestamptz;
  v_new_until timestamptz;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  v_hash := encode(
    extensions.digest(upper(trim(coalesce(p_code,''))),'sha256'),
    'hex'
  );

  if exists(
    select 1
    from public.invite_codes ic
    join public.invite_redemptions ir on ir.invite_id = ic.id
    where ic.code_hash = v_hash
      and ir.user_id = v_uid
  ) then
    return jsonb_build_object(
      'success',false,
      'reason','ALREADY_USED_BY_USER'
    );
  end if;

  update public.invite_codes ic
  set
    used_count = coalesce(ic.used_count,0) + 1,
    used_at = case when ic.use_mode = 'single' then now() else ic.used_at end,
    used_by = case when ic.use_mode = 'single' then v_uid else ic.used_by end,
    is_active = case
      when ic.use_mode = 'single' then false
      when ic.max_uses is not null
       and coalesce(ic.used_count,0) + 1 >= ic.max_uses then false
      else true
    end
  where ic.code_hash = v_hash
    and ic.purpose = 'renewal'
    and ic.duration_days in (7,30,90,365)
    and ic.is_active = true
    and (ic.expires_at is null or ic.expires_at > now())
    and (
      (ic.use_mode = 'single' and ic.used_at is null)
      or
      (
        ic.use_mode = 'multi'
        and (ic.max_uses is null or coalesce(ic.used_count,0) < ic.max_uses)
      )
    )
  returning *
  into v_invite;

  if v_invite.id is null then
    return jsonb_build_object(
      'success',false,
      'reason','INVALID_OR_USED'
    );
  end if;

  select *
  into v_access
  from public.user_access
  where user_id = v_uid
  for update;

  if not found then
    insert into public.user_access(user_id,valid_from,valid_until)
    values(v_uid,now(),now())
    returning * into v_access;
  end if;

  v_old_until := v_access.valid_until;
  v_base := case
    when v_access.valid_until > now() then v_access.valid_until
    else now()
  end;
  v_new_until := v_base + make_interval(days => v_invite.duration_days);

  update public.user_access
  set valid_until = v_new_until,
      updated_at = now()
  where user_id = v_uid;

  insert into public.invite_redemptions(
    invite_id,user_id,purpose,duration_days,
    old_valid_until,new_valid_until
  )
  values(
    v_invite.id,v_uid,'renewal',v_invite.duration_days,
    v_old_until,v_new_until
  );

  return jsonb_build_object(
    'success',true,
    'added_days',v_invite.duration_days,
    'valid_until',v_new_until
  );
end;
$$;

revoke all on function public.redeem_renewal_code(text) from public, anon;
grant execute on function public.redeem_renewal_code(text) to authenticated;

-- 仅供 Supabase SQL Editor / service role 创建邀请码。
-- 不开放给网页前端，所以普通用户不能自己生成邀请码。
create or replace function public.admin_create_invite_code(
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
set search_path = public, extensions
as $$
declare
  v_code text;
  v_hash text;
  v_id uuid;
  v_max integer;
begin
  p_purpose := lower(trim(coalesce(p_purpose,'')));
  p_use_mode := lower(trim(coalesce(p_use_mode,'single')));

  if p_purpose not in ('signup','renewal') then
    raise exception 'purpose 必须是 signup 或 renewal';
  end if;

  if p_purpose = 'signup' then
    p_duration_days := 7;
  elsif p_duration_days not in (7,30,90,365) then
    raise exception '续费仅支持 7 / 30 / 90 / 365 天';
  end if;

  if p_use_mode not in ('single','multi') then
    raise exception 'use_mode 必须是 single 或 multi';
  end if;

  v_max := case
    when p_use_mode = 'single' then 1
    else p_max_uses
  end;

  if v_max is not null and v_max < 1 then
    raise exception 'max_uses 必须大于 0';
  end if;

  loop
    v_code :=
      case when p_purpose='signup' then 'PLAY-S-' else 'PLAY-R-' end
      || upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,16));

    v_hash := encode(extensions.digest(v_code,'sha256'),'hex');

    begin
      insert into public.invite_codes(
        code_hash,label,purpose,duration_days,use_mode,
        max_uses,used_count,is_active,expires_at
      )
      values(
        v_hash,p_label,p_purpose,p_duration_days,p_use_mode,
        v_max,0,true,p_expires_at
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'success',true,
    'id',v_id,
    'code',v_code,
    'purpose',p_purpose,
    'duration_days',p_duration_days,
    'use_mode',p_use_mode,
    'max_uses',v_max,
    'expires_at',p_expires_at
  );
end;
$$;

revoke all on function public.admin_create_invite_code(text,integer,text,integer,text,timestamptz)
from public, anon, authenticated;

-- 到期后数据库层也停止业务数据读写；续费 RPC 和期限状态仍可使用。
drop policy if exists shops_select_authenticated on public.shops;
create policy shops_select_authenticated
on public.shops for select to authenticated
using (
  public.has_active_access()
  and (is_active = true or user_id = (select auth.uid()))
);

drop policy if exists shops_insert_own on public.shops;
create policy shops_insert_own
on public.shops for insert to authenticated
with check (
  public.has_active_access()
  and user_id = (select auth.uid())
);

drop policy if exists shops_update_own on public.shops;
create policy shops_update_own
on public.shops for update to authenticated
using (
  public.has_active_access()
  and user_id = (select auth.uid())
)
with check (
  public.has_active_access()
  and user_id = (select auth.uid())
);

drop policy if exists shops_delete_own on public.shops;
create policy shops_delete_own
on public.shops for delete to authenticated
using (
  public.has_active_access()
  and user_id = (select auth.uid())
);

drop policy if exists price_categories_select_authenticated on public.price_categories;
create policy price_categories_select_authenticated
on public.price_categories for select to authenticated
using (
  public.has_active_access()
  and (
    user_id = (select auth.uid())
    or (
      is_active = true
      and exists (
        select 1 from public.shops s
        where s.id = price_categories.shop_id
          and s.is_active = true
      )
    )
  )
);

drop policy if exists price_items_select_authenticated on public.price_items;
create policy price_items_select_authenticated
on public.price_items for select to authenticated
using (
  public.has_active_access()
  and (
    user_id = (select auth.uid())
    or (
      is_active = true
      and exists (
        select 1 from public.shops s
        where s.id = price_items.shop_id
          and s.is_active = true
      )
    )
  )
);

do $
declare
  t text;
begin
  foreach t in array array[
    'customers','consumption_records','report_templates',
    'receipt_settings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I',t||'_select_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_update_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete_own',t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_active_access() and user_id = (select auth.uid()))',
      t||'_select_own',t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_active_access() and user_id = (select auth.uid()))',
      t||'_insert_own',t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_active_access() and user_id = (select auth.uid())) with check (public.has_active_access() and user_id = (select auth.uid()))',
      t||'_update_own',t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_active_access() and user_id = (select auth.uid()))',
      t||'_delete_own',t
    );
  end loop;
end $;

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own
on public.user_profiles for select to authenticated
using (public.has_active_access() and user_id = (select auth.uid()));

drop policy if exists user_profiles_insert_own on public.user_profiles;
create policy user_profiles_insert_own
on public.user_profiles for insert to authenticated
with check (public.has_active_access() and user_id = (select auth.uid()));

drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own
on public.user_profiles for update to authenticated
using (public.has_active_access() and user_id = (select auth.uid()))
with check (public.has_active_access() and user_id = (select auth.uid()));

drop policy if exists user_profiles_delete_own on public.user_profiles;
create policy user_profiles_delete_own
on public.user_profiles for delete to authenticated
using (public.has_active_access() and user_id = (select auth.uid()));

drop policy if exists saved_shops_select_own on public.saved_shops;
create policy saved_shops_select_own
on public.saved_shops for select to authenticated
using (public.has_active_access() and user_id = (select auth.uid()));

drop policy if exists saved_shops_insert_own on public.saved_shops;
create policy saved_shops_insert_own
on public.saved_shops for insert to authenticated
with check (public.has_active_access() and user_id = (select auth.uid()));

drop policy if exists saved_shops_delete_own on public.saved_shops;
create policy saved_shops_delete_own
on public.saved_shops for delete to authenticated
using (public.has_active_access() and user_id = (select auth.uid()));

-- 价格表写入仍然只允许店铺创建者，且账号必须在有效期内。
drop policy if exists price_categories_insert_own on public.price_categories;
create policy price_categories_insert_own
on public.price_categories for insert to authenticated
with check (
  public.has_active_access()
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_categories.shop_id
      and s.user_id = (select auth.uid())
  )
);

drop policy if exists price_categories_update_own on public.price_categories;
create policy price_categories_update_own
on public.price_categories for update to authenticated
using (
  public.has_active_access()
  and user_id = (select auth.uid())
)
with check (
  public.has_active_access()
  and user_id = (select auth.uid())
);

drop policy if exists price_categories_delete_own on public.price_categories;
create policy price_categories_delete_own
on public.price_categories for delete to authenticated
using (
  public.has_active_access()
  and user_id = (select auth.uid())
);

drop policy if exists price_items_insert_own on public.price_items;
create policy price_items_insert_own
on public.price_items for insert to authenticated
with check (
  public.has_active_access()
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_items.shop_id
      and s.user_id = (select auth.uid())
  )
);

drop policy if exists price_items_update_own on public.price_items;
create policy price_items_update_own
on public.price_items for update to authenticated
using (
  public.has_active_access()
  and user_id = (select auth.uid())
)
with check (
  public.has_active_access()
  and user_id = (select auth.uid())
);

drop policy if exists price_items_delete_own on public.price_items;
create policy price_items_delete_own
on public.price_items for delete to authenticated
using (
  public.has_active_access()
  and user_id = (select auth.uid())
);

commit;


-- ============================================================
-- 跑完上面的主体后，可按需要在 SQL Editor 单独生成邀请码。
-- 生成结果里的 JSON "code" 就是要发给用户的邀请码。
-- ============================================================

-- 1) 生成一个一次性 7 天注册试用码：
-- select public.admin_create_invite_code(
--   'signup', 7, 'single', 1, '7天注册试用', null
-- );

-- 2) 生成一个一次性 7 天续费码：
-- select public.admin_create_invite_code(
--   'renewal', 7, 'single', 1, '续费7天', null
-- );

-- 3) 生成一个一次性 30 天续费码：
-- select public.admin_create_invite_code(
--   'renewal', 30, 'single', 1, '续费30天', null
-- );

-- 4) 生成一个一次性 90 天续费码：
-- select public.admin_create_invite_code(
--   'renewal', 90, 'single', 1, '续费90天', null
-- );

-- 5) 生成一个一次性 365 天续费码：
-- select public.admin_create_invite_code(
--   'renewal', 365, 'single', 1, '续费365天', null
-- );

-- 如果以后想做“通用码”，把 single 改成 multi，并把第 4 个参数改成使用次数，例如 100。
