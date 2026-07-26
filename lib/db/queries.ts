/**
 * The query layer (§3.1). Server-only — runs inside Route Handlers and Server
 * Components against the local `corpus.sqlite` via better-sqlite3.
 *
 * Every function that returns questions routes them through `questionFromRow`
 * in `lib/core/`, so the answer index is read exactly once, in one place, and
 * arrives frozen (I3).
 *
 * The client never receives more than one window of questions (§3.1).
 */

import type { Question, QuestionFlag, Split } from '@/types';
import { questionFromRow, type QuestionRow } from '@/lib/core/question';
import { mulberry32, sampleWithoutReplacement, seedFromString } from '@/lib/utils/rng';
import { getDb } from './client';

/** Hard cap on how many questions may be returned in one response (§3.1). */
export const MAX_WINDOW = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_SEARCH_RESULTS = 50;
/** Upper bound on a generated session. Beyond this the navigator stops being usable. */
export const MAX_SESSION_SIZE = 500;

const SELECT_COLUMNS = `
  id, split, stem, opt_a, opt_b, opt_c, opt_d, answer_index,
  explanation, subject, topic, choice_type, flags, duplicate_of, session_eligible
`;

export interface QuestionFilters {
  readonly subjects?: readonly string[];
  /** `'__uncategorised__'` selects rows whose topic is NULL (H5). */
  readonly topics?: readonly string[];
  readonly splits?: readonly Split[];
  /** Restrict to rows carrying at least one data-quality warning flag. */
  readonly onlyFlagged?: boolean;
  /** Exclude duplicates and conflicting-answer records (H6, H9). Default true. */
  readonly sessionEligibleOnly?: boolean;
}

export const UNCATEGORISED = '__uncategorised__';

interface WhereClause {
  readonly sql: string;
  readonly params: (string | number)[];
}

function buildWhere(filters: QuestionFilters): WhereClause {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const subjects = filters.subjects ?? [];
  if (subjects.length > 0) {
    clauses.push(`subject IN (${subjects.map(() => '?').join(',')})`);
    params.push(...subjects);
  }

  const topics = filters.topics ?? [];
  if (topics.length > 0) {
    const named = topics.filter((t) => t !== UNCATEGORISED);
    const wantsUncategorised = topics.length !== named.length;
    const parts: string[] = [];
    if (named.length > 0) {
      parts.push(`topic IN (${named.map(() => '?').join(',')})`);
      params.push(...named);
    }
    if (wantsUncategorised) parts.push('topic IS NULL');
    clauses.push(`(${parts.join(' OR ')})`);
  }

  const splits = filters.splits ?? [];
  if (splits.length > 0) {
    clauses.push(`split IN (${splits.map(() => '?').join(',')})`);
    params.push(...splits);
  }

  if (filters.onlyFlagged === true) clauses.push('quality_warning = 1');
  if (filters.sessionEligibleOnly !== false) clauses.push('session_eligible = 1');

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// ---------------------------------------------------------------------------
// Point lookups
// ---------------------------------------------------------------------------

export function getQuestionById(id: string): Question | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM questions WHERE id = ?`)
    .get(id) as QuestionRow | undefined;
  return row === undefined ? null : questionFromRow(row);
}

/**
 * Fetch a window of questions by id, returned IN THE ORDER REQUESTED so a
 * session plan's sequence survives the round trip. Unknown ids are skipped.
 */
export function getQuestionsByIds(ids: readonly string[]): Question[] {
  const capped = ids.slice(0, MAX_WINDOW);
  if (capped.length === 0) return [];

  const rows = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM questions WHERE id IN (${capped.map(() => '?').join(',')})`)
    .all(...capped) as QuestionRow[];

  const byId = new Map<string, Question>();
  for (const row of rows) byId.set(row.id, questionFromRow(row));

  const ordered: Question[] = [];
  for (const id of capped) {
    const q = byId.get(id);
    if (q !== undefined) ordered.push(q);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Paged listing (cursor = rowid, stable because rowids are assigned by the ETL
// in a deterministic insertion order)
// ---------------------------------------------------------------------------

export interface QuestionPage {
  readonly questions: readonly Question[];
  readonly nextCursor: number | null;
  readonly total: number;
}

export function listQuestions(
  filters: QuestionFilters,
  cursor: number | null = null,
  limit: number = DEFAULT_PAGE_SIZE
): QuestionPage {
  const db = getDb();
  const where = buildWhere(filters);
  const pageSize = Math.min(Math.max(1, limit), MAX_WINDOW);

  const cursorClause = cursor === null ? '' : where.sql === '' ? 'WHERE rowid > ?' : 'AND rowid > ?';
  const cursorParams = cursor === null ? [] : [cursor];

  const rows = db
    .prepare(
      `SELECT rowid AS __rowid, ${SELECT_COLUMNS} FROM questions
       ${where.sql} ${cursorClause}
       ORDER BY rowid LIMIT ?`
    )
    .all(...where.params, ...cursorParams, pageSize + 1) as (QuestionRow & { __rowid: number })[];

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM questions ${where.sql}`).get(...where.params) as { n: number }
  ).n;

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];

  return {
    questions: page.map((r) => questionFromRow(r)),
    nextCursor: hasMore && last !== undefined ? last.__rowid : null,
    total,
  };
}

/** Ids only — used to build a session plan without materialising question text. */
export function listQuestionIds(filters: QuestionFilters, limit: number): string[] {
  const where = buildWhere(filters);
  const rows = getDb()
    .prepare(`SELECT id FROM questions ${where.sql} ORDER BY rowid LIMIT ?`)
    .all(...where.params, Math.max(0, limit)) as { id: string }[];
  return rows.map((r) => r.id);
}

export function countQuestions(filters: QuestionFilters): number {
  const where = buildWhere(filters);
  return (
    getDb().prepare(`SELECT COUNT(*) AS n FROM questions ${where.sql}`).get(...where.params) as { n: number }
  ).n;
}

// ---------------------------------------------------------------------------
// Full-text search (FTS5, BM25-ranked)
// ---------------------------------------------------------------------------

/**
 * Turn arbitrary user input into a safe FTS5 MATCH expression.
 *
 * FTS5 query syntax treats `"`, `*`, `(`, `)`, `:`, `-`, `^`, `NEAR`, `AND`,
 * `OR` and `NOT` specially. Rather than trying to escape all of that, each
 * alphanumeric token is extracted and re-quoted as a phrase, and a trailing `*`
 * is added to the final token so search feels responsive while typing.
 * Anything the user typed that is not part of a word is discarded.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (tokens === null || tokens.length === 0) return null;
  const capped = tokens.slice(0, 8);
  return capped
    .map((t, i) => (i === capped.length - 1 && t.length >= 3 ? `"${t}"*` : `"${t}"`))
    .join(' AND ');
}

export interface SearchHit {
  readonly question: Question;
  /** BM25 score; lower is a better match in SQLite's convention. */
  readonly score: number;
}

export function searchQuestions(
  rawQuery: string,
  filters: QuestionFilters,
  limit: number = MAX_SEARCH_RESULTS
): SearchHit[] {
  const match = toFtsQuery(rawQuery);
  if (match === null) return [];

  const where = buildWhere(filters);
  // The filter clauses reference `questions` columns, so they compose with the
  // FTS join unchanged — but `WHERE` is already spoken for by the MATCH.
  const extra = where.sql === '' ? '' : `AND ${where.sql.slice('WHERE '.length)}`;

  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS.split(',').map((c) => `q.${c.trim()}`).join(', ')},
              bm25(questions_fts, 10.0, 3.0, 3.0, 3.0, 3.0, 1.0) AS score
       FROM questions_fts
       JOIN questions q ON q.rowid = questions_fts.rowid
       WHERE questions_fts MATCH ? ${extra}
       ORDER BY score
       LIMIT ?`
    )
    .all(match, ...where.params, Math.min(Math.max(1, limit), MAX_WINDOW)) as (QuestionRow & {
    score: number;
  })[];

  return rows.map((r) => ({ question: questionFromRow(r), score: r.score }));
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

export interface Facets {
  readonly subjects: readonly { readonly name: string; readonly count: number }[];
  readonly topicsBySubject: Readonly<Record<string, readonly { readonly name: string; readonly count: number }[]>>;
  readonly flags: readonly { readonly name: QuestionFlag; readonly count: number }[];
  readonly total: number;
  readonly sessionEligible: number;
}

let facetsCache: Facets | null = null;

/** Cached for the process lifetime — the corpus is read-only after the build. */
export function getFacets(): Facets {
  if (facetsCache !== null) return facetsCache;
  const db = getDb();

  const subjects = db
    .prepare('SELECT subject AS name, COUNT(*) AS count FROM questions GROUP BY subject ORDER BY count DESC')
    .all() as { name: string; count: number }[];

  const topicRows = db
    .prepare(
      `SELECT subject, topic, COUNT(*) AS count FROM questions
       GROUP BY subject, topic ORDER BY subject, count DESC`
    )
    .all() as { subject: string; topic: string | null; count: number }[];

  const topicsBySubject: Record<string, { name: string; count: number }[]> = {};
  for (const row of topicRows) {
    const bucket = topicsBySubject[row.subject] ?? (topicsBySubject[row.subject] = []);
    // H5/D-008: a null topic is a real bucket the user can filter on, not a gap.
    bucket.push({ name: row.topic ?? UNCATEGORISED, count: row.count });
  }

  const flagRows = db.prepare('SELECT flags FROM questions WHERE flags != ?').all('[]') as { flags: string }[];
  const flagCounts = new Map<QuestionFlag, number>();
  for (const row of flagRows) {
    const parsed = JSON.parse(row.flags) as QuestionFlag[];
    for (const f of parsed) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  }

  const total = (db.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n;
  const eligible = (
    db.prepare('SELECT COUNT(*) AS n FROM questions WHERE session_eligible = 1').get() as { n: number }
  ).n;

  facetsCache = {
    subjects,
    topicsBySubject,
    flags: [...flagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    total,
    sessionEligible: eligible,
  };
  return facetsCache;
}

// ---------------------------------------------------------------------------
// Session planning — deterministic, seeded (§7)
// ---------------------------------------------------------------------------

export interface SessionPlanRequest {
  readonly filters: QuestionFilters;
  readonly count: number;
  /** Any string; the same string always yields the same sequence. */
  readonly seed: string;
  /** When false the plan preserves corpus order instead of shuffling. */
  readonly shuffle?: boolean;
}

export interface SessionPlan {
  readonly seed: string;
  readonly numericSeed: number;
  readonly ids: readonly string[];
  /** How many questions matched the filters before the count cap. */
  readonly available: number;
}

/**
 * Produce an ordered question-id sequence. Pure with respect to its input:
 * the same request always returns the same sequence, which is what makes a
 * session resumable after a refresh and reproducible in a test (§7).
 *
 * `Math.random()` is not used anywhere in this path (§13 anti-requirement 7).
 */
export function planSession(request: SessionPlanRequest): SessionPlan {
  const count = Math.min(Math.max(1, request.count), MAX_SESSION_SIZE);
  const available = countQuestions(request.filters);

  // Draw from a bounded candidate pool rather than the whole corpus: for a
  // 20-question session there is no reason to shuffle 167,000 ids. The pool is
  // large enough that the sample is not visibly biased toward low rowids, and
  // it is taken deterministically so the plan stays reproducible.
  const poolSize = Math.min(available, Math.max(count * 40, 2000));
  const pool = listQuestionIds(request.filters, poolSize);

  const numericSeed = seedFromString(request.seed);
  const ids =
    request.shuffle === false
      ? pool.slice(0, count)
      : sampleWithoutReplacement(pool, count, mulberry32(numericSeed));

  return { seed: request.seed, numericSeed, ids, available };
}
