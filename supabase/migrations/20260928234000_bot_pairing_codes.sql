-- PaiMini Robot pairing codes
-- Boss logs into PaiMini, generates a short-lived code for the current shop,
-- then sends "绑定 CODE" in the target WeChat group.

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
      if v_try >= 5 then
        raise;
      end if;
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
