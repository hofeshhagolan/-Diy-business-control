-- Income entry-date migration artifact (review-only; do not execute in this environment)
-- NOTE: Historical entry timestamps for existing rows are unknown if created_at did not exist.
-- Backfill below assigns a synthetic migration-time timestamp only for rows where created_at is null.

alter table if exists public.daily_z_reports
  add column if not exists created_at timestamptz;

update public.daily_z_reports
set created_at = now()
where created_at is null;

alter table if exists public.daily_z_reports
  alter column created_at set default now();

alter table if exists public.daily_z_reports
  alter column created_at set not null;

create index if not exists daily_z_reports_user_id_created_at_idx
  on public.daily_z_reports (user_id, created_at desc);
