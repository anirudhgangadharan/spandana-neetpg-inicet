-- Find abandoned timed attempts without scanning completed attempts.
create index if not exists faculty_module_attempts_due_idx
  on faculty_module_attempts (deadline_at, id) where status = 'active';

-- Defence in depth: an application bug cannot write answers to an already
-- finalized or expired attempt. Deletes remain possible for account erasure.
create or replace function faculty_response_active_guard() returns trigger
language plpgsql as $$
declare attempt_status text;
declare attempt_deadline timestamptz;
begin
  select status, deadline_at into attempt_status, attempt_deadline
  from faculty_module_attempts where id = new.attempt_id and module_id = new.module_id;
  if attempt_status is null or attempt_status <> 'active' or attempt_deadline <= clock_timestamp() then
    raise exception 'faculty attempt is no longer writable';
  end if;
  return new;
end;
$$;

drop trigger if exists faculty_response_active_guard on faculty_module_responses;
create trigger faculty_response_active_guard
before insert or update on faculty_module_responses
for each row execute function faculty_response_active_guard();
