-- PaiMini save-path hardening: prepaid presets + prepaid RPC + report rules.
-- Safe to run more than once.

begin;

-- Prepaid preset table must be writable by active authenticated owners.
alter table public.wallet_presets
  add column if not exists bundled_benefits jsonb not null default '[]'::jsonb;

revoke all on public.wallet_presets from anon, authenticated;
grant select, insert, update, delete on public.wallet_presets to authenticated;

alter table public.wallet_presets enable row level security;

drop policy if exists wallet_presets_select_own on public.wallet_presets;
create policy wallet_presets_select_own
on public.wallet_presets for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists wallet_presets_insert_own on public.wallet_presets;
create policy wallet_presets_insert_own
on public.wallet_presets for insert to authenticated
with check (
  public.has_active_access()
  and (select auth.uid()) = user_id
  and public.is_shop_owner(shop_id)
);

drop policy if exists wallet_presets_update_own on public.wallet_presets;
create policy wallet_presets_update_own
on public.wallet_presets for update to authenticated
using (
  public.has_active_access()
  and (select auth.uid()) = user_id
)
with check (
  public.has_active_access()
  and (select auth.uid()) = user_id
  and public.is_shop_owner(shop_id)
);

drop policy if exists wallet_presets_delete_own on public.wallet_presets;
create policy wallet_presets_delete_own
on public.wallet_presets for delete to authenticated
using (
  public.has_active_access()
  and (select auth.uid()) = user_id
);

-- Report rules: explicitly grant Data API access and keep rows private per user.
create table if not exists public.user_shop_report_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  team_pct numeric(6,2) not null default 0,
  dispatch_pct numeric(6,2) not null default 0,
  takehome_pct numeric(6,2) not null default 100,
  auto_takehome boolean not null default true,
  default_source text,
  updated_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

revoke all on public.user_shop_report_rules from anon, authenticated;
grant select, insert, update, delete on public.user_shop_report_rules to authenticated;
alter table public.user_shop_report_rules enable row level security;

drop policy if exists report_rules_select_own on public.user_shop_report_rules;
create policy report_rules_select_own
on public.user_shop_report_rules for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists report_rules_insert_own on public.user_shop_report_rules;
create policy report_rules_insert_own
on public.user_shop_report_rules for insert to authenticated
with check (
  public.has_active_access()
  and (select auth.uid()) = user_id
  and (public.is_shop_owner(shop_id) or public.is_shop_member(shop_id))
);

drop policy if exists report_rules_update_own on public.user_shop_report_rules;
create policy report_rules_update_own
on public.user_shop_report_rules for update to authenticated
using (
  public.has_active_access()
  and (select auth.uid()) = user_id
)
with check (
  public.has_active_access()
  and (select auth.uid()) = user_id
  and (public.is_shop_owner(shop_id) or public.is_shop_member(shop_id))
);

drop policy if exists report_rules_delete_own on public.user_shop_report_rules;
create policy report_rules_delete_own
on public.user_shop_report_rules for delete to authenticated
using (
  public.has_active_access()
  and (select auth.uid()) = user_id
);

-- Re-grant the secure prepaid RPCs after hardening migrations.
grant execute on function public.adjust_customer_prepaid(uuid,numeric,text,text,uuid) to authenticated;
grant execute on function public.adjust_customer_benefit(uuid,text,numeric,text,text,timestamptz,text,uuid) to authenticated;
grant execute on function public.apply_prepaid_package(uuid,uuid) to authenticated;
grant execute on function public.apply_custom_prepaid_package(uuid,uuid,numeric,jsonb,text) to authenticated;

commit;
