create or replace function public.delete_expense_atomic(
  p_expense_id uuid
)
returns table (
  deleted_expense_id uuid,
  storage_paths text[]
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_storage_paths text[];
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if p_expense_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_expense_id is required';
  end if;

  perform 1
  from public.expenses e
  where e.id = p_expense_id
    and e.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Expense not found for current user';
  end if;

  select coalesce(array_agg(d.storage_path order by d.page_number), '{}'::text[])
  into v_storage_paths
  from public.expense_documents d
  where d.user_id = v_user_id
    and d.expense_id = p_expense_id;

  delete from public.expense_documents d
  where d.user_id = v_user_id
    and d.expense_id = p_expense_id;

  delete from public.expenses e
  where e.id = p_expense_id
    and e.user_id = v_user_id;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'Expense delete failed due to concurrent update';
  end if;

  return query
  select p_expense_id, v_storage_paths;
end;
$$;

revoke all on function public.delete_expense_atomic(uuid) from public;
revoke all on function public.delete_expense_atomic(uuid) from anon;
grant execute on function public.delete_expense_atomic(uuid) to authenticated;
