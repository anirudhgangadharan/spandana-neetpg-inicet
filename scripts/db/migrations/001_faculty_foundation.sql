-- Applied by scripts/db/migrate-modules.ts in one transaction.
-- The corpus remains in its own read-only SQLite database.

create table if not exists auth_identities (
  provider          text not null check (provider = 'google'),
  provider_subject  text not null check (length(provider_subject) > 0),
  user_id           uuid not null references users(id) on delete cascade,
  verified_email    text not null check (verified_email = lower(verified_email)),
  verified_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  primary key (provider, provider_subject),
  unique (provider, user_id)
);
create index if not exists auth_identities_email_idx on auth_identities (verified_email);

-- An active grant occupies one of three slots. The partial unique index is a
-- database-level cap even when two super-admin requests race.
create table if not exists faculty_grants (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (email = lower(email)),
  user_id          uuid unique references users(id) on delete set null,
  status           text not null default 'active'
                     check (status in ('active', 'disabled', 'removed')),
  slot             smallint check (slot between 1 and 3),
  granted_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'active') = (slot is not null))
);
create unique index if not exists faculty_grants_active_slot_idx
  on faculty_grants (slot) where status = 'active';
create index if not exists faculty_grants_status_idx on faculty_grants (status);

-- Editorial notes are a separate permission. Existing ADMIN_EMAILS values are
-- not copied automatically: an unverified credential email could claim one.
create table if not exists editorial_note_grants (
  user_id          uuid primary key references users(id) on delete cascade,
  granted_by       uuid references users(id) on delete set null,
  granted_at       timestamptz not null default now()
);

create table if not exists faculty_modules (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references users(id) on delete restrict,
  share_token      uuid not null unique default gen_random_uuid(),
  status           text not null default 'draft'
                     check (status in ('draft', 'published', 'unpublished', 'archived')),
  title            text not null check (length(title) between 1 and 180),
  description      text,
  instructions     text,
  opens_at         timestamptz,
  closes_at        timestamptz,
  duration_seconds integer check (duration_seconds between 60 and 43200),
  max_attempts     smallint not null default 1 check (max_attempts between 1 and 10),
  correct_points   smallint not null default 4 check (correct_points between 0 and 20),
  wrong_points     smallint not null default -1 check (wrong_points between -20 and 0),
  blank_points     smallint not null default 0 check (blank_points between -20 and 20),
  allow_review     boolean not null default false,
  corpus_hash      text,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  check (opens_at is null or closes_at is null or opens_at < closes_at),
  check (status = 'draft' or (opens_at is not null and closes_at is not null
    and duration_seconds is not null and corpus_hash is not null and published_at is not null))
);
create index if not exists faculty_modules_owner_status_idx
  on faculty_modules (owner_user_id, status, created_at desc);

-- Draft selections become an immutable content/answer snapshot at publication.
-- Ownership checks must always come from faculty_modules.owner_user_id.
create table if not exists faculty_module_questions (
  module_id          uuid not null references faculty_modules(id) on delete cascade,
  position           smallint not null check (position between 1 and 200),
  question_id        text not null,
  source             text not null check (source in ('medmcqa', 'usmle')),
  stem               text not null,
  options            jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  answer_index       smallint not null check (answer_index between 0 and 3),
  explanation        text,
  subject            text not null,
  topic              text,
  flags              jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  primary key (module_id, position),
  unique (module_id, question_id)
);
create index if not exists faculty_module_questions_used_idx
  on faculty_module_questions (question_id);

create table if not exists faculty_module_opens (
  module_id          uuid not null references faculty_modules(id) on delete cascade,
  student_user_id    uuid not null references users(id) on delete cascade,
  first_opened_at    timestamptz not null default now(),
  primary key (module_id, student_user_id)
);

create table if not exists faculty_module_attempts (
  id                 uuid primary key default gen_random_uuid(),
  module_id          uuid not null references faculty_modules(id) on delete cascade,
  student_user_id    uuid not null references users(id) on delete cascade,
  attempt_number     smallint not null check (attempt_number between 1 and 10),
  status             text not null default 'active'
                       check (status in ('active', 'submitted', 'expired')),
  started_at         timestamptz not null default now(),
  deadline_at        timestamptz not null,
  submitted_at       timestamptz,
  score              integer,
  correct_count      smallint,
  wrong_count        smallint,
  unanswered_count   smallint,
  revision           integer not null default 0 check (revision >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, module_id),
  unique (module_id, student_user_id, attempt_number),
  check (deadline_at > started_at),
  check ((status = 'active' and submitted_at is null and score is null)
      or (status <> 'active' and submitted_at is not null and score is not null))
);
create index if not exists faculty_module_attempts_module_status_idx
  on faculty_module_attempts (module_id, status, started_at desc);
create index if not exists faculty_module_attempts_student_idx
  on faculty_module_attempts (student_user_id, module_id, started_at desc);
create unique index if not exists faculty_module_attempts_one_active_idx
  on faculty_module_attempts (module_id, student_user_id) where status = 'active';

create table if not exists faculty_module_responses (
  attempt_id         uuid not null,
  module_id          uuid not null,
  position           smallint not null,
  selected_index     smallint check (selected_index between 0 and 3),
  revision           integer not null check (revision >= 0),
  saved_at           timestamptz not null default now(),
  active_time_ms     integer check (active_time_ms between 0 and 43200000),
  primary key (attempt_id, position),
  foreign key (attempt_id, module_id)
    references faculty_module_attempts(id, module_id) on delete cascade,
  foreign key (module_id, position)
    references faculty_module_questions(module_id, position) on delete cascade
);
create index if not exists faculty_module_responses_module_idx
  on faculty_module_responses (module_id, position);
