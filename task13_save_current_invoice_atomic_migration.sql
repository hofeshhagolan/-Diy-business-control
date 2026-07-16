-- Task 13 migration artifact (review-only; do not execute in this environment)

alter table public.invoice_scan_items
  add column if not exists saved_expense_id uuid,
  add column if not exists saved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoice_scan_items_saved_expense_id_fkey'
      and conrelid = 'public.invoice_scan_items'::regclass
      and contype = 'f'
  ) then
    alter table public.invoice_scan_items
      add constraint invoice_scan_items_saved_expense_id_fkey
      foreign key (saved_expense_id)
      references public.expenses(id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists invoice_scan_items_saved_expense_id_key
  on public.invoice_scan_items (saved_expense_id)
  where saved_expense_id is not null;

create or replace function public.save_current_invoice_expense_atomic(
  p_scan_item_id uuid,
  p_batch_id uuid,
  p_expense jsonb
)
returns table (
  expense_id uuid,
  scan_item_id uuid,
  saved_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_existing_saved_expense_id uuid;

  v_expense_id uuid;
  v_saved_at timestamptz;

  v_supplier_id uuid;
  v_supplier_name_snapshot text;
  v_supplier_registration_snapshot text;
  v_document_date date;
  v_document_number text;
  v_description text;
  v_notes text;
  v_category_id uuid;
  v_accounting_type_id uuid;
  v_project_id uuid;
  v_payment_source_id uuid;
  v_payment_method_id uuid;
  v_gross_ils numeric;
  v_net_ils numeric;
  v_vat_ils numeric;
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

  if p_batch_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_batch_id is required';
  end if;

  if p_expense is null or jsonb_typeof(p_expense) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'p_expense must be a JSON object';
  end if;

  select i.saved_expense_id
  into v_existing_saved_expense_id
  from public.invoice_scan_items i
  where i.id = p_scan_item_id
    and i.batch_id = p_batch_id
    and i.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Scan item not found for current user/batch';
  end if;

  if v_existing_saved_expense_id is not null then
    raise exception using
      errcode = '23505',
      message = 'Scan item already saved';
  end if;

  if p_expense ? 'supplier_id' and jsonb_typeof(p_expense -> 'supplier_id') <> 'null' then
    begin
      v_supplier_id := (p_expense ->> 'supplier_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'supplier_id must be uuid when supplied';
    end;
  else
    v_supplier_id := null;
  end if;

  v_supplier_name_snapshot := btrim(coalesce(p_expense ->> 'supplier_name_snapshot', ''));
  v_supplier_registration_snapshot := btrim(coalesce(p_expense ->> 'supplier_registration_snapshot', ''));
  v_document_number := btrim(coalesce(p_expense ->> 'document_number', ''));
  v_description := btrim(coalesce(p_expense ->> 'description', ''));
  v_notes := btrim(coalesce(p_expense ->> 'notes', ''));

  if p_expense ? 'document_date' and jsonb_typeof(p_expense -> 'document_date') <> 'null' then
    begin
      v_document_date := (p_expense ->> 'document_date')::date;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'document_date must be date when supplied';
    end;
  else
    v_document_date := null;
  end if;

  if p_expense ? 'category_id' and jsonb_typeof(p_expense -> 'category_id') <> 'null' then
    begin
      v_category_id := (p_expense ->> 'category_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'category_id must be uuid when supplied';
    end;
  else
    v_category_id := null;
  end if;

  if p_expense ? 'accounting_type_id' and jsonb_typeof(p_expense -> 'accounting_type_id') <> 'null' then
    begin
      v_accounting_type_id := (p_expense ->> 'accounting_type_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'accounting_type_id must be uuid';
    end;
  else
    raise exception using
      errcode = '22023',
      message = 'accounting_type_id is required';
  end if;

  if p_expense ? 'project_id' and jsonb_typeof(p_expense -> 'project_id') <> 'null' then
    begin
      v_project_id := (p_expense ->> 'project_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'project_id must be uuid when supplied';
    end;
  else
    v_project_id := null;
  end if;

  if p_expense ? 'payment_source_id' and jsonb_typeof(p_expense -> 'payment_source_id') <> 'null' then
    begin
      v_payment_source_id := (p_expense ->> 'payment_source_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'payment_source_id must be uuid when supplied';
    end;
  else
    v_payment_source_id := null;
  end if;

  if p_expense ? 'payment_method_id' and jsonb_typeof(p_expense -> 'payment_method_id') <> 'null' then
    begin
      v_payment_method_id := (p_expense ->> 'payment_method_id')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'payment_method_id must be uuid when supplied';
    end;
  else
    v_payment_method_id := null;
  end if;

  if not (p_expense ? 'gross_ils') or jsonb_typeof(p_expense -> 'gross_ils') = 'null' then
    raise exception using
      errcode = '22023',
      message = 'gross_ils is required';
  end if;

  if not (p_expense ? 'net_ils') or jsonb_typeof(p_expense -> 'net_ils') = 'null' then
    raise exception using
      errcode = '22023',
      message = 'net_ils is required';
  end if;

  if not (p_expense ? 'vat_ils') or jsonb_typeof(p_expense -> 'vat_ils') = 'null' then
    raise exception using
      errcode = '22023',
      message = 'vat_ils is required';
  end if;

  begin
    v_gross_ils := (p_expense ->> 'gross_ils')::numeric;
    v_net_ils := (p_expense ->> 'net_ils')::numeric;
    v_vat_ils := (p_expense ->> 'vat_ils')::numeric;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'gross_ils, net_ils, vat_ils must be numeric';
  end;

  insert into public.expenses (
    user_id,
    supplier_id,
    supplier_name_snapshot,
    supplier_registration_snapshot,
    document_date,
    document_number,
    description,
    notes,
    category_id,
    accounting_type_id,
    project_id,
    payment_source_id,
    payment_method_id,
    gross_ils,
    net_ils,
    vat_ils
  ) values (
    v_user_id,
    v_supplier_id,
    v_supplier_name_snapshot,
    v_supplier_registration_snapshot,
    v_document_date,
    v_document_number,
    v_description,
    v_notes,
    v_category_id,
    v_accounting_type_id,
    v_project_id,
    v_payment_source_id,
    v_payment_method_id,
    v_gross_ils,
    v_net_ils,
    v_vat_ils
  )
  returning id into v_expense_id;

  v_saved_at := now();

  update public.invoice_scan_items i
  set
    saved_expense_id = v_expense_id,
    saved_at = v_saved_at
  where i.id = p_scan_item_id
    and i.batch_id = p_batch_id
    and i.user_id = v_user_id
    and i.saved_expense_id is null;

  if not found then
    raise exception using
      errcode = '23505',
      message = 'Scan item already saved';
  end if;

  return query
  select v_expense_id, p_scan_item_id, v_saved_at;
end;
$$;

revoke all on function public.save_current_invoice_expense_atomic(uuid, uuid, jsonb) from public;
revoke all on function public.save_current_invoice_expense_atomic(uuid, uuid, jsonb) from anon;
grant execute on function public.save_current_invoice_expense_atomic(uuid, uuid, jsonb) to authenticated;
