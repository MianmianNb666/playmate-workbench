-- PaiMini shop recycle bin / soft delete
-- Keeps all shop-linked rows intact. Client-side permanent DELETE on shops is disabled.

alter table public.shops
  add column if not exists deleted_at timestamptz;

alter table public.shops
  add column if not exists deleted_was_active boolean;

create index if not exists shops_deleted_at_idx
  on public.shops(deleted_at);

-- Older clients must no longer be able to hard-delete a shop and trigger CASCADE.
drop policy if exists shops_delete_own on public.shops;
revoke delete on public.shops from authenticated;

-- Keep select/update access unchanged:
-- owners can still see their own deleted rows, while the frontend hides them
-- from normal shop lists and shows them only in the recycle bin.
