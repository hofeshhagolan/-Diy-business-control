-- Task 40 migration artifact (review-only; apply in Supabase before deployment)
-- Adds optional non-Z income details while reusing the existing payment methods lookup.

alter table if exists public.daily_z_reports
  add column if not exists payment_method_id uuid;

alter table if exists public.daily_z_reports
  add column if not exists reference_number text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_z_reports_payment_method_id_fkey'
      and conrelid = 'public.daily_z_reports'::regclass
  ) then
    alter table public.daily_z_reports
      add constraint daily_z_reports_payment_method_id_fkey
      foreign key (payment_method_id)
      references public.payment_methods(id)
      on delete set null;
  end if;
end
$$;