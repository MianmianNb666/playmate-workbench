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
