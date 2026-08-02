-- Task 36b migration artifact (review-only; do not execute in this environment)
-- Purpose: allow users to delete any of their company document rows, including default rows.

drop policy if exists company_documents_delete_custom_own on public.company_documents;
drop policy if exists company_documents_delete_own on public.company_documents;

create policy company_documents_delete_own
on public.company_documents
for delete
to authenticated
using (auth.uid() = user_id);
