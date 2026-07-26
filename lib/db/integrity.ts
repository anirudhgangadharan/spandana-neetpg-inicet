/**
 * §3.2 — integrity checksum.
 *
 * The ETL writes `answerKeyHash` into manifest.json and into the database's own
 * `meta` table. At startup the server recomputes it from the questions table and
 * compares. A mismatch means the answer key has been altered since the build, so
 * the app refuses to serve questions and shows a maintenance state (T6).
 *
 * Checking against BOTH the manifest and the in-database copy matters: the
 * manifest alone could be from a different build than the .sqlite file sitting
 * next to it, and the in-database copy alone could be rewritten by whoever
 * rewrote the answers.
 */

import type Database from 'better-sqlite3';
import type { AnswerIndex, BuildManifest } from '@/types';
import { computeAnswerKeyHash } from '@/lib/core/answer-key';
import { isAnswerIndex } from '@/lib/core/answer-index';

export interface IntegrityResult {
  readonly ok: boolean;
  readonly computed: string;
  readonly fromMeta: string | null;
  readonly fromManifest: string | null;
  readonly rowCount: number;
  readonly problems: readonly string[];
}

/**
 * Recompute the answer-key hash from the database contents.
 * Rows are streamed in id order and any out-of-range index is reported rather
 * than silently folded into the hash.
 */
export function recomputeAnswerKeyHash(db: Database.Database): {
  hash: string;
  rowCount: number;
  invalid: number;
} {
  const stmt = db.prepare('SELECT id, answer_index FROM questions');
  const entries: { id: string; answer: AnswerIndex }[] = [];
  let invalid = 0;
  for (const row of stmt.iterate() as Iterable<{ id: string; answer_index: number }>) {
    if (!isAnswerIndex(row.answer_index)) {
      invalid++;
      continue;
    }
    entries.push({ id: row.id, answer: row.answer_index });
  }
  return { hash: computeAnswerKeyHash(entries), rowCount: entries.length, invalid };
}

export function verifyIntegrity(db: Database.Database, manifest: BuildManifest | null): IntegrityResult {
  const problems: string[] = [];

  const { hash: computed, rowCount, invalid } = recomputeAnswerKeyHash(db);
  if (invalid > 0) problems.push(`${invalid} rows carry an answer index outside {0,1,2,3}`);

  const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'answerKeyHash'").get() as
    | { value: string }
    | undefined;
  const fromMeta = metaRow?.value ?? null;
  const fromManifest = manifest?.answerKeyHash ?? null;

  if (fromMeta === null) problems.push('database meta table has no answerKeyHash');
  else if (fromMeta !== computed) {
    problems.push(`answerKeyHash mismatch against the database meta table (expected ${fromMeta}, computed ${computed})`);
  }

  if (fromManifest === null) problems.push('manifest.json has no answerKeyHash');
  else if (fromManifest !== computed) {
    problems.push(`answerKeyHash mismatch against manifest.json (expected ${fromManifest}, computed ${computed})`);
  }

  if (manifest !== null && manifest.counts.accepted !== rowCount) {
    problems.push(`manifest reports ${manifest.counts.accepted} accepted rows but the database holds ${rowCount}`);
  }

  return { ok: problems.length === 0, computed, fromMeta, fromManifest, rowCount, problems };
}
