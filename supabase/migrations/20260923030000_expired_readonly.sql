-- 派Mini：邀请码到期后进入只读模式
-- 规则：已登录且存在 user_access 的账号，即使过期也可读取已有数据；所有业务写入仍要求有效期内。

-- get_access_status：过期账号仍允许进入主界面，但标记 read_only=true。
create or replace function public.get_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_access public.user_access%rowtype;
  v_active boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'has_access',false,
      'is_active',false,
      'read_only',false,
      'valid_from',null,
      'valid_until',null,
      'days_left',0
    );
  end if;

  select * into v_access
  from public.user_access
  where user_id = auth.uid();

  if not found then
    return jsonb_build_object(
      'has_access',false,
      'is_active',false,
      'read_only',false,
      'valid_from',null,
      'valid_until',null,
      'days_left',0
    );
  end if;

  v_active := v_access.valid_until > now();

  return jsonb_build_object(
    'has_access',true,
    'is_active',v_active,
    'read_only',not v_active,
    'valid_from',v_access.valid_from,
    'valid_until',v_access.valid_until,
    'days_left',greatest(
      0,
      ceil(extract(epoch from (v_access.valid_until - now())) / 86400.0)
    )::integer
  );
end;
$$;

revoke all on function public.get_access_status() from public, anon;
grant execute on function public.get_access_status() to authenticated;

-- ---------- 到期仍可读：店铺 / 价格表 ----------
drop policy if exists shops_select_authenticated on public.shops;
create policy shops_select_authenticated
on public.shops for select to authenticated
using (
  user_id = (select auth.uid())
  or (is_active = true and visibility = 'public')
);

drop policy if exists price_categories_select_authenticated on public.price_categories;
create policy price_categories_select_authenticated
on public.price_categories for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1 from public.shops s
      where s.id = price_categories.shop_id
        and s.is_active = true
        and s.visibility = 'public'
    )
  )
);

drop policy if exists price_items_select_authenticated on public.price_items;
create policy price_items_select_authenticated
on public.price_items for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    is_active = true
    and exists (
      select 1 from public.shops s
      where s.id = price_items.shop_id
        and s.is_active = true
        and s.visibility = 'public'
    )
  )
);

-- ---------- 到期仍可读：个人业务数据 ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','consumption_records','report_templates','receipt_settings',
    'customer_prepaid_ledger','customer_benefits','customer_benefit_ledger','wallet_presets'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );
  end loop;
end $$;

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own
on public.user_profiles for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists saved_shops_select_own on public.saved_shops;
create policy saved_shops_select_own
on public.saved_shops for select to authenticated
using (user_id = (select auth.uid()));

-- ---------- 新增的资金/权益表写入也必须在有效期内 ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'customer_prepaid_ledger','customer_benefits','customer_benefit_ledger','wallet_presets'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_active_access() and (select auth.uid()) = user_id)',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_active_access() and (select auth.uid()) = user_id) with check (public.has_active_access() and (select auth.uid()) = user_id)',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_active_access() and (select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end $$;

-- 额外保护资金/权益 RPC，避免过期账号直接调用函数绕过前端。
create or replace function public.assert_active_access()
returns void
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.has_active_access() then
    raise exception 'account_read_only_expired';
  end if;
end;
$$;

revoke all on function public.assert_active_access() from public, anon;
grant execute on function public.assert_active_access() to authenticated;
