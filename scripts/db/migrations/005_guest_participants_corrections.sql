-- Guest exam identity and audited question corrections. The imported corpus stays immutable.
create table guest_module_participants (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references faculty_modules(id) on delete cascade,
  student_user_id uuid not null unique references users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  registration_number text not null check (length(registration_number) between 1 and 80),
  roll_number text not null check (length(roll_number) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (module_id, registration_number, roll_number),
  unique (id, module_id)
);
create index guest_module_participants_module_idx on guest_module_participants (module_id);
create unique index guest_module_participants_identity_idx on guest_module_participants
  (module_id, lower(registration_number), lower(roll_number));

create table guest_module_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references guest_module_participants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index guest_module_sessions_participant_idx on guest_module_sessions (participant_id);

create table guest_module_recovery (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references guest_module_participants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index guest_module_recovery_participant_idx on guest_module_recovery (participant_id);

create table question_corrections (
  question_id text not null,
  version integer not null check (version > 0),
  corpus_hash text not null,
  stem text not null check (length(stem) between 1 and 12000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  answer_index smallint not null check (answer_index between 0 and 3),
  explanation text,
  reason text not null check (length(reason) between 3 and 1000),
  author_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  reverted_from integer,
  primary key (question_id, version)
);
create index question_corrections_latest_idx on question_corrections (question_id, version desc);

alter table faculty_module_questions add column correction_version integer;

-- Final answer sheets may arrive just after the visible deadline. The app
-- freezes choices at expiry; ten seconds covers ordinary network transit.
create or replace function faculty_response_active_guard() returns trigger
language plpgsql as $$
declare attempt_status text;
declare attempt_deadline timestamptz;
begin
  select status, deadline_at into attempt_status, attempt_deadline
  from faculty_module_attempts where id = new.attempt_id and module_id = new.module_id;
  if attempt_status is null or attempt_status <> 'active'
      or attempt_deadline + interval '10 seconds' <= clock_timestamp() then
    raise exception 'faculty attempt is no longer writable';
  end if;
  return new;
end;
$$;
