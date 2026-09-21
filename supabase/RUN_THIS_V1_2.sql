-- 陪玩工作台 V1.2 一键初始化 / 升级
-- 整份复制到 Supabase SQL Editor 后点击 Run。
-- 已经执行过前半段也没关系。

-- 陪玩工作台 V1 核心数据库
-- 可重复执行。用于：店铺、价格表、老板/顾客、消费记录、报备模板、小票设置。

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  logo_url text,
  currency_symbol text not null default '¥',
  brand_color text not null default '#f47ea7',
  footer_text text not null default '谢谢喜欢，祝你今天也开心 ♡',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shops add column if not exists user_id uuid default auth.uid();
alter table public.shops add column if not exists logo_url text;
alter table public.shops add column if not exists currency_symbol text default '¥';
alter table public.shops add column if not exists brand_color text default '#f47ea7';
alter table public.shops add column if not exists footer_text text default '谢谢喜欢，祝你今天也开心 ♡';
alter table public.shops add column if not exists is_active boolean default true;
alter table public.shops add column if not exists created_at timestamptz default now();
alter table public.shops add column if not exists updated_at timestamptz default now();

create table if not exists public.price_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.price_categories add column if not exists user_id uuid default auth.uid();
alter table public.price_categories add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.price_categories add column if not exists sort_order integer default 0;
alter table public.price_categories add column if not exists is_active boolean default true;
alter table public.price_categories add column if not exists created_at timestamptz default now();
alter table public.price_categories add column if not exists updated_at timestamptz default now();

create table if not exists public.price_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  category_id uuid references public.price_categories(id) on delete set null,
  name text not null,
  unit_price numeric(12,2) not null default 0,
  unit_label text not null default '次',
  unit_minutes integer,
  allow_manual_price boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.price_items add column if not exists user_id uuid default auth.uid();
alter table public.price_items add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.price_items add column if not exists category_id uuid references public.price_categories(id) on delete set null;
alter table public.price_items add column if not exists unit_price numeric(12,2) default 0;
alter table public.price_items add column if not exists unit_label text default '次';
alter table public.price_items add column if not exists unit_minutes integer;
alter table public.price_items add column if not exists allow_manual_price boolean default false;
alter table public.price_items add column if not exists is_active boolean default true;
alter table public.price_items add column if not exists sort_order integer default 0;
alter table public.price_items add column if not exists notes text;
alter table public.price_items add column if not exists created_at timestamptz default now();
alter table public.price_items add column if not exists updated_at timestamptz default now();

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  contact text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers add column if not exists user_id uuid default auth.uid();
alter table public.customers add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.customers add column if not exists contact text;
alter table public.customers add column if not exists notes text;
alter table public.customers add column if not exists created_at timestamptz default now();
alter table public.customers add column if not exists updated_at timestamptz default now();

create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  template_text text not null default E'消费项目：{项目}\n陪陪：{陪陪}\n单价：{单价}/{单位}\n时长/数量：{时长}\n总价：{总价}\n累计消费：{累计消费}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.report_templates add column if not exists user_id uuid default auth.uid();
alter table public.report_templates add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.report_templates add column if not exists template_text text default E'消费项目：{项目}\n陪陪：{陪陪}\n单价：{单价}/{单位}\n时长/数量：{时长}\n总价：{总价}\n累计消费：{累计消费}';
alter table public.report_templates add column if not exists created_at timestamptz default now();
alter table public.report_templates add column if not exists updated_at timestamptz default now();

create table if not exists public.receipt_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  show_customer boolean not null default true,
  show_companion boolean not null default true,
  show_unit_price boolean not null default true,
  show_quantity boolean not null default true,
  show_total_spent boolean not null default true,
  show_note boolean not null default true,
  show_time boolean not null default true,
  show_logo boolean not null default true,
  show_footer boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.receipt_settings add column if not exists user_id uuid default auth.uid();
alter table public.receipt_settings add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.receipt_settings add column if not exists show_customer boolean default true;
alter table public.receipt_settings add column if not exists show_companion boolean default true;
alter table public.receipt_settings add column if not exists show_unit_price boolean default true;
alter table public.receipt_settings add column if not exists show_quantity boolean default true;
alter table public.receipt_settings add column if not exists show_total_spent boolean default true;
alter table public.receipt_settings add column if not exists show_note boolean default true;
alter table public.receipt_settings add column if not exists show_time boolean default true;
alter table public.receipt_settings add column if not exists show_logo boolean default true;
alter table public.receipt_settings add column if not exists show_footer boolean default true;
alter table public.receipt_settings add column if not exists created_at timestamptz default now();
alter table public.receipt_settings add column if not exists updated_at timestamptz default now();

create table if not exists public.consumption_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  item_id uuid references public.price_items(id) on delete set null,
  customer_name_snapshot text not null,
  item_name_snapshot text not null,
  companion_name text,
  unit_price_snapshot numeric(12,2) not null default 0,
  unit_label_snapshot text not null default '次',
  unit_minutes_snapshot integer,
  quantity numeric(12,4) not null default 1,
  duration_input text,
  amount numeric(12,2) not null default 0,
  previous_total numeric(12,2) not null default 0,
  new_total numeric(12,2) not null default 0,
  note text,
  report_text text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consumption_records add column if not exists user_id uuid default auth.uid();
alter table public.consumption_records add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.consumption_records add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.consumption_records add column if not exists item_id uuid references public.price_items(id) on delete set null;
alter table public.consumption_records add column if not exists customer_name_snapshot text;
alter table public.consumption_records add column if not exists item_name_snapshot text;
alter table public.consumption_records add column if not exists companion_name text;
alter table public.consumption_records add column if not exists unit_price_snapshot numeric(12,2) default 0;
alter table public.consumption_records add column if not exists unit_label_snapshot text default '次';
alter table public.consumption_records add column if not exists unit_minutes_snapshot integer;
alter table public.consumption_records add column if not exists quantity numeric(12,4) default 1;
alter table public.consumption_records add column if not exists duration_input text;
alter table public.consumption_records add column if not exists amount numeric(12,2) default 0;
alter table public.consumption_records add column if not exists previous_total numeric(12,2) default 0;
alter table public.consumption_records add column if not exists new_total numeric(12,2) default 0;
alter table public.consumption_records add column if not exists note text;
alter table public.consumption_records add column if not exists report_text text;
alter table public.consumption_records add column if not exists occurred_at timestamptz default now();
alter table public.consumption_records add column if not exists created_at timestamptz default now();
alter table public.consumption_records add column if not exists updated_at timestamptz default now();

create unique index if not exists customers_user_shop_name_uidx
  on public.customers(user_id, shop_id, name);
create unique index if not exists report_templates_user_shop_uidx
  on public.report_templates(user_id, shop_id);
create unique index if not exists receipt_settings_user_shop_uidx
  on public.receipt_settings(user_id, shop_id);
create index if not exists price_categories_user_shop_idx
  on public.price_categories(user_id, shop_id, sort_order);
create index if not exists price_items_user_shop_idx
  on public.price_items(user_id, shop_id, is_active, sort_order);
create index if not exists records_user_shop_time_idx
  on public.consumption_records(user_id, shop_id, occurred_at desc);
create index if not exists records_customer_idx
  on public.consumption_records(user_id, customer_id, occurred_at desc);

drop trigger if exists shops_set_updated_at on public.shops;
create trigger shops_set_updated_at before update on public.shops
for each row execute function public.set_updated_at();

drop trigger if exists price_categories_set_updated_at on public.price_categories;
create trigger price_categories_set_updated_at before update on public.price_categories
for each row execute function public.set_updated_at();

drop trigger if exists price_items_set_updated_at on public.price_items;
create trigger price_items_set_updated_at before update on public.price_items
for each row execute function public.set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists report_templates_set_updated_at on public.report_templates;
create trigger report_templates_set_updated_at before update on public.report_templates
for each row execute function public.set_updated_at();

drop trigger if exists receipt_settings_set_updated_at on public.receipt_settings;
create trigger receipt_settings_set_updated_at before update on public.receipt_settings
for each row execute function public.set_updated_at();

drop trigger if exists consumption_records_set_updated_at on public.consumption_records;
create trigger consumption_records_set_updated_at before update on public.consumption_records
for each row execute function public.set_updated_at();

alter table public.shops enable row level security;
alter table public.price_categories enable row level security;
alter table public.price_items enable row level security;
alter table public.customers enable row level security;
alter table public.consumption_records enable row level security;
alter table public.report_templates enable row level security;
alter table public.receipt_settings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'shops','price_categories','price_items','customers',
    'consumption_records','report_templates','receipt_settings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.shops,
  public.price_categories,
  public.price_items,
  public.customers,
  public.consumption_records,
  public.report_templates,
  public.receipt_settings
to authenticated;


-- ============================================================
-- V1.2 公开店铺价目表 + 个人主页
-- ============================================================

-- V1.1: 公开店铺价目表 + 派单个人隐私 + 主页个人资料
-- 规则：
-- 1) 登录用户都能看到启用中的店铺和公开价目表。
-- 2) 只有店铺创建者可以修改店铺/分类/价格项目。
-- 3) 老板、累计消费、派单记录、报备模板、小票设置仍然只属于当前派单本人。
-- 4) 增加常用店铺与个人主页资料（昵称/头像/给自己说的话）。

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '今天也要开心',
  avatar_url text,
  home_message text not null default '今天也要轻松一点，慢慢来就很好 ♡',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists display_name text default '今天也要开心';
alter table public.user_profiles add column if not exists avatar_url text;
alter table public.user_profiles add column if not exists home_message text default '今天也要轻松一点，慢慢来就很好 ♡';
alter table public.user_profiles add column if not exists created_at timestamptz default now();
alter table public.user_profiles add column if not exists updated_at timestamptz default now();

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_select_own on public.user_profiles;
drop policy if exists user_profiles_insert_own on public.user_profiles;
drop policy if exists user_profiles_update_own on public.user_profiles;
drop policy if exists user_profiles_delete_own on public.user_profiles;

create policy user_profiles_select_own
on public.user_profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy user_profiles_insert_own
on public.user_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy user_profiles_update_own
on public.user_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_profiles_delete_own
on public.user_profiles for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_profiles to authenticated;

create table if not exists public.saved_shops (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

alter table public.saved_shops enable row level security;

drop policy if exists saved_shops_select_own on public.saved_shops;
drop policy if exists saved_shops_insert_own on public.saved_shops;
drop policy if exists saved_shops_delete_own on public.saved_shops;

create policy saved_shops_select_own
on public.saved_shops for select to authenticated
using ((select auth.uid()) = user_id);

create policy saved_shops_insert_own
on public.saved_shops for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy saved_shops_delete_own
on public.saved_shops for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, delete on public.saved_shops to authenticated;

-- 店铺：所有登录用户可以看到启用店铺；创建者还能看到自己停用的店铺。
drop policy if exists shops_select_own on public.shops;
drop policy if exists shops_select_authenticated on public.shops;
create policy shops_select_authenticated
on public.shops for select to authenticated
using (is_active = true or user_id = (select auth.uid()));

-- 店铺本身仍然只允许创建者增删改。
drop policy if exists shops_insert_own on public.shops;
drop policy if exists shops_update_own on public.shops;
drop policy if exists shops_delete_own on public.shops;

create policy shops_insert_own
on public.shops for insert to authenticated
with check (user_id = (select auth.uid()));

create policy shops_update_own
on public.shops for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy shops_delete_own
on public.shops for delete to authenticated
using (user_id = (select auth.uid()));

-- 分类：店主看全部；其他登录用户只看启用分类。
drop policy if exists price_categories_select_own on public.price_categories;
drop policy if exists price_categories_select_authenticated on public.price_categories;
create policy price_categories_select_authenticated
on public.price_categories for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1
      from public.shops s
      where s.id = price_categories.shop_id
        and s.is_active = true
    )
  )
);

drop policy if exists price_categories_insert_own on public.price_categories;
drop policy if exists price_categories_update_own on public.price_categories;
drop policy if exists price_categories_delete_own on public.price_categories;

create policy price_categories_insert_own
on public.price_categories for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_categories.shop_id
      and s.user_id = (select auth.uid())
  )
);

create policy price_categories_update_own
on public.price_categories for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_categories.shop_id
      and s.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_categories.shop_id
      and s.user_id = (select auth.uid())
  )
);

create policy price_categories_delete_own
on public.price_categories for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_categories.shop_id
      and s.user_id = (select auth.uid())
  )
);

-- 项目：店主看全部；其他登录用户只看启用项目。
drop policy if exists price_items_select_own on public.price_items;
drop policy if exists price_items_select_authenticated on public.price_items;
create policy price_items_select_authenticated
on public.price_items for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1
      from public.shops s
      where s.id = price_items.shop_id
        and s.is_active = true
    )
  )
);

drop policy if exists price_items_insert_own on public.price_items;
drop policy if exists price_items_update_own on public.price_items;
drop policy if exists price_items_delete_own on public.price_items;

create policy price_items_insert_own
on public.price_items for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_items.shop_id
      and s.user_id = (select auth.uid())
  )
);

create policy price_items_update_own
on public.price_items for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_items.shop_id
      and s.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_items.shop_id
      and s.user_id = (select auth.uid())
  )
);

create policy price_items_delete_own
on public.price_items for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.shops s
    where s.id = price_items.shop_id
      and s.user_id = (select auth.uid())
  )
);

-- Avatar bucket：用户只能写自己 user_id 文件夹；图片可直接显示在主页。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_public_read
on storage.objects for select
using (bucket_id = 'avatars');

create policy avatars_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy avatars_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy avatars_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);



-- ============================================================
-- V1.3 老板留言 + 老板完整流水导出
-- ============================================================

alter table public.receipt_settings
  add column if not exists boss_message text
  default '谢谢支持，祝你今天也开心 ♡';

update public.receipt_settings
set boss_message = '谢谢支持，祝你今天也开心 ♡'
where boss_message is null;
