-- Task 37 migration artifact (review-only; do not execute in this environment)
-- Purpose: add persisted per-user ordering for company documents and backfill existing rows.

alter table if exists public.company_documents
  add column if not exists sort_order integer;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by
        case when is_default then 0 else 1 end,
        case document_key
          when 'certificate_of_incorporation' then 1
          when 'withholding_tax_certificate' then 2
          when 'tax_deductions_file_certificate' then 3
          when 'bank_account_management_certificate' then 4
          when 'shareholders_resolution' then 5
          when 'board_resolution' then 6
          else 999
        end,
        created_at asc,
        id asc
    ) as next_sort_order
  from public.company_documents
)
update public.company_documents as target
set sort_order = ranked.next_sort_order
from ranked
where target.id = ranked.id
  and coalesce(target.sort_order, -1) <> ranked.next_sort_order;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_documents'
      and column_name = 'sort_order'
      and is_nullable = 'YES'
  ) then
    alter table public.company_documents
      alter column sort_order set not null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_documents_sort_order_positive'
      and conrelid = 'public.company_documents'::regclass
  ) then
    alter table public.company_documents
      add constraint company_documents_sort_order_positive
      check (sort_order > 0);
  end if;
end
$$;

create index if not exists company_documents_user_id_sort_order_idx
  on public.company_documents (user_id, sort_order);

create or replace function public.reorder_company_documents(p_document_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_owned_total integer := 0;
  v_input_total integer := 0;
  v_input_distinct integer := 0;
  v_owned_matches integer := 0;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  v_input_total := coalesce(cardinality(p_document_ids), 0);
  if v_input_total = 0 then
    raise exception 'document order payload is empty';
  end if;

  select count(*)
  into v_owned_total
  from public.company_documents
  where user_id = v_user_id;

  select count(distinct doc_id)
  into v_input_distinct
  from unnest(p_document_ids) as doc_id;

  if v_input_distinct <> v_input_total then
    raise exception 'document ids must be unique';
  end if;

  if v_owned_total <> v_input_total then
    raise exception 'document order payload size mismatch';
  end if;

  select count(*)
  into v_owned_matches
  from unnest(p_document_ids) as requested_id
  join public.company_documents cd
    on cd.id = requested_id
   and cd.user_id = v_user_id;

  if v_owned_matches <> v_owned_total then
    raise exception 'document order payload contains ids outside current user scope';
  end if;

  with requested as (
    select requested_id as id, ordinality::integer as next_sort_order
    from unnest(p_document_ids) with ordinality as item(requested_id, ordinality)
  )
  update public.company_documents cd
  set sort_order = requested.next_sort_order
  from requested
  where cd.user_id = v_user_id
    and cd.id = requested.id;
end;
$$;

revoke all on function public.reorder_company_documents(uuid[]) from public;
revoke all on function public.reorder_company_documents(uuid[]) from anon;
grant execute on function public.reorder_company_documents(uuid[]) to authenticated;
