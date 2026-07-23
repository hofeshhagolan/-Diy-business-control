-- Task 21A migration artifact (review-only; do not execute in this environment)

alter table public.invoice_scan_batches
  add column if not exists checkpoint_payload jsonb not null default '{}'::jsonb;

create index if not exists invoice_scan_batches_user_status_operation_idx
  on public.invoice_scan_batches (user_id, status, operation_id);

create or replace function public.upsert_invoice_scan_batch_checkpoint(
  p_operation_id text,
  p_extraction_mode text,
  p_checkpoint_payload jsonb
)
returns table (
  batch_id uuid,
  operation_id text,
  status text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_user_id uuid;
  v_operation_id text;
  v_mode text;
  v_payload jsonb;
  v_row public.invoice_scan_batches%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  v_operation_id := nullif(btrim(p_operation_id), '');
  if v_operation_id is null then
    raise exception using errcode = '22023', message = 'p_operation_id must be non-empty';
  end if;

  v_mode := coalesce(nullif(btrim(p_extraction_mode), ''), 'all');
  if v_mode not in ('all', 'selected') then
    raise exception using errcode = '22023', message = format('Invalid extraction_mode: %s', v_mode);
  end if;

  v_payload := coalesce(p_checkpoint_payload, '{}'::jsonb);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'p_checkpoint_payload must be a JSON object';
  end if;

  insert into public.invoice_scan_batches (
    user_id,
    status,
    extraction_mode,
    error_message,
    operation_id,
    checkpoint_payload,
    completed_at
  )
  values (
    v_user_id,
    'capturing',
    v_mode,
    '',
    v_operation_id,
    v_payload,
    null
  )
  on conflict (user_id, operation_id)
  where operation_id is not null
  do update
    set extraction_mode = excluded.extraction_mode,
        status = case
          when public.invoice_scan_batches.status = 'ready' then 'ready'
          else 'capturing'
        end,
        error_message = case
          when public.invoice_scan_batches.status = 'ready' then public.invoice_scan_batches.error_message
          else ''
        end,
        checkpoint_payload = excluded.checkpoint_payload,
        completed_at = case
          when public.invoice_scan_batches.status = 'ready' then public.invoice_scan_batches.completed_at
          else null
        end
  returning * into v_row;

  return query
  select v_row.id, v_row.operation_id, v_row.status;
end;
$$;

create or replace function public.list_recoverable_invoice_scan_batches(
  p_limit integer default 10
)
returns table (
  batch_id uuid,
  operation_id text,
  extraction_mode text,
  status text,
  error_message text,
  checkpoint_payload jsonb
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    b.id,
    b.operation_id,
    b.extraction_mode,
    b.status,
    b.error_message,
    b.checkpoint_payload
  from public.invoice_scan_batches b
  where b.user_id = auth.uid()
    and b.operation_id is not null
    and b.status in ('capturing', 'failed')
    and jsonb_typeof(b.checkpoint_payload) = 'object'
    and jsonb_typeof(b.checkpoint_payload -> 'storage_metadata') = 'object'
    and jsonb_typeof((b.checkpoint_payload -> 'storage_metadata') -> 'files') = 'array'
    and jsonb_array_length((b.checkpoint_payload -> 'storage_metadata') -> 'files') > 0
  order by b.id asc
  limit greatest(coalesce(p_limit, 10), 1);
$$;

create or replace function public.mark_invoice_scan_batch_checkpoint_failed(
  p_operation_id text,
  p_last_error text
)
returns table (
  batch_id uuid,
  operation_id text,
  status text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_operation_id text;
  v_row public.invoice_scan_batches%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  v_operation_id := nullif(btrim(p_operation_id), '');
  if v_operation_id is null then
    raise exception using errcode = '22023', message = 'p_operation_id must be non-empty';
  end if;

  update public.invoice_scan_batches b
  set
    status = 'failed',
    error_message = left(coalesce(p_last_error, ''), 1000)
  where b.user_id = v_user_id
    and b.operation_id = v_operation_id
    and b.status <> 'ready'
  returning b.* into v_row;

  if not found then
    raise exception using errcode = '22023', message = 'Recoverable batch not found for current user';
  end if;

  return query
  select v_row.id, v_row.operation_id, v_row.status;
end;
$$;

create or replace function public.persist_invoice_scan_batch_atomic(
  p_extraction_mode text,
  p_items jsonb,
  p_operation_id text
)
returns table (
  batch_id uuid,
  item_count integer,
  page_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_batch_id uuid;
  v_mode text;
  v_operation_id text;

  v_existing_batch_id uuid;
  v_existing_mode text;
  v_existing_status text;
  v_existing_item_count integer := 0;

  v_item jsonb;
  v_page jsonb;
  v_pages jsonb;

  v_item_id uuid;
  v_item_order integer;
  v_selected_for_extraction boolean;
  v_extracted_data jsonb;

  v_page_id text;
  v_upload_index integer;
  v_global_page_index integer;
  v_sha256 text;
  v_storage_path text;
  v_original_filename text;
  v_mime_type text;
  v_page_number integer;

  v_input_item_count integer := 0;
  v_input_page_count integer := 0;
  v_db_item_count integer := 0;
  v_db_page_count integer := 0;

  v_incoming_rows jsonb := '[]'::jsonb;
  v_incoming_signature jsonb;
  v_existing_signature jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  v_mode := coalesce(nullif(btrim(p_extraction_mode), ''), 'all');
  if v_mode not in ('all', 'selected') then
    raise exception using
      errcode = '22023',
      message = format('Invalid extraction_mode: %s', v_mode);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_items must be a JSON array';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception using
      errcode = '22023',
      message = 'p_items must contain at least one item';
  end if;

  v_operation_id := nullif(btrim(p_operation_id), '');
  if v_operation_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_operation_id must be non-empty';
  end if;

  -- Preserve validation/idempotency semantics by validating all items/pages and
  -- generating the incoming signature before deciding between replay/in-place finalize.
  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'Each item must be a JSON object';
    end if;

    if not (v_item ? 'item_order') then
      raise exception using
        errcode = '22023',
        message = 'Each item must include item_order';
    end if;

    if jsonb_typeof(v_item -> 'item_order') = 'null' then
      raise exception using
        errcode = '22023',
        message = 'item_order cannot be null';
    end if;

    begin
      v_item_order := (v_item ->> 'item_order')::integer;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'item_order must be an integer';
    end;

    if v_item_order <= 0 then
      raise exception using
        errcode = '22023',
        message = 'item_order must be > 0';
    end if;

    if v_item ? 'selected_for_extraction' then
      if jsonb_typeof(v_item -> 'selected_for_extraction') = 'null' then
        raise exception using
          errcode = '22023',
          message = 'selected_for_extraction cannot be null when supplied';
      end if;

      begin
        v_selected_for_extraction := (v_item ->> 'selected_for_extraction')::boolean;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'selected_for_extraction must be boolean';
      end;
    else
      v_selected_for_extraction := true;
    end if;

    if v_item ? 'extracted_data' then
      if jsonb_typeof(v_item -> 'extracted_data') = 'null' then
        v_extracted_data := '{}'::jsonb;
      elsif jsonb_typeof(v_item -> 'extracted_data') <> 'object' then
        raise exception using
          errcode = '22023',
          message = 'extracted_data must be a JSON object when supplied';
      else
        v_extracted_data := v_item -> 'extracted_data';
      end if;
    else
      v_extracted_data := '{}'::jsonb;
    end if;

    v_pages := v_item -> 'pages';
    if v_pages is null or jsonb_typeof(v_pages) <> 'array' then
      raise exception using
        errcode = '22023',
        message = 'Each item must include pages as a JSON array';
    end if;

    if jsonb_array_length(v_pages) = 0 then
      raise exception using
        errcode = '22023',
        message = 'Each item must include at least one page';
    end if;

    for v_page in
      select value
      from jsonb_array_elements(v_pages)
    loop
      if jsonb_typeof(v_page) <> 'object' then
        raise exception using
          errcode = '22023',
          message = 'Each page must be a JSON object';
      end if;

      if not (v_page ? 'page_id')
         or not (v_page ? 'upload_index')
         or not (v_page ? 'global_page_index')
         or not (v_page ? 'storage_path')
         or not (v_page ? 'original_filename')
         or not (v_page ? 'mime_type')
         or not (v_page ? 'page_number') then
        raise exception using
          errcode = '22023',
          message = 'Each page must include page_id, upload_index, global_page_index, storage_path, original_filename, mime_type, page_number';
      end if;

      if jsonb_typeof(v_page -> 'page_id') = 'null' then
        raise exception using
          errcode = '22023',
          message = 'page_id cannot be null';
      end if;

      if jsonb_typeof(v_page -> 'upload_index') = 'null' then
        raise exception using
          errcode = '22023',
          message = 'upload_index cannot be null';
      end if;

      if jsonb_typeof(v_page -> 'global_page_index') = 'null' then
        raise exception using
          errcode = '22023',
          message = 'global_page_index cannot be null';
      end if;

      if jsonb_typeof(v_page -> 'page_number') = 'null' then
        raise exception using
          errcode = '22023',
          message = 'page_number cannot be null';
      end if;

      if jsonb_typeof(v_page -> 'storage_path') = 'null'
         or jsonb_typeof(v_page -> 'original_filename') = 'null'
         or jsonb_typeof(v_page -> 'mime_type') = 'null' then
        raise exception using
          errcode = '22023',
          message = 'storage_path, original_filename, mime_type cannot be null';
      end if;

      v_page_id := btrim(v_page ->> 'page_id');
      if v_page_id = '' then
        raise exception using
          errcode = '22023',
          message = 'page_id must be non-empty';
      end if;

      begin
        v_upload_index := (v_page ->> 'upload_index')::integer;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'upload_index must be an integer';
      end;

      begin
        v_global_page_index := (v_page ->> 'global_page_index')::integer;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'global_page_index must be an integer';
      end;

      begin
        v_page_number := (v_page ->> 'page_number')::integer;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'page_number must be an integer';
      end;

      if v_upload_index < 0 then
        raise exception using
          errcode = '22023',
          message = 'upload_index must be >= 0';
      end if;

      if v_global_page_index <= 0 then
        raise exception using
          errcode = '22023',
          message = 'global_page_index must be > 0';
      end if;

      if v_page_number <= 0 then
        raise exception using
          errcode = '22023',
          message = 'page_number must be > 0';
      end if;

      v_storage_path := btrim(v_page ->> 'storage_path');
      v_original_filename := v_page ->> 'original_filename';
      v_mime_type := v_page ->> 'mime_type';

      if v_storage_path = '' then
        raise exception using
          errcode = '22023',
          message = 'storage_path must be non-empty';
      end if;

      if v_page ? 'sha256' and jsonb_typeof(v_page -> 'sha256') <> 'null' then
        v_sha256 := nullif(btrim(v_page ->> 'sha256'), '');
      else
        v_sha256 := null;
      end if;

      v_incoming_rows := v_incoming_rows || jsonb_build_array(
        jsonb_build_object(
          'item_order', v_item_order,
          'selected_for_extraction', v_selected_for_extraction,
          'extracted_data', coalesce(v_extracted_data, '{}'::jsonb),
          'page_id', v_page_id,
          'upload_index', v_upload_index,
          'global_page_index', v_global_page_index,
          'sha256', v_sha256,
          'storage_path', v_storage_path,
          'original_filename', v_original_filename,
          'mime_type', v_mime_type,
          'page_number', v_page_number
        )
      );
    end loop;
  end loop;

  select coalesce(
    jsonb_agg(e.value order by (e.value->>'item_order')::integer, (e.value->>'global_page_index')::integer, (e.value->>'page_id')),
    '[]'::jsonb
  )
  into v_incoming_signature
  from jsonb_array_elements(v_incoming_rows) as e(value);

  select b.id, b.extraction_mode, b.status
  into v_existing_batch_id, v_existing_mode, v_existing_status
  from public.invoice_scan_batches b
  where b.user_id = v_user_id
    and b.operation_id = v_operation_id
  limit 1;

  if v_existing_batch_id is null then
    begin
      insert into public.invoice_scan_batches (
        user_id, status, extraction_mode, error_message, operation_id
      )
      values (
        v_user_id, 'capturing', v_mode, '', v_operation_id
      )
      returning id into v_batch_id;
    exception
      when unique_violation then
        select b.id, b.extraction_mode, b.status
        into v_existing_batch_id, v_existing_mode, v_existing_status
        from public.invoice_scan_batches b
        where b.user_id = v_user_id
          and b.operation_id = v_operation_id
        limit 1;

        if v_existing_batch_id is null then
          raise;
        end if;
    end;
  end if;

  if v_existing_batch_id is not null then
    if v_existing_mode <> v_mode then
      raise exception using
        errcode = '23505',
        message = 'operation_id already exists with different payload';
    end if;

    if exists (
      select 1
      from public.invoice_scan_items i
      where i.batch_id = v_existing_batch_id
        and i.user_id <> v_user_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'Ownership validation failed for scan items';
    end if;

    if exists (
      select 1
      from public.invoice_scan_pages p
      join public.invoice_scan_items i on i.id = p.scan_item_id
      where i.batch_id = v_existing_batch_id
        and (i.user_id <> v_user_id or p.user_id <> v_user_id)
    ) then
      raise exception using
        errcode = '42501',
        message = 'Ownership validation failed for scan pages';
    end if;

    select count(*)
    into v_existing_item_count
    from public.invoice_scan_items i
    where i.batch_id = v_existing_batch_id
      and i.user_id = v_user_id;

    if v_existing_status in ('capturing', 'failed') and v_existing_item_count = 0 then
      v_batch_id := v_existing_batch_id;
      update public.invoice_scan_batches b
      set
        status = 'capturing'
      where b.id = v_batch_id
        and b.user_id = v_user_id;
    else
      with existing_rows as (
        select
          i.item_order,
          i.selected_for_extraction,
          coalesce(i.extracted_data, '{}'::jsonb) as extracted_data,
          p.page_id,
          p.upload_index,
          p.global_page_index,
          nullif(btrim(coalesce(p.sha256, '')), '') as sha256,
          p.storage_path,
          p.original_filename,
          p.mime_type,
          p.page_number
        from public.invoice_scan_items i
        join public.invoice_scan_pages p on p.scan_item_id = i.id
        where i.batch_id = v_existing_batch_id
          and i.user_id = v_user_id
          and p.user_id = v_user_id
      )
      select coalesce(
        jsonb_agg(to_jsonb(r) order by r.item_order, r.global_page_index, r.page_id),
        '[]'::jsonb
      )
      into v_existing_signature
      from existing_rows r;

      if v_incoming_signature <> v_existing_signature then
        raise exception using
          errcode = '23505',
          message = 'operation_id already exists with different payload';
      end if;

      select count(*)
      into v_db_item_count
      from public.invoice_scan_items i
      where i.batch_id = v_existing_batch_id
        and i.user_id = v_user_id;

      select count(*)
      into v_db_page_count
      from public.invoice_scan_pages p
      join public.invoice_scan_items i
        on i.id = p.scan_item_id
      where i.batch_id = v_existing_batch_id
        and i.user_id = v_user_id
        and p.user_id = v_user_id;

      return query
      select v_existing_batch_id, v_db_item_count, v_db_page_count;
      return;
    end if;
  end if;

  if v_batch_id is null then
    raise exception using
      errcode = '23514',
      message = 'Failed to resolve target batch for persistence';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_item_order := (v_item ->> 'item_order')::integer;

    if v_item ? 'selected_for_extraction' then
      v_selected_for_extraction := (v_item ->> 'selected_for_extraction')::boolean;
    else
      v_selected_for_extraction := true;
    end if;

    if v_item ? 'extracted_data' and jsonb_typeof(v_item -> 'extracted_data') = 'object' then
      v_extracted_data := v_item -> 'extracted_data';
    else
      v_extracted_data := '{}'::jsonb;
    end if;

    v_pages := v_item -> 'pages';

    insert into public.invoice_scan_items (
      user_id,
      batch_id,
      item_order,
      status,
      selected_for_extraction,
      extracted_data,
      extraction_error
    )
    values (
      v_user_id,
      v_batch_id,
      v_item_order,
      'captured',
      v_selected_for_extraction,
      coalesce(v_extracted_data, '{}'::jsonb),
      ''
    )
    returning id into v_item_id;

    v_input_item_count := v_input_item_count + 1;

    for v_page in
      select value
      from jsonb_array_elements(v_pages)
    loop
      v_page_id := btrim(v_page ->> 'page_id');
      v_upload_index := (v_page ->> 'upload_index')::integer;
      v_global_page_index := (v_page ->> 'global_page_index')::integer;
      v_page_number := (v_page ->> 'page_number')::integer;

      v_storage_path := btrim(v_page ->> 'storage_path');
      v_original_filename := v_page ->> 'original_filename';
      v_mime_type := v_page ->> 'mime_type';

      if v_page ? 'sha256' and jsonb_typeof(v_page -> 'sha256') <> 'null' then
        v_sha256 := nullif(btrim(v_page ->> 'sha256'), '');
      else
        v_sha256 := null;
      end if;

      insert into public.invoice_scan_pages (
        user_id,
        scan_item_id,
        storage_path,
        original_filename,
        mime_type,
        page_number,
        page_id,
        upload_index,
        global_page_index,
        sha256
      )
      values (
        v_user_id,
        v_item_id,
        v_storage_path,
        v_original_filename,
        v_mime_type,
        v_page_number,
        v_page_id,
        v_upload_index,
        v_global_page_index,
        v_sha256
      );

      v_input_page_count := v_input_page_count + 1;
    end loop;
  end loop;

  select count(*)
  into v_db_item_count
  from public.invoice_scan_items i
  where i.batch_id = v_batch_id
    and i.user_id = v_user_id;

  if v_db_item_count <> v_input_item_count then
    raise exception using
      errcode = '23514',
      message = format('Inserted item count mismatch: expected %s, got %s', v_input_item_count, v_db_item_count);
  end if;

  select count(*)
  into v_db_page_count
  from public.invoice_scan_pages p
  join public.invoice_scan_items i
    on i.id = p.scan_item_id
  where i.batch_id = v_batch_id
    and i.user_id = v_user_id
    and p.user_id = v_user_id;

  if v_db_page_count <> v_input_page_count then
    raise exception using
      errcode = '23514',
      message = format('Inserted page count mismatch: expected %s, got %s', v_input_page_count, v_db_page_count);
  end if;

  if exists (
    select 1
    from public.invoice_scan_items i
    where i.batch_id = v_batch_id
      and i.user_id <> v_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'Ownership validation failed for scan items';
  end if;

  if exists (
    select 1
    from public.invoice_scan_pages p
    join public.invoice_scan_items i on i.id = p.scan_item_id
    where i.batch_id = v_batch_id
      and (i.user_id <> v_user_id or p.user_id <> v_user_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'Ownership validation failed for scan pages';
  end if;

  if exists (
    select 1
    from public.invoice_scan_pages p
    join public.invoice_scan_items i on i.id = p.scan_item_id
    where i.batch_id = v_batch_id
    group by p.page_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'page_id must be unique across the entire batch';
  end if;

  if exists (
    select 1
    from public.invoice_scan_pages p
    join public.invoice_scan_items i on i.id = p.scan_item_id
    where i.batch_id = v_batch_id
    group by p.global_page_index
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'global_page_index must be unique across the entire batch';
  end if;

  update public.invoice_scan_batches b
  set
    status = 'ready',
    completed_at = now()
  where b.id = v_batch_id
    and b.user_id = v_user_id;

  return query
  select v_batch_id, v_input_item_count, v_input_page_count;
end;
$$;

revoke all on function public.upsert_invoice_scan_batch_checkpoint(text, text, jsonb) from public;
revoke all on function public.upsert_invoice_scan_batch_checkpoint(text, text, jsonb) from anon;
grant execute on function public.upsert_invoice_scan_batch_checkpoint(text, text, jsonb) to authenticated;

revoke all on function public.list_recoverable_invoice_scan_batches(integer) from public;
revoke all on function public.list_recoverable_invoice_scan_batches(integer) from anon;
grant execute on function public.list_recoverable_invoice_scan_batches(integer) to authenticated;

revoke all on function public.mark_invoice_scan_batch_checkpoint_failed(text, text) from public;
revoke all on function public.mark_invoice_scan_batch_checkpoint_failed(text, text) from anon;
grant execute on function public.mark_invoice_scan_batch_checkpoint_failed(text, text) to authenticated;

revoke all on function public.persist_invoice_scan_batch_atomic(text, jsonb, text) from public;
revoke all on function public.persist_invoice_scan_batch_atomic(text, jsonb, text) from anon;
grant execute on function public.persist_invoice_scan_batch_atomic(text, jsonb, text) to authenticated;
