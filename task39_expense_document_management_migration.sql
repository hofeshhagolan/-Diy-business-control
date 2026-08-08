-- Task 39 migration artifact (review-only; do not execute in this environment)

create or replace function public.update_expense_documents_atomic(
  p_expense_id uuid,
  p_replacements jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_deleted_document_ids uuid[] default '{}'::uuid[]
)
returns table (
  storage_paths text[]
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_item jsonb;
  v_document_id uuid;
  v_storage_path text;
  v_original_filename text;
  v_mime_type text;
  v_document_type text;
  v_page_number integer;
  v_old_storage_path text;
  v_storage_paths text[] := '{}'::text[];
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

  if jsonb_typeof(coalesce(p_replacements, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_additions, '[]'::jsonb)) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Document changes must be JSON arrays';
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

  for v_item in
    select value from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb))
  loop
    begin
      v_document_id := (v_item ->> 'document_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Replacement document_id must be uuid';
    end;

    if v_document_id = any(coalesce(p_deleted_document_ids, '{}'::uuid[])) then
      raise exception using
        errcode = '22023',
        message = 'A document cannot be replaced and deleted together';
    end if;

    v_storage_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_original_filename := btrim(coalesce(v_item ->> 'original_filename', ''));
    v_mime_type := btrim(coalesce(v_item ->> 'mime_type', ''));
    v_document_type := btrim(coalesce(v_item ->> 'document_type', ''));

    if v_storage_path = '' or v_original_filename = '' or v_mime_type = ''
      or v_document_type not in ('pdf', 'image') then
      raise exception using
        errcode = '22023',
        message = 'Replacement document metadata is invalid';
    end if;

    select d.storage_path
    into v_old_storage_path
    from public.expense_documents d
    where d.id = v_document_id
      and d.expense_id = p_expense_id
      and d.user_id = v_user_id
    for update;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'Replacement document not found for current expense';
    end if;

    update public.expense_documents d
    set
      storage_path = v_storage_path,
      original_filename = v_original_filename,
      mime_type = v_mime_type,
      document_type = v_document_type,
      generated_by_app = false
    where d.id = v_document_id
      and d.expense_id = p_expense_id
      and d.user_id = v_user_id;

    v_storage_paths := array_append(v_storage_paths, v_old_storage_path);
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_additions, '[]'::jsonb))
  loop
    v_storage_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_original_filename := btrim(coalesce(v_item ->> 'original_filename', ''));
    v_mime_type := btrim(coalesce(v_item ->> 'mime_type', ''));
    v_document_type := btrim(coalesce(v_item ->> 'document_type', ''));

    begin
      v_page_number := (v_item ->> 'page_number')::integer;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Addition page_number must be integer';
    end;

    if v_storage_path = '' or v_original_filename = '' or v_mime_type = ''
      or v_document_type not in ('pdf', 'image') or v_page_number < 1 then
      raise exception using
        errcode = '22023',
        message = 'Addition document metadata is invalid';
    end if;

    insert into public.expense_documents (
      user_id,
      expense_id,
      storage_path,
      original_filename,
      mime_type,
      page_number,
      document_type,
      generated_by_app
    ) values (
      v_user_id,
      p_expense_id,
      v_storage_path,
      v_original_filename,
      v_mime_type,
      v_page_number,
      v_document_type,
      false
    );
  end loop;

  foreach v_document_id in array coalesce(p_deleted_document_ids, '{}'::uuid[])
  loop
    select d.storage_path
    into v_old_storage_path
    from public.expense_documents d
    where d.id = v_document_id
      and d.expense_id = p_expense_id
      and d.user_id = v_user_id
    for update;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'Deleted document not found for current expense';
    end if;

    delete from public.expense_documents d
    where d.id = v_document_id
      and d.expense_id = p_expense_id
      and d.user_id = v_user_id;

    v_storage_paths := array_append(v_storage_paths, v_old_storage_path);
  end loop;

  return query select v_storage_paths;
end;
$$;

revoke all on function public.update_expense_documents_atomic(uuid, jsonb, jsonb, uuid[]) from public;
revoke all on function public.update_expense_documents_atomic(uuid, jsonb, jsonb, uuid[]) from anon;
grant execute on function public.update_expense_documents_atomic(uuid, jsonb, jsonb, uuid[]) to authenticated;
