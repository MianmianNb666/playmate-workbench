-- Robot module foundation for 派Mini
-- Isolated bot_* tables so this feature can be migrated out later.

create table if not exists public.bot_bindings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  channel_type text not null default 'wechat_group',
  channel_external_id text not null,
  channel_name text,
  target_type text not null default 'paimini',
  target_endpoint text,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, channel_type, channel_external_id)
);

create table if not exists public.bot_messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete set null,
  binding_id uuid references public.bot_bindings(id) on delete set null,
  source_type text not null default 'wechat',
  source_channel_id text,
  source_channel_name text,
  sender_external_id text,
  sender_name text,
  raw_message text not null,
  message_key text,
  parse_status text not null default 'received',
  parsed_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_user_id, message_key)
);

create table if not exists public.bot_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  message_id uuid references public.bot_messages(id) on delete set null,
  customer_name text,
  companion_name text,
  item_name text not null,
  matched_item_id uuid references public.price_items(id) on delete set null,
  measure text,
  note text,
  raw_message text,
  source_channel_name text,
  expected_total numeric(14,2),
  matched_unit_price numeric(14,2),
  matched_unit_label text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','loaded','ignored','saved')),
  created_at timestamptz not null default now(),
  loaded_at timestamptz,
  ignored_at timestamptz,
  saved_at timestamptz
);

create index if not exists bot_bindings_owner_shop_idx
  on public.bot_bindings(owner_user_id, shop_id, enabled);

create index if not exists bot_messages_owner_shop_created_idx
  on public.bot_messages(owner_user_id, shop_id, created_at desc);

create index if not exists bot_drafts_owner_shop_status_idx
  on public.bot_drafts(owner_user_id, shop_id, status, created_at desc);

alter table public.bot_bindings enable row level security;
alter table public.bot_messages enable row level security;
alter table public.bot_drafts enable row level security;

drop policy if exists "bot_bindings_owner_all" on public.bot_bindings;
create policy "bot_bindings_owner_all"
on public.bot_bindings
for all
to authenticated
using (owner_user_id = auth.uid())
with check (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.shops s
    where s.id = shop_id and s.user_id = auth.uid()
  )
);

drop policy if exists "bot_messages_owner_all" on public.bot_messages;
create policy "bot_messages_owner_all"
on public.bot_messages
for all
to authenticated
using (owner_user_id = auth.uid())
with check (
  owner_user_id = auth.uid()
  and (
    shop_id is null
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  )
);

drop policy if exists "bot_drafts_owner_all" on public.bot_drafts;
create policy "bot_drafts_owner_all"
on public.bot_drafts
for all
to authenticated
using (owner_user_id = auth.uid())
with check (
  owner_user_id = auth.uid()
  and exists (
    select 1 from public.shops s
    where s.id = shop_id and s.user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.bot_bindings to authenticated;
grant select, insert, update, delete on public.bot_messages to authenticated;
grant select, insert, update, delete on public.bot_drafts to authenticated;
