-- Task 36 migration artifact (review-only; do not execute in this environment)
-- Deployment prerequisite: verify live `invoice-documents` storage policies already allow
-- authenticated users to access objects when the first path segment equals auth.uid().
-- This migration intentionally does not create or modify storage.objects policies.

create table if not exists public.company_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_key text,
  display_name text not null,
  is_default boolean not null default false,
  storage_path text,
  original_filename text,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_documents_display_name_not_empty
    check (btrim(display_name) <> ''),
  constraint company_documents_file_metadata_all_or_none
    check (
      (
        storage_path is null
        and original_filename is null
        and mime_type is null
      )
      or (
        storage_path is not null
        and original_filename is not null
        and mime_type is not null
        and btrim(storage_path) <> ''
        and btrim(original_filename) <> ''
        and btrim(mime_type) <> ''
      )
    ),
  constraint company_documents_default_key_consistency
    check (
      (is_default and btrim(coalesce(document_key, '')) <> '')
      or (not is_default and coalesce(btrim(document_key), '') = '')
    ),
  constraint company_documents_storage_path_prefix
    check (
      storage_path is null
      or storage_path like user_id::text || '/company-documents/%'
    )
);

create unique index if not exists company_documents_user_id_document_key_uidx
  on public.company_documents (user_id, document_key)
  where document_key is not null;

create index if not exists company_documents_user_id_idx
  on public.company_documents (user_id);

create index if not exists company_documents_user_id_created_at_idx
  on public.company_documents (user_id, created_at);

create or replace function public.set_company_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists company_documents_set_updated_at on public.company_documents;
create trigger company_documents_set_updated_at
before update on public.company_documents
for each row
execute function public.set_company_documents_updated_at();

alter table public.company_documents enable row level security;

drop policy if exists company_documents_select_own on public.company_documents;
create policy company_documents_select_own
on public.company_documents
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists company_documents_insert_own on public.company_documents;
create policy company_documents_insert_own
on public.company_documents
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists company_documents_update_own on public.company_documents;
create policy company_documents_update_own
on public.company_documents
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists company_documents_delete_custom_own on public.company_documents;
drop policy if exists company_documents_delete_own on public.company_documents;
create policy company_documents_delete_own
on public.company_documents
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.company_documents from public;
revoke all on table public.company_documents from anon;
grant select, insert, update, delete on table public.company_documents to authenticated;