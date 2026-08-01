create or replace function public.discard_pending_invoice_scan_item_atomic(
  p_scan_item_id uuid
)
returns table (
  deleted_scan_item_id uuid,
  batch_id uuid,
  storage_paths text[],
  remaining_pending_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_batch_id uuid;
  v_saved_expense_id uuid;
  v_storage_paths text[];
  v_remaining_pending_count integer;
  v_batch_item_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if p_scan_item_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_scan_item_id is required';
  end if;

  select i.batch_id, i.saved_expense_id
  into v_batch_id, v_saved_expense_id
  from public.invoice_scan_items i
  where i.id = p_scan_item_id
    and i.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Scan item not found for current user';
  end if;

  if v_saved_expense_id is not null then
    raise exception using
      errcode = '23514',
      message = 'Only pending scan items can be discarded';
  end if;

  select coalesce(array_agg(p.storage_path order by p.global_page_index, p.page_number), '{}'::text[])
  into v_storage_paths
  from public.invoice_scan_pages p
  where p.user_id = v_user_id
    and p.scan_item_id = p_scan_item_id;

  delete from public.invoice_scan_pages p
  where p.user_id = v_user_id
    and p.scan_item_id = p_scan_item_id;

  delete from public.invoice_scan_items i
  where i.user_id = v_user_id
    and i.id = p_scan_item_id
    and i.saved_expense_id is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'Pending scan item delete failed due to concurrent update';
  end if;

  select count(*)
  into v_batch_item_count
  from public.invoice_scan_items i
  where i.user_id = v_user_id
    and i.batch_id = v_batch_id;

  if v_batch_item_count = 0 then
    delete from public.invoice_scan_batches b
    where b.user_id = v_user_id
      and b.id = v_batch_id;
  end if;

  select count(*)
  into v_remaining_pending_count
  from public.invoice_scan_items i
  where i.user_id = v_user_id
    and i.saved_expense_id is null;

  return query
  select p_scan_item_id, v_batch_id, v_storage_paths, v_remaining_pending_count;
end;
$$;

revoke all on function public.discard_pending_invoice_scan_item_atomic(uuid) from public;
revoke all on function public.discard_pending_invoice_scan_item_atomic(uuid) from anon;
grant execute on function public.discard_pending_invoice_scan_item_atomic(uuid) to authenticated;
