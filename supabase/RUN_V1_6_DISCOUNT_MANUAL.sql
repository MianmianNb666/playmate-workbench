-- 陪玩工作台 V1.6：老板折扣 + 手动项目/单价
-- 整份复制到 Supabase SQL Editor -> Run

-- V1.6 老板折扣 + 手动项目/手动单价
-- 100 = 10折（不打折），90 = 9折，85 = 8.5折。

alter table public.customers
  add column if not exists discount_rate numeric(5,2) not null default 100;

alter table public.consumption_records
  add column if not exists original_amount numeric(12,2);

alter table public.consumption_records
  add column if not exists discount_rate_snapshot numeric(5,2) not null default 100;

update public.consumption_records
set original_amount = amount
where original_amount is null;

alter table public.customers
  drop constraint if exists customers_discount_rate_check;

alter table public.customers
  add constraint customers_discount_rate_check
  check (discount_rate >= 0 and discount_rate <= 100);

alter table public.consumption_records
  drop constraint if exists consumption_records_discount_rate_check;

alter table public.consumption_records
  add constraint consumption_records_discount_rate_check
  check (discount_rate_snapshot >= 0 and discount_rate_snapshot <= 100);
