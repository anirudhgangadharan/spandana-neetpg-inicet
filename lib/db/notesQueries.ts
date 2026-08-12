/**
 * Typed queries against the `notes` table (authored explanations plan) —
 * editorial notes attached to a single question or to a whole subject/topic
 * concept. Written by admins only; that check lives at the API route
 * (lib/auth/admin.ts), not here — this module trusts its input the same way
 * lib/db/userQueries.ts trusts VerifiedAttemptEvent.
 */

import { sql } from './userClient';

export type NoteScope = 'question' | 'concept';

export interface Note {
  readonly id: string;
  readonly scopeType: NoteScope;
  readonly scopeKey: string;
  readonly subject: string | null;
  readonly topic: string | null;
  readonly title: string | null;
  readonly bodyMd: string;
  readonly imageUrls: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface NoteRow {
  id: string;
  scope_type: string;
  scope_key: string;
  subject: string | null;
  topic: string | null;
  title: string | null;
  body_md: string;
  image_urls: unknown;
  created_at: string;
  updated_at: string;
}

function toNote(row: NoteRow): Note {
  const imageUrls = Array.isArray(row.image_urls)
    ? row.image_urls.filter((u): u is string => typeof u === 'string')
    : [];
  return {
    id: row.id,
    scopeType: row.scope_type === 'concept' ? 'concept' : 'question',
    scopeKey: row.scope_key,
    subject: row.subject,
    topic: row.topic,
    title: row.title,
    bodyMd: row.body_md,
    imageUrls,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

export interface CreateNoteInput {
  readonly scopeType: NoteScope;
  readonly scopeKey: string;
  readonly subject: string | null;
  readonly topic: string | null;
  readonly title: string | null;
  readonly bodyMd: string;
  readonly imageUrls: readonly string[];
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const rows = (await sql.query(
    `insert into notes (scope_type, scope_key, subject, topic, title, body_md, image_urls)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, scope_type, scope_key, subject, topic, title, body_md, image_urls, created_at, updated_at`,
    [
      input.scopeType,
      input.scopeKey,
      input.subject,
      input.topic,
      input.title,
      input.bodyMd,
      JSON.stringify(input.imageUrls),
    ]
  )) as NoteRow[];
  const row = rows[0];
  if (row === undefined) throw new Error('insert returned no row');
  return toNote(row);
}

export interface UpdateNoteInput {
  scopeType?: NoteScope;
  scopeKey?: string;
  subject?: string | null;
  topic?: string | null;
  title?: string | null;
  bodyMd?: string;
  imageUrls?: readonly string[];
}

export async function updateNote(id: string, patch: UpdateNoteInput): Promise<Note | null> {
  const rows = (await sql.query(
    `update notes set
       scope_type = coalesce($2, scope_type),
       scope_key  = coalesce($3, scope_key),
       subject    = case when $4 then $5 else subject end,
       topic      = case when $6 then $7 else topic end,
       title      = case when $8 then $9 else title end,
       body_md    = coalesce($10, body_md),
       image_urls = coalesce($11, image_urls),
       updated_at = now()
     where id = $1
     returning id, scope_type, scope_key, subject, topic, title, body_md, image_urls, created_at, updated_at`,
    [
      id,
      patch.scopeType ?? null,
      patch.scopeKey ?? null,
      'subject' in patch,
      patch.subject ?? null,
      'topic' in patch,
      patch.topic ?? null,
      'title' in patch,
      patch.title ?? null,
      patch.bodyMd ?? null,
      patch.imageUrls === undefined ? null : JSON.stringify(patch.imageUrls),
    ]
  )) as NoteRow[];
  const row = rows[0];
  return row === undefined ? null : toNote(row);
}

export async function deleteNote(id: string): Promise<void> {
  await sql.query('delete from notes where id = $1', [id]);
}

/**
 * Notes visible on a given question: everything scoped directly to that
 * question id, plus every concept note whose subject matches and whose
 * topic is either unset (subject-wide) or matches exactly.
 */
export async function getNotesForQuestion(
  questionId: string,
  subject: string,
  topic: string | null
): Promise<Note[]> {
  const rows = (await sql.query(
    `select id, scope_type, scope_key, subject, topic, title, body_md, image_urls, created_at, updated_at
     from notes
     where (scope_type = 'question' and scope_key = $1)
        or (scope_type = 'concept' and subject = $2 and (topic is null or topic = $3))
     order by created_at asc`,
    [questionId, subject, topic]
  )) as NoteRow[];
  return rows.map(toNote);
}

export async function listNotes(): Promise<Note[]> {
  const rows = (await sql.query(
    `select id, scope_type, scope_key, subject, topic, title, body_md, image_urls, created_at, updated_at
     from notes
     order by created_at desc`
  )) as NoteRow[];
  return rows.map(toNote);
}
