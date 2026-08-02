-- Task 36c migration artifact (review-only; do not execute in this environment)
-- Purpose:
-- 1) Persist one-time initialization marker for default company documents.
-- 2) Backfill missing default cards for legacy users who currently have no company_documents rows.
-- 3) Ensure first-run initialization does not recreate intentionally deleted defaults later.

create table if not exists public.company_documents_default_initializations (
  user_id uuid primary key,
  initialized_at timestamptz not null default now()
);

alter table public.company_documents_default_initializations enable row level security;

drop policy if exists company_documents_default_initializations_select_own on public.company_documents_default_initializations;
create policy company_documents_default_initializations_select_own
on public.company_documents_default_initializations
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists company_documents_default_initializations_insert_own on public.company_documents_default_initializations;
create policy company_documents_default_initializations_insert_own
on public.company_documents_default_initializations
for insert
to authenticated
with check (auth.uid() = user_id);

revoke all on table public.company_documents_default_initializations from public;
revoke all on table public.company_documents_default_initializations from anon;
grant select, insert on table public.company_documents_default_initializations to authenticated;

-- Mark users who already have any company document rows as initialized.
-- This preserves current state, including renamed or intentionally deleted defaults.
insert into public.company_documents_default_initializations (user_id)
select distinct cd.user_id
from public.company_documents cd
on conflict (user_id) do nothing;

-- Legacy bug backfill: users with no company_documents rows at all get the six defaults once.
with target_users as (
  select distinct b.user_id
  from public.businesses b
  where b.user_id is not null
    and not exists (
      select 1
      from public.company_documents_default_initializations m
      where m.user_id = b.user_id
    )
    and not exists (
      select 1
      from public.company_documents cd
      where cd.user_id = b.user_id
    )
),
default_definitions as (
  select *
  from (values
    ('certificate_of_incorporation'::text, 'תעודת התאגדות'::text),
    ('withholding_tax_certificate'::text, 'אישור ניכוי מס במקור'::text),
    ('tax_deductions_file_certificate'::text, 'אישור תיק ניכויים'::text),
    ('bank_account_management_certificate'::text, 'אישור ניהול חשבון'::text),
    ('shareholders_resolution'::text, 'פרוטוקול בעלי מניות'::text),
    ('board_resolution'::text, 'פרוטוקול דירקטוריון'::text)
  ) as t(document_key, display_name)
)
insert into public.company_documents (
  user_id,
  document_key,
  display_name,
  is_default,
  storage_path,
  original_filename,
  mime_type
)
select
  tu.user_id,
  dd.document_key,
  dd.display_name,
  true,
  null,
  null,
  null
from target_users tu
cross join default_definitions dd
on conflict (user_id, document_key) do nothing;

-- Mark those backfilled users as initialized.
insert into public.company_documents_default_initializations (user_id)
select user_id
from (
  select distinct b.user_id
  from public.businesses b
  where b.user_id is not null
) users
where exists (
  select 1
  from public.company_documents cd
  where cd.user_id = users.user_id
)
on conflict (user_id) do nothing;
