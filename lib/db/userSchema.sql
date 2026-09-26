-- User database schema (Neon Postgres). Separate from corpus.sqlite, which
-- stays a read-only, integrity-checked question bank (lib/db/client.ts).
-- This database is the opposite: mutable by design, one row per real event.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  image         text,
  password_hash text,
  created_at    timestamptz not null default now(),
  -- Streak state (habit-formation plan). Denormalized here rather than
  -- computed from attempt_events on every read, since the streak is
  -- displayed on effectively every page load. Updated by updateStreak()
  -- in lib/db/streak.ts, called from the /api/sync POST path whenever a
  -- new attempt event actually lands.
  current_streak     integer not null default 0,
  longest_streak      integer not null default 0,
  last_active_date    date,
  streak_freezes      integer not null default 0,
  -- Remembered session config for the one-tap "Continue practicing" path
  -- (frictionless re-entry plan) — synced server-side, not localStorage,
  -- so it follows the account across devices like everything else here.
  last_session_config jsonb
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
  -- Denormalized from the corpus at write time (same reasoning as
  -- attempt_events.subject/topic) so "Marked" counts for the session-mode
  -- selector are a single Neon aggregation, not a cross-database lookup
  -- into corpus.sqlite for every bookmark. Nullable at the DB level only so
  -- the ALTER-based upgrade path below doesn't need a backfill — the
  -- application always supplies both on insert (see upsertBookmarks()).
  subject     text,
  topic       text,
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

-- Editorial notes attached to a single question or to a whole
-- subject/topic concept (authored explanations plan). Not user-generated —
-- written by verified editorial-note editors only (enforced at the API route)
-- — so unlike attempt_events this table has no user_id at all.
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  scope_type  text not null check (scope_type in ('question','concept')),
  scope_key   text not null,
  subject     text,
  topic       text,
  title       text,
  body_md     text not null,
  image_urls  jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_scope_idx on notes (scope_type, scope_key);
create index if not exists notes_subject_topic_idx on notes (subject, topic);

-- ---------------------------------------------------------------------------
-- Upgrade path: `create table if not exists` above is a no-op against a
-- database that already has these tables, so new columns need explicit
-- ALTER statements. Safe to re-run — IF NOT EXISTS on every one.
-- ---------------------------------------------------------------------------
alter table users add column if not exists current_streak integer not null default 0;
alter table users add column if not exists longest_streak integer not null default 0;
alter table users add column if not exists last_active_date date;
alter table users add column if not exists streak_freezes integer not null default 0;
alter table users add column if not exists last_session_config jsonb;

alter table bookmarks add column if not exists subject text;
alter table bookmarks add column if not exists topic text;

-- Confidence tap (quiet-gamification plan): the user's self-rated confidence
-- at submit time, nullable — old rows and skipped taps stay null, never
-- backfilled or inferred.
alter table attempt_events add column if not exists confidence text
  check (confidence in ('know', 'fairly_sure', 'guessing'));
