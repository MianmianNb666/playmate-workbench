-- Robot multi-owner / multi-shop gateway for PaiMini.
-- Additive only: no existing order, wallet, shop, login or access-control logic is changed.
-- One Windows robot can route many WeChat groups to different owner/shop bindings.

create extension if not exists pgcrypto;

create table if not exists public.bot_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bot_pairing_codes_owner_shop_idx
  on public.bot_pairing_codes(owner_user_id, shop_id, created_at desc);

alter table public.bot_pairing_codes enable row level security;

drop policy if exists "bot_pairing_codes_owner_select" on public.bot_pairing_codes;
create policy "bot_pairing_codes_owner_select"
on public.bot_pairing_codes
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "bot_pairing_codes_owner_delete" on public.bot_pairing_codes;
create policy "bot_pairing_codes_owner_delete"
on public.bot_pairing_codes
for delete
to authenticated
using (owner_user_id = auth.uid());

grant select, delete on public.bot_pairing_codes to authenticated;

create table if not exists public.bot_machine_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  secret_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.bot_machine_keys enable row level security;
revoke all on public.bot_machine_keys from anon, authenticated;

create or replace function public.create_bot_machine_key(p_label text default 'wechat-robot')
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret text;
begin
  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.bot_machine_keys(label, secret_hash)
  values (
    coalesce(nullif(trim(p_label),''),'wechat-robot'),
    encode(digest(v_secret, 'sha256'),'hex')
  );

  return v_secret;
end;
$$;

revoke all on function public.create_bot_machine_key(text) from public, anon, authenticated;

create or replace function public.bot_machine_key_valid(p_machine_key text)
returns boolean
language sql
security definer
stable
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1
    from public.bot_machine_keys k
    where k.enabled = true
      and k.secret_hash = encode(digest(coalesce(p_machine_key,''), 'sha256'),'hex')
  );
$$;

revoke all on function public.bot_machine_key_valid(text) from public, anon, authenticated;

create or replace function public.create_bot_pairing_code(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
  v_try int := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.shops s
    where s.id = p_shop_id
      and s.user_id = v_user
      and s.deleted_at is null
  ) then
    raise exception 'SHOP_NOT_OWNED';
  end if;

  delete from public.bot_pairing_codes
  where owner_user_id = v_user
    and shop_id = p_shop_id
    and used_at is null;

  loop
    v_try := v_try + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    begin
      insert into public.bot_pairing_codes(owner_user_id, shop_id, code, expires_at)
      values (v_user, p_shop_id, v_code, v_expires);
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  return jsonb_build_object(
    'code', v_code,
    'expires_at', v_expires,
    'shop_id', p_shop_id
  );
end;
$$;

revoke all on function public.create_bot_pairing_code(uuid) from public;
grant execute on function public.create_bot_pairing_code(uuid) to authenticated;

create or replace function public.consume_bot_pairing_code(
  p_machine_key text,
  p_code text,
  p_channel_external_id text,
  p_channel_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_pair public.bot_pairing_codes%rowtype;
  v_binding public.bot_bindings%rowtype;
  v_existing_count int;
begin
  if not public.bot_machine_key_valid(p_machine_key) then
    raise exception 'BOT_MACHINE_UNAUTHORIZED';
  end if;

  if nullif(trim(p_channel_external_id),'') is null then
    raise exception 'CHANNEL_ID_REQUIRED';
  end if;

  select *
  into v_pair
  from public.bot_pairing_codes
  where code = upper(trim(p_code))
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    return jsonb_build_object('success',false,'reason','INVALID_OR_EXPIRED_CODE');
  end if;

  select count(*)
  into v_existing_count
  from public.bot_bindings
  where channel_type='wechat_group'
    and channel_external_id=trim(p_channel_external_id)
    and not (
      owner_user_id=v_pair.owner_user_id
      and shop_id=v_pair.shop_id
    );

  if v_existing_count > 0 then
    return jsonb_build_object(
      'success',false,
      'reason','GROUP_ALREADY_BOUND',
      'message','这个微信群已经绑定到其他店铺，请先解除旧绑定。'
    );
  end if;

  insert into public.bot_bindings(
    owner_user_id,
    shop_id,
    channel_type,
    channel_external_id,
    channel_name,
    enabled,
    updated_at
  )
  values (
    v_pair.owner_user_id,
    v_pair.shop_id,
    'wechat_group',
    trim(p_channel_external_id),
    nullif(trim(coalesce(p_channel_name,'')),''),
    true,
    now()
  )
  on conflict (owner_user_id, channel_type, channel_external_id)
  do update set
    shop_id=excluded.shop_id,
    channel_name=coalesce(excluded.channel_name, public.bot_bindings.channel_name),
    enabled=true,
    updated_at=now()
  returning * into v_binding;

  update public.bot_pairing_codes
  set used_at=now()
  where id=v_pair.id;

  update public.bot_machine_keys
  set last_used_at=now()
  where enabled=true
    and secret_hash=encode(digest(coalesce(p_machine_key,''),'sha256'),'hex');

  return jsonb_build_object(
    'success',true,
    'binding_id',v_binding.id,
    'owner_user_id',v_binding.owner_user_id,
    'shop_id',v_binding.shop_id,
    'channel_external_id',v_binding.channel_external_id,
    'channel_name',v_binding.channel_name
  );
end;
$$;

revoke all on function public.consume_bot_pairing_code(text,text,text,text) from public;
grant execute on function public.consume_bot_pairing_code(text,text,text,text) to anon, authenticated;

create or replace function public.resolve_bot_binding(
  p_machine_key text,
  p_channel_external_id text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_count int;
  v_binding public.bot_bindings%rowtype;
begin
  if not public.bot_machine_key_valid(p_machine_key) then
    raise exception 'BOT_MACHINE_UNAUTHORIZED';
  end if;

  select count(*)
  into v_count
  from public.bot_bindings
  where channel_type='wechat_group'
    and channel_external_id=trim(p_channel_external_id);

  if v_count=0 then
    return jsonb_build_object('bound',false);
  end if;

  if v_count>1 then
    return jsonb_build_object(
      'bound',false,
      'reason','AMBIGUOUS_BINDING',
      'message','这个微信群存在重复绑定，请管理员处理。'
    );
  end if;

  select *
  into v_binding
  from public.bot_bindings
  where channel_type='wechat_group'
    and channel_external_id=trim(p_channel_external_id)
  limit 1;

  return jsonb_build_object(
    'bound',true,
    'enabled',v_binding.enabled,
    'binding_id',v_binding.id,
    'owner_user_id',v_binding.owner_user_id,
    'shop_id',v_binding.shop_id,
    'channel_name',v_binding.channel_name
  );
end;
$$;

revoke all on function public.resolve_bot_binding(text,text) from public;
grant execute on function public.resolve_bot_binding(text,text) to anon, authenticated;

create or replace function public.robot_create_draft(
  p_machine_key text,
  p_channel_external_id text,
  p_channel_name text,
  p_message_key text,
  p_raw_message text,
  p_customer_name text,
  p_companion_name text,
  p_item_name text,
  p_measure text,
  p_parsed_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_binding public.bot_bindings%rowtype;
  v_count int;
  v_message_id uuid;
  v_draft_id uuid;
begin
  if not public.bot_machine_key_valid(p_machine_key) then
    raise exception 'BOT_MACHINE_UNAUTHORIZED';
  end if;

  select count(*)
  into v_count
  from public.bot_bindings
  where channel_type='wechat_group'
    and channel_external_id=trim(p_channel_external_id);

  if v_count<>1 then
    return jsonb_build_object(
      'success',false,
      'reason',case when v_count=0 then 'NOT_BOUND' else 'AMBIGUOUS_BINDING' end
    );
  end if;

  select *
  into v_binding
  from public.bot_bindings
  where channel_type='wechat_group'
    and channel_external_id=trim(p_channel_external_id)
  limit 1;

  if not v_binding.enabled then
    return jsonb_build_object('success',false,'reason','BINDING_PAUSED');
  end if;

  insert into public.bot_messages(
    owner_user_id,
    shop_id,
    binding_id,
    source_type,
    source_channel_id,
    source_channel_name,
    raw_message,
    message_key,
    parse_status,
    parsed_payload
  )
  values (
    v_binding.owner_user_id,
    v_binding.shop_id,
    v_binding.id,
    'wechat',
    trim(p_channel_external_id),
    nullif(trim(coalesce(p_channel_name,'')),''),
    p_raw_message,
    p_message_key,
    'parsed',
    coalesce(p_parsed_payload,'{}'::jsonb)
  )
  on conflict (owner_user_id, message_key)
  do update set
    raw_message=excluded.raw_message,
    parsed_payload=excluded.parsed_payload
  returning id into v_message_id;

  insert into public.bot_drafts(
    owner_user_id,
    shop_id,
    message_id,
    customer_name,
    companion_name,
    item_name,
    measure,
    raw_message,
    source_channel_name,
    metadata,
    status
  )
  values (
    v_binding.owner_user_id,
    v_binding.shop_id,
    v_message_id,
    nullif(trim(coalesce(p_customer_name,'')),''),
    nullif(trim(coalesce(p_companion_name,'')),''),
    coalesce(nullif(trim(coalesce(p_item_name,'')),''),'未命名项目'),
    nullif(trim(coalesce(p_measure,'')),''),
    p_raw_message,
    nullif(trim(coalesce(p_channel_name,'')),''),
    jsonb_build_object(
      'source','wechat_robot',
      'binding_id',v_binding.id,
      'channel_external_id',v_binding.channel_external_id
    ),
    'pending'
  )
  returning id into v_draft_id;

  update public.bot_machine_keys
  set last_used_at=now()
  where enabled=true
    and secret_hash=encode(digest(coalesce(p_machine_key,''),'sha256'),'hex');

  return jsonb_build_object(
    'success',true,
    'draft_id',v_draft_id,
    'message_id',v_message_id,
    'owner_user_id',v_binding.owner_user_id,
    'shop_id',v_binding.shop_id,
    'binding_id',v_binding.id
  );
end;
$$;

revoke all on function public.robot_create_draft(text,text,text,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.robot_create_draft(text,text,text,text,text,text,text,text,text,jsonb) to anon, authenticated;
