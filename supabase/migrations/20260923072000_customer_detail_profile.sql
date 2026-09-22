-- 派Mini：顾客详情扩展字段
-- 仅补充老板个人资料字段，不改变现有顾客、预存、消费记录逻辑。

alter table public.customers
  add column if not exists birthday date,
  add column if not exists region text,
  add column if not exists preferences text;

-- 20260923041000_boss_wallet_profile_hardening.sql 曾把 customers 改成列级写权限，
-- 因此新字段需要单独补授权。
grant insert (birthday, region, preferences) on public.customers to authenticated;
grant update (birthday, region, preferences) on public.customers to authenticated;
