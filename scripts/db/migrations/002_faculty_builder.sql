-- Draft edits use optimistic revisions. Published content remains in the
-- database after a faculty-facing delete so historical usage is not lost.
alter table faculty_modules
  add column if not exists draft_revision integer not null default 0
    check (draft_revision >= 0),
  add column if not exists deleted_at timestamptz;

create or replace function faculty_frozen_module_guard() returns trigger
language plpgsql as $$
begin
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'archived faculty module cannot be republished';
  end if;
  if old.status = 'published' and new.status not in ('published', 'unpublished', 'archived') then
    raise exception 'invalid faculty module transition';
  end if;
  if old.status = 'unpublished' and new.status not in ('unpublished', 'published', 'archived') then
    raise exception 'invalid faculty module transition';
  end if;
  if old.status = 'draft' and new.status not in ('draft', 'published', 'archived') then
    raise exception 'invalid faculty module transition';
  end if;
  if old.status <> 'draft' and (
    new.owner_user_id, new.share_token, new.title, new.description, new.instructions, new.opens_at,
    new.closes_at, new.duration_seconds, new.max_attempts,
    new.correct_points, new.wrong_points, new.blank_points,
    new.allow_review, new.corpus_hash, new.published_at
  ) is distinct from (
    old.owner_user_id, old.share_token, old.title, old.description, old.instructions, old.opens_at,
    old.closes_at, old.duration_seconds, old.max_attempts,
    old.correct_points, old.wrong_points, old.blank_points,
    old.allow_review, old.corpus_hash, old.published_at
  ) then
    raise exception 'published faculty module configuration is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists faculty_frozen_module_guard on faculty_modules;
create trigger faculty_frozen_module_guard
before update on faculty_modules
for each row execute function faculty_frozen_module_guard();

create or replace function faculty_frozen_questions_guard() returns trigger
language plpgsql as $$
declare parent_status text;
declare parent_id uuid;
begin
  if tg_op = 'DELETE' then
    parent_id := old.module_id;
  else
    parent_id := new.module_id;
  end if;
  if tg_op = 'UPDATE' then
    select status into parent_status from faculty_modules where id = old.module_id;
    if parent_status is not null and parent_status <> 'draft' then
      raise exception 'published faculty questions are immutable';
    end if;
  end if;
  select status into parent_status from faculty_modules
  where id = parent_id;
  -- A missing parent means the delete is cascading from a whole-module purge.
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'published faculty questions are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists faculty_frozen_questions_guard on faculty_module_questions;
create trigger faculty_frozen_questions_guard
before insert or update or delete on faculty_module_questions
for each row execute function faculty_frozen_questions_guard();

create index if not exists faculty_modules_owner_visible_idx
  on faculty_modules (owner_user_id, created_at desc, id desc) where deleted_at is null;
