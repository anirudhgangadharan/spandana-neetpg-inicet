-- User database schema (Neon Postgres). Separate from corpus.sqlite, which
-- stays a read-only, integrity-checked question bank (lib/db/client.ts).
-- This database is the opposite: mutable by design, one row per real event.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  image         text,
  password_hash text,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  sources         jsonb not null,
  subjects        jsonb not null,
  topics          jsonb not null,
  mode            text not null,
  planned_count   integer not null,
  started_at      timestamptz not null default now(),
  last_event_at   timestamptz not null default now(),
  ended_at        timestamptz,
  submitted_paper boolean not null default false
);

create table if not exists bookmarks (
  user_id     uuid not null references users(id) on delete cascade,
  question_id text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- Append-only: one row per submit/skip event, never updated. This is what
-- lets us compute drop-off, revisit behaviour and percentiles later — a
-- table upserted by (user_id, question_id) can only tell you the current
-- state, not the sequence of events that led to it.
create table if not exists attempt_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  session_id     uuid references sessions(id) on delete set null,
  question_id    text not null,
  subject        text not null,
  topic          text,
  selected_index smallint,
  verdict        text not null,
  attempted_at   timestamptz not null,
  duration_ms    integer not null,
  created_at     timestamptz not null default now()
);

create index if not exists attempt_events_question_id_idx on attempt_events (question_id);
create index if not exists attempt_events_subject_idx on attempt_events (subject);
create index if not exists attempt_events_user_attempted_idx on attempt_events (user_id, attempted_at);
create index if not exists attempt_events_session_id_idx on attempt_events (session_id);
