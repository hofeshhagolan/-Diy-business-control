-- Task 33 migration artifact (review-only; do not execute in this environment)
-- Goal: extend existing income records so one unified income screen can support
-- both Z-report income and non-Z income without duplicating document infrastructure.

alter table if exists public.daily_z_reports
  add column if not exists report_time time;

alter table if exists public.daily_z_reports
  add column if not exists income_type text;

update public.daily_z_reports
set income_type = 'דו"ח Z'
where income_type is null or btrim(income_type) = '';

alter table if exists public.daily_z_reports
  alter column income_type set default 'דו"ח Z';

alter table if exists public.daily_z_reports
  alter column income_type set not null;

alter table if exists public.daily_z_reports
  add column if not exists notes text;

alter table if exists public.daily_z_reports
  add column if not exists is_from_z_report boolean;

update public.daily_z_reports
set is_from_z_report = true
where is_from_z_report is null;

alter table if exists public.daily_z_reports
  alter column is_from_z_report set default true;

alter table if exists public.daily_z_reports
  alter column is_from_z_report set not null;

alter table if exists public.daily_z_reports
  drop constraint if exists daily_z_reports_income_type_not_empty;

alter table if exists public.daily_z_reports
  add constraint daily_z_reports_income_type_not_empty
  check (btrim(income_type) <> '');

create index if not exists daily_z_reports_user_id_date_time_idx
  on public.daily_z_reports (user_id, report_date desc, report_time desc nulls last);

create index if not exists daily_z_reports_user_id_is_from_z_report_idx
  on public.daily_z_reports (user_id, is_from_z_report);
