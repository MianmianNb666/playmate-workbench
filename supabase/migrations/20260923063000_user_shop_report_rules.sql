create table if not exists public.user_shop_report_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  team_pct numeric(6,2) not null default 0 check (team_pct >= 0 and team_pct <= 100),
  dispatch_pct numeric(6,2) not null default 0 check (dispatch_pct >= 0 and dispatch_pct <= 100),
  takehome_pct numeric(6,2) not null default 100 check (takehome_pct >= 0 and takehome_pct <= 100),
  auto_takehome boolean not null default true,
  default_source text,
  updated_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

alter table public.user_shop_report_rules enable row level security;

drop policy if exists "report_rules_select_own" on public.user_shop_report_rules;
create policy "report_rules_select_own"
on public.user_shop_report_rules
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "report_rules_insert_own" on public.user_shop_report_rules;
create policy "report_rules_insert_own"
on public.user_shop_report_rules
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.shops s
    where s.id = shop_id
      and (
        s.user_id = auth.uid()
        or exists (
          select 1 from public.shop_members m
          where m.shop_id = s.id
            and m.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "report_rules_update_own" on public.user_shop_report_rules;
create policy "report_rules_update_own"
on public.user_shop_report_rules
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "report_rules_delete_own" on public.user_shop_report_rules;
create policy "report_rules_delete_own"
on public.user_shop_report_rules
for delete
to authenticated
using (user_id = auth.uid());

create index if not exists user_shop_report_rules_shop_idx
  on public.user_shop_report_rules(shop_id);
