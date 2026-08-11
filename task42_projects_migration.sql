-- Task 42 migration artifact (review-only; do not execute from this environment)
-- Production preflight confirmed that all existing Expense and Income project
-- references are non-null, valid, and owned by the same user.
-- Existing projects.is_default is intentionally preserved independently from
-- the protected projects.is_general flag introduced below.

begin;

alter table public.projects
  add column if not exists description text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists is_general boolean not null default false,
  add column if not exists profile_storage_path text,
  add column if not exists profile_original_filename text,
  add column if not exists profile_mime_type text;

update public.projects
set
  name = 'כללי',
  is_general = true,
  is_active = true
where btrim(name) = 'כללי';

insert into public.projects (
  user_id,
  name,
  is_default,
  is_active,
  sort_order,
  is_general
)
select
  u.id,
  'כללי',
  false,
  true,
  coalesce(max(p.sort_order), -1) + 1,
  true
from auth.users u
left join public.projects p on p.user_id = u.id
where not exists (
  select 1
  from public.projects existing
  where existing.user_id = u.id
    and existing.is_general
)
group by u.id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_name_not_empty'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_name_not_empty
      check (btrim(name) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_general_consistency'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_general_consistency
      check (
        (is_general and name = 'כללי' and is_active)
        or (not is_general and btrim(name) <> 'כללי')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_profile_metadata_all_or_none'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_profile_metadata_all_or_none
      check (
        (
          profile_storage_path is null
          and profile_original_filename is null
          and profile_mime_type is null
        )
        or (
          profile_storage_path is not null
          and profile_original_filename is not null
          and profile_mime_type is not null
          and
          btrim(profile_storage_path) <> ''
          and btrim(profile_original_filename) <> ''
          and profile_mime_type like 'image/%'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_profile_storage_path_prefix'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_profile_storage_path_prefix
      check (
        profile_storage_path is null
        or profile_storage_path like
          user_id::text || '/projects/' || id::text || '/profile/%'
      );
  end if;
end
$$;

create unique index if not exists projects_one_general_per_user_uidx
  on public.projects (user_id)
  where is_general;

create unique index if not exists projects_user_id_id_uidx
  on public.projects (user_id, id);

create index if not exists projects_user_id_active_sort_idx
  on public.projects (user_id, is_active, sort_order, name);

create or replace function public.protect_general_project()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_general then
      raise exception using
        errcode = '23514',
        message = 'The General project cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.is_general is distinct from new.is_general then
    raise exception using
      errcode = '23514',
      message = 'A project General status cannot be changed';
  end if;

  if new.is_general and (new.name <> 'כללי' or not new.is_active) then
    raise exception using
      errcode = '23514',
      message = 'The General project must remain named כללי and active';
  end if;

  if not new.is_general and btrim(new.name) = 'כללי' then
    raise exception using
      errcode = '23514',
      message = 'The name כללי is reserved for the General project';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_protect_general on public.projects;
create trigger projects_protect_general
before insert or update or delete on public.projects
for each row
execute function public.protect_general_project();

create or replace function public.ensure_general_project_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.projects (
    user_id,
    name,
    is_default,
    is_active,
    sort_order,
    is_general
  ) values (
    new.id,
    'כללי',
    false,
    true,
    0,
    true
  )
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

drop trigger if exists auth_user_ensure_general_project on auth.users;
create trigger auth_user_ensure_general_project
after insert on auth.users
for each row
execute function public.ensure_general_project_for_new_user();

do $$
begin
  if exists (
    select 1
    from public.business_settings bs
    left join public.projects p
      on p.id = bs.default_project_id
      and p.user_id = bs.user_id
    where bs.default_project_id is not null
      and p.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'Existing business default project does not belong to settings owner';
  end if;
end
$$;

create or replace function public.validate_business_settings_default_project()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.default_project_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    or new.default_project_id is distinct from old.default_project_id
    or new.user_id is distinct from old.user_id then
    perform 1
    from public.projects p
    where p.id = new.default_project_id
      and p.user_id = new.user_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'Default project not found for business settings owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists business_settings_validate_default_project on public.business_settings;
create trigger business_settings_validate_default_project
before insert or update of user_id, default_project_id on public.business_settings
for each row
execute function public.validate_business_settings_default_project();

create or replace function public.validate_transaction_project_assignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_project_is_active boolean;
begin
  if new.project_id is null then
    raise exception using
      errcode = '23502',
      message = 'project_id is required';
  end if;

  if tg_op = 'INSERT'
    or new.project_id is distinct from old.project_id
    or new.user_id is distinct from old.user_id then
    select p.is_active
    into v_project_is_active
    from public.projects p
    where p.id = new.project_id
      and p.user_id = new.user_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'Project not found for transaction owner';
    end if;

    if not v_project_is_active then
      raise exception using
        errcode = '23514',
        message = 'Inactive projects cannot receive new transaction assignments';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_validate_project_assignment on public.expenses;
create trigger expenses_validate_project_assignment
before insert or update of user_id, project_id on public.expenses
for each row
execute function public.validate_transaction_project_assignment();

drop trigger if exists daily_z_reports_validate_project_assignment on public.daily_z_reports;
create trigger daily_z_reports_validate_project_assignment
before insert or update of user_id, project_id on public.daily_z_reports
for each row
execute function public.validate_transaction_project_assignment();

alter table public.expenses
  alter column project_id set not null;

alter table public.daily_z_reports
  alter column project_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_user_project_fkey'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_user_project_fkey
      foreign key (user_id, project_id)
      references public.projects(user_id, id)
      on update restrict
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_z_reports_user_project_fkey'
      and conrelid = 'public.daily_z_reports'::regclass
  ) then
    alter table public.daily_z_reports
      add constraint daily_z_reports_user_project_fkey
      foreign key (user_id, project_id)
      references public.projects(user_id, id)
      on update restrict
      on delete restrict;
  end if;
end
$$;

create index if not exists expenses_user_id_project_id_idx
  on public.expenses (user_id, project_id);

create index if not exists daily_z_reports_user_id_project_id_idx
  on public.daily_z_reports (user_id, project_id);

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  display_name text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  document_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_documents_user_project_fkey
    foreign key (user_id, project_id)
    references public.projects(user_id, id)
    on update restrict
    on delete restrict,
  constraint project_documents_display_name_not_empty
    check (btrim(display_name) <> ''),
  constraint project_documents_file_metadata_not_empty
    check (
      btrim(storage_path) <> ''
      and btrim(original_filename) <> ''
      and (
        mime_type = 'application/pdf'
        or mime_type like 'image/%'
      )
    ),
  constraint project_documents_storage_path_prefix
    check (
      storage_path like
        user_id::text || '/projects/' || project_id::text || '/documents/%'
    )
);

create index if not exists project_documents_user_project_order_idx
  on public.project_documents (user_id, project_id, document_order, created_at);

create or replace function public.set_project_record_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_set_task42_updated_at on public.projects;
create trigger projects_set_task42_updated_at
before update on public.projects
for each row
execute function public.set_project_record_updated_at();

drop trigger if exists project_documents_set_updated_at on public.project_documents;
create trigger project_documents_set_updated_at
before update on public.project_documents
for each row
execute function public.set_project_record_updated_at();

alter table public.projects enable row level security;

drop policy if exists projects_delete_own on public.projects;

alter table public.project_documents enable row level security;

drop policy if exists project_documents_select_own on public.project_documents;
create policy project_documents_select_own
on public.project_documents
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists project_documents_insert_own on public.project_documents;
create policy project_documents_insert_own
on public.project_documents
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists project_documents_update_own on public.project_documents;
create policy project_documents_update_own
on public.project_documents
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists project_documents_delete_own on public.project_documents;
create policy project_documents_delete_own
on public.project_documents
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.projects from public;
revoke all on table public.projects from anon;
revoke delete on table public.projects from authenticated;
grant select, insert, update on table public.projects to authenticated;

revoke all on table public.project_documents from public;
revoke all on table public.project_documents from anon;
grant select, insert, update, delete on table public.project_documents to authenticated;

create or replace function public.update_project_documents_atomic(
  p_project_id uuid,
  p_replacements jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_deleted_document_ids uuid[] default '{}'::uuid[]
)
returns table (
  storage_paths text[]
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_item jsonb;
  v_document_id uuid;
  v_storage_path text;
  v_original_filename text;
  v_display_name text;
  v_mime_type text;
  v_document_order integer;
  v_old_storage_path text;
  v_storage_paths text[] := '{}'::text[];
  v_expected_prefix text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_project_id is null then
    raise exception using errcode = '22023', message = 'p_project_id is required';
  end if;

  if jsonb_typeof(coalesce(p_replacements, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_additions, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Document changes must be JSON arrays';
  end if;

  perform 1
  from public.projects p
  where p.id = p_project_id
    and p.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Project not found for current user';
  end if;

  v_expected_prefix := v_user_id::text || '/projects/' || p_project_id::text || '/documents/';

  for v_item in
    select value from jsonb_array_elements(coalesce(p_replacements, '[]'::jsonb))
  loop
    begin
      v_document_id := (v_item ->> 'document_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Replacement document_id must be uuid';
    end;

    if v_document_id = any(coalesce(p_deleted_document_ids, '{}'::uuid[])) then
      raise exception using errcode = '22023', message = 'A document cannot be replaced and deleted together';
    end if;

    v_storage_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_original_filename := btrim(coalesce(v_item ->> 'original_filename', ''));
    v_display_name := btrim(coalesce(v_item ->> 'display_name', v_original_filename));
    v_mime_type := btrim(coalesce(v_item ->> 'mime_type', ''));

    if v_storage_path not like v_expected_prefix || '%'
      or v_original_filename = ''
      or v_display_name = ''
      or not (v_mime_type = 'application/pdf' or v_mime_type like 'image/%') then
      raise exception using errcode = '22023', message = 'Replacement document metadata is invalid';
    end if;

    select d.storage_path
    into v_old_storage_path
    from public.project_documents d
    where d.id = v_document_id
      and d.project_id = p_project_id
      and d.user_id = v_user_id
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'Replacement document not found for current project';
    end if;

    update public.project_documents d
    set
      storage_path = v_storage_path,
      original_filename = v_original_filename,
      display_name = v_display_name,
      mime_type = v_mime_type
    where d.id = v_document_id
      and d.project_id = p_project_id
      and d.user_id = v_user_id;

    v_storage_paths := array_append(v_storage_paths, v_old_storage_path);
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_additions, '[]'::jsonb))
  loop
    v_storage_path := btrim(coalesce(v_item ->> 'storage_path', ''));
    v_original_filename := btrim(coalesce(v_item ->> 'original_filename', ''));
    v_display_name := btrim(coalesce(v_item ->> 'display_name', v_original_filename));
    v_mime_type := btrim(coalesce(v_item ->> 'mime_type', ''));

    begin
      v_document_order := coalesce((v_item ->> 'document_order')::integer, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'Addition document_order must be integer';
    end;

    if v_storage_path not like v_expected_prefix || '%'
      or v_original_filename = ''
      or v_display_name = ''
      or not (v_mime_type = 'application/pdf' or v_mime_type like 'image/%') then
      raise exception using errcode = '22023', message = 'Addition document metadata is invalid';
    end if;

    insert into public.project_documents (
      user_id,
      project_id,
      display_name,
      storage_path,
      original_filename,
      mime_type,
      document_order
    ) values (
      v_user_id,
      p_project_id,
      v_display_name,
      v_storage_path,
      v_original_filename,
      v_mime_type,
      v_document_order
    );
  end loop;

  foreach v_document_id in array coalesce(p_deleted_document_ids, '{}'::uuid[])
  loop
    select d.storage_path
    into v_old_storage_path
    from public.project_documents d
    where d.id = v_document_id
      and d.project_id = p_project_id
      and d.user_id = v_user_id
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'Deleted document not found for current project';
    end if;

    delete from public.project_documents d
    where d.id = v_document_id
      and d.project_id = p_project_id
      and d.user_id = v_user_id;

    v_storage_paths := array_append(v_storage_paths, v_old_storage_path);
  end loop;

  return query select v_storage_paths;
end;
$$;

revoke all on function public.update_project_documents_atomic(uuid, jsonb, jsonb, uuid[]) from public;
revoke all on function public.update_project_documents_atomic(uuid, jsonb, jsonb, uuid[]) from anon;
grant execute on function public.update_project_documents_atomic(uuid, jsonb, jsonb, uuid[]) to authenticated;

drop function if exists public.delete_project_with_reassignment_atomic(uuid, uuid, text[]);
drop function if exists public.delete_unused_project_atomic(uuid);

create or replace function public.delete_unused_project_atomic(
  p_project_id uuid,
  p_new_default_project_id uuid default null
)
returns table (
  deleted boolean,
  deleted_project_id uuid,
  blocked_reason text,
  relationship_counts jsonb,
  default_reference_count integer,
  profile_storage_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_source public.projects%rowtype;
  v_calendar_event_count integer;
  v_income_count integer;
  v_employee_work_log_count integer;
  v_expense_count integer;
  v_inventory_balance_count integer;
  v_inventory_item_count integer;
  v_inventory_movement_count integer;
  v_project_document_count integer;
  v_relationship_counts jsonb;
  v_default_reference_count integer := 0;
  v_new_default public.projects%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_project_id is null then
    raise exception using errcode = '22023', message = 'p_project_id is required';
  end if;

  select p.*
  into v_source
  from public.projects p
  where p.id = p_project_id
    and p.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Project not found for current user';
  end if;

  if v_source.is_general then
    return query select
      false,
      null::uuid,
      'general_project'::text,
      '{}'::jsonb,
      0,
      null::text;
    return;
  end if;

  lock table
    public.business_settings,
    public.calendar_events,
    public.daily_z_reports,
    public.employee_work_logs,
    public.expenses,
    public.inventory_item_balances,
    public.inventory_items,
    public.inventory_movements,
    public.project_documents
  in share row exclusive mode;

  select count(*)::integer into v_calendar_event_count
  from public.calendar_events where project_id = p_project_id;

  select count(*)::integer into v_income_count
  from public.daily_z_reports where project_id = p_project_id;

  select count(*)::integer into v_employee_work_log_count
  from public.employee_work_logs where project_id = p_project_id;

  select count(*)::integer into v_expense_count
  from public.expenses where project_id = p_project_id;

  select count(*)::integer into v_inventory_balance_count
  from public.inventory_item_balances where project_id = p_project_id;

  select count(*)::integer into v_inventory_item_count
  from public.inventory_items where project_id = p_project_id;

  select count(*)::integer into v_inventory_movement_count
  from public.inventory_movements where project_id = p_project_id;

  select count(*)::integer into v_project_document_count
  from public.project_documents where project_id = p_project_id;

  v_relationship_counts := jsonb_build_object(
    'calendar_events', v_calendar_event_count,
    'daily_z_reports', v_income_count,
    'employee_work_logs', v_employee_work_log_count,
    'expenses', v_expense_count,
    'inventory_item_balances', v_inventory_balance_count,
    'inventory_items', v_inventory_item_count,
    'inventory_movements', v_inventory_movement_count,
    'project_documents', v_project_document_count
  );

  -- Require an explicit default change instead of silently clearing it.
  select count(*)::integer
  into v_default_reference_count
  from public.business_settings bs
  where bs.user_id = v_user_id
    and bs.default_project_id = p_project_id;

  if v_calendar_event_count > 0
    or v_income_count > 0
    or v_employee_work_log_count > 0
    or v_expense_count > 0
    or v_inventory_balance_count > 0
    or v_inventory_item_count > 0
    or v_inventory_movement_count > 0
    or v_project_document_count > 0 then
    return query select
      false,
      null::uuid,
      'linked_activity'::text,
      v_relationship_counts,
      v_default_reference_count,
      null::text;
    return;
  end if;

  if v_default_reference_count > 0 then
    if p_new_default_project_id is null then
      return query select
        false,
        null::uuid,
        'default_project'::text,
        '{}'::jsonb,
        v_default_reference_count,
        null::text;
      return;
    end if;

    if p_new_default_project_id = p_project_id then
      raise exception using errcode = '22023', message = 'New default project must differ from deleted project';
    end if;

    select p.*
    into v_new_default
    from public.projects p
    where p.id = p_new_default_project_id
      and p.user_id = v_user_id
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'New default project not found for current user';
    end if;

    if not v_new_default.is_active then
      raise exception using errcode = '23514', message = 'New default project must be active';
    end if;

    update public.business_settings bs
    set default_project_id = p_new_default_project_id
    where bs.user_id = v_user_id
      and bs.default_project_id = p_project_id;
  end if;

  delete from public.projects p
  where p.id = p_project_id
    and p.user_id = v_user_id;

  if not found then
    raise exception using errcode = '40001', message = 'Project delete failed due to concurrent update';
  end if;

  return query select
    true,
    p_project_id,
    null::text,
    '{}'::jsonb,
    0,
    v_source.profile_storage_path;
end;
$$;

revoke all on function public.delete_unused_project_atomic(uuid, uuid) from public;
revoke all on function public.delete_unused_project_atomic(uuid, uuid) from anon;
grant execute on function public.delete_unused_project_atomic(uuid, uuid) to authenticated;

commit;