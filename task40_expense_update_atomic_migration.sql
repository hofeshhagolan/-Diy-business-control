-- Task 40 migration artifact (review-only; do not execute in this environment)

create or replace function public.update_expense_atomic(
  p_expense_id uuid,
  p_expense jsonb
)
returns table (
  expense_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;

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

  if p_expense_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_expense_id is required';
  end if;

  if p_expense is null or jsonb_typeof(p_expense) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'p_expense must be a JSON object';
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

  update public.expenses e
  set
    supplier_id = v_supplier_id,
    supplier_name_snapshot = v_supplier_name_snapshot,
    supplier_registration_snapshot = v_supplier_registration_snapshot,
    document_date = v_document_date,
    document_number = v_document_number,
    description = v_description,
    notes = v_notes,
    category_id = v_category_id,
    accounting_type_id = v_accounting_type_id,
    project_id = v_project_id,
    payment_source_id = v_payment_source_id,
    payment_method_id = v_payment_method_id,
    gross_ils = v_gross_ils,
    net_ils = v_net_ils,
    vat_ils = v_vat_ils
  where e.id = p_expense_id
    and e.user_id = v_user_id
  returning e.id into expense_id;

  if expense_id is null then
    raise exception using
      errcode = '40001',
      message = 'Expense update failed due to concurrent update';
  end if;

  return next;
end;
$$;

revoke all on function public.update_expense_atomic(uuid, jsonb) from public;
revoke all on function public.update_expense_atomic(uuid, jsonb) from anon;
grant execute on function public.update_expense_atomic(uuid, jsonb) to authenticated;
