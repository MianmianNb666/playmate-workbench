-- PaiMini: restore normal customer profile writes after wallet hardening.
-- The wallet hardening migration switched customers to column-level INSERT/UPDATE grants.
-- PostgREST write paths used by the calculator / multi-order flow can then fail with
-- "permission denied for table customers".
--
-- This migration restores table-level profile writes for authenticated users while
-- a BEFORE trigger keeps system-owned fields protected:
--   * user_id can never be changed by a browser client
--   * prepaid_balance can never be directly inserted/updated by a browser client
-- Security-definer wallet RPCs still run as the function owner, so legitimate
-- atomic prepaid changes continue to work.

begin;

create or replace function public.protect_customer_system_fields()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  -- Direct Supabase browser requests run as role "authenticated".
  -- Calls made inside SECURITY DEFINER wallet RPCs run as the function owner
  -- and are intentionally not rewritten here.
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.prepaid_balance := 0;
    elsif tg_op = 'UPDATE' then
      new.user_id := old.user_id;
      new.prepaid_balance := old.prepaid_balance;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_customer_system_fields_before_write
on public.customers;

create trigger protect_customer_system_fields_before_write
before insert or update on public.customers
for each row
execute function public.protect_customer_system_fields();

-- Restore normal PostgREST table writes. RLS still limits users to their own rows,
-- and the trigger above protects ownership / prepaid balance from direct writes.
grant insert, update on public.customers to authenticated;

commit;
