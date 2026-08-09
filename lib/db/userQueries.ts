/**
 * Typed queries against the user database (lib/db/userClient.ts). Kept
 * separate from lib/db/queries.ts, which queries the read-only corpus —
 * these two never share a connection or a table.
 */

import bcrypt from 'bcryptjs';
import { sql } from './userClient';

export interface DbUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly image: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password_hash: string | null;
}

const BCRYPT_ROUNDS = 12;

export class EmailTakenError extends Error {
  constructor() {
    super('An account with this email already exists.');
    this.name = 'EmailTakenError';
  }
}

/**
 * Used by the Credentials provider's `authorize()`. Returns null on both
 * "no such user" and "wrong password" — the caller must not distinguish the
 * two, so a login form can't be used to enumerate registered emails.
 */
export async function verifyCredentials(email: string, password: string): Promise<DbUser | null> {
  const rows = (await sql.query('select id, email, name, image, password_hash from users where email = $1', [
    email,
  ])) as UserRow[];
  const row = rows[0];
  // No account, or a Google-only account with no password set.
  if (row === undefined || row.password_hash === null) return null;
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) return null;
  return { id: row.id, email: row.email, name: row.name, image: row.image };
}

/**
 * Signup path for the Credentials provider. Rejects an email that's already
 * registered — including a Google-only account, since silently attaching a
 * password to it would let two independent credentials control one identity
 * with no linking step the user ever saw.
 */
export async function createUserWithPassword(
  email: string,
  password: string,
  name: string | null
): Promise<DbUser> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const rows = (await sql.query(
      'insert into users (email, name, password_hash) values ($1, $2, $3) returning id, email, name, image',
      [email, name, passwordHash]
    )) as UserRow[];
    const row = rows[0];
    if (row === undefined) throw new Error('insert returned no row');
    return { id: row.id, email: row.email, name: row.name, image: row.image };
  } catch (err) {
    if (isUniqueViolation(err)) throw new EmailTakenError();
    throw err;
  }
}

/** Upsert path for Google sign-in, called from the `jwt` callback in auth.ts. */
export async function upsertGoogleUser(email: string, name: string | null, image: string | null): Promise<DbUser> {
  const rows = (await sql.query(
    `insert into users (email, name, image)
     values ($1, $2, $3)
     on conflict (email) do update set name = excluded.name, image = excluded.image
     returning id, email, name, image`,
    [email, name, image]
  )) as UserRow[];
  const row = rows[0];
  if (row === undefined) throw new Error('upsert returned no row');
  return { id: row.id, email: row.email, name: row.name, image: row.image };
}

function isUniqueViolation(err: unknown): boolean {
  return err !== null && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === '23505';
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export interface NewSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly sources: readonly string[];
  readonly subjects: readonly string[];
  readonly topics: readonly string[];
  readonly mode: string;
  readonly plannedCount: number;
}

export async function createSession(input: NewSessionInput): Promise<void> {
  await sql.query(
    `insert into sessions (id, user_id, sources, subjects, topics, mode, planned_count)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do nothing`,
    [
      input.sessionId,
      input.userId,
      JSON.stringify(input.sources),
      JSON.stringify(input.subjects),
      JSON.stringify(input.topics),
      input.mode,
      input.plannedCount,
    ]
  );
}

export async function closeSession(userId: string, sessionId: string, submittedPaper: boolean): Promise<void> {
  await sql.query('update sessions set ended_at = now(), submitted_paper = $3 where id = $1 and user_id = $2', [
    sessionId,
    userId,
    submittedPaper,
  ]);
}

async function touchSessions(userId: string, sessionIds: readonly string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await sql.query('update sessions set last_event_at = now() where id = any($1) and user_id = $2', [
    sessionIds,
    userId,
  ]);
}

// ---------------------------------------------------------------------------
// attempt events (append-only) + bookmarks
// ---------------------------------------------------------------------------

export interface VerifiedAttemptEvent {
  readonly questionId: string;
  readonly subject: string;
  readonly topic: string | null;
  readonly selectedIndex: number | null;
  readonly verdict: string;
  readonly attemptedAt: number;
  readonly durationMs: number;
  readonly sessionId: string | null;
}

/**
 * Inserts one row per event — never an upsert, see the schema-revision note
 * in lib/db/userSchema.sql. Callers must have already resolved `subject`/
 * `topic` from the corpus themselves (see app/api/sync/route.ts) — this
 * function trusts its input completely, so it must never receive anything
 * a client sent unverified.
 */
export async function insertAttemptEvents(userId: string, events: readonly VerifiedAttemptEvent[]): Promise<void> {
  for (const e of events) {
    await sql.query(
      `insert into attempt_events
         (user_id, session_id, question_id, subject, topic, selected_index, verdict, attempted_at, duration_ms)
       values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), $9)`,
      [userId, e.sessionId, e.questionId, e.subject, e.topic, e.selectedIndex, e.verdict, e.attemptedAt, e.durationMs]
    );
  }
  const sessionIds = [...new Set(events.map((e) => e.sessionId).filter((s): s is string => s !== null))];
  await touchSessions(userId, sessionIds);
}

export interface BookmarkInput {
  readonly questionId: string;
  readonly subject: string;
  readonly topic: string | null;
}

export async function upsertBookmarks(userId: string, bookmarks: readonly BookmarkInput[]): Promise<void> {
  for (const b of bookmarks) {
    await sql.query(
      `insert into bookmarks (user_id, question_id, subject, topic)
       values ($1, $2, $3, $4)
       on conflict (user_id, question_id) do update set subject = excluded.subject, topic = excluded.topic`,
      [userId, b.questionId, b.subject, b.topic]
    );
  }
}

export async function deleteBookmarks(userId: string, questionIds: readonly string[]): Promise<void> {
  if (questionIds.length === 0) return;
  await sql.query('delete from bookmarks where user_id = $1 and question_id = any($2)', [userId, questionIds]);
}

export interface LatestAttemptRow {
  readonly questionId: string;
  readonly selectedIndex: number | null;
  readonly verdict: string;
  readonly attemptedAt: number;
  readonly durationMs: number;
}

/** The latest event per question — collapses the append-only log back to
 *  "current state," which is all the client's local merge needs. */
export async function getLatestAttempts(userId: string): Promise<LatestAttemptRow[]> {
  const rows = (await sql.query(
    `select distinct on (question_id)
       question_id,
       selected_index,
       verdict,
       extract(epoch from attempted_at) * 1000 as attempted_at,
       duration_ms
     from attempt_events
     where user_id = $1
     order by question_id, attempted_at desc`,
    [userId]
  )) as {
    question_id: string;
    selected_index: number | null;
    verdict: string;
    attempted_at: string;
    duration_ms: number;
  }[];

  return rows.map((r) => ({
    questionId: r.question_id,
    selectedIndex: r.selected_index,
    verdict: r.verdict,
    attemptedAt: Number(r.attempted_at),
    durationMs: r.duration_ms,
  }));
}

export async function getBookmarkIds(userId: string): Promise<string[]> {
  const rows = (await sql.query('select question_id from bookmarks where user_id = $1', [userId])) as {
    question_id: string;
  }[];
  return rows.map((r) => r.question_id);
}
