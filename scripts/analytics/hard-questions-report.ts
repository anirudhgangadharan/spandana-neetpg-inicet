/**
 * Operator tool, not user-facing. Cross-references real wrong-rate (from
 * Neon's attempt_events) against the corpus's existing data-quality flags
 * (from corpus.sqlite) to surface two worklists:
 *
 *   1. High wrong-rate questions NOT currently flagged — candidates to flag.
 *   2. Currently-flagged questions with enough real attempts to say whether
 *      the flag matches how people actually do on it.
 *
 * Wrong-rate is computed per DISTINCT USER's latest attempt, not per raw
 * event — one obsessive user retrying a question repeatedly must not skew
 * the rate, and only a question's most recent attempt reflects "did they
 * ultimately get this."
 *
 * Usage: pnpm analytics:hard-questions [minAttempts] [threshold]
 *   minAttempts — minimum distinct users graded, default 5
 *   threshold   — minimum wrong-rate (0-1) to report, default 0.5
 */
import { neon } from '@neondatabase/serverless';
import { getQuestionById } from '@/lib/db/queries';
import type { QuestionFlag } from '@/types';

// Flags that mean "this question's text or answer may itself be broken," as
// opposed to `no_explanation`/`no_topic`, which are metadata-completeness
// flags unrelated to whether the item is answerable correctly.
const CORRECTNESS_FLAGS: readonly QuestionFlag[] = [
  'possible_text_corruption',
  'conflicting_answer_variant',
  'three_distinct_options',
  'two_distinct_options',
  'multi_choice_type',
];

interface WrongRateRow {
  question_id: string;
  graded: number;
  wrong: number;
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is not set. Add it to .env.local first.');
    process.exit(1);
  }
  const minAttempts = Number.parseInt(process.argv[2] ?? '5', 10);
  const threshold = Number.parseFloat(process.argv[3] ?? '0.5');

  const sql = neon(connectionString);
  const rows = (await sql.query(
    `
    with latest as (
      select distinct on (user_id, question_id) user_id, question_id, verdict
      from attempt_events
      order by user_id, question_id, attempted_at desc
    )
    select
      question_id,
      count(*) filter (where verdict in ('correct', 'incorrect'))::int as graded,
      count(*) filter (where verdict = 'incorrect')::int as wrong
    from latest
    group by question_id
    having count(*) filter (where verdict in ('correct', 'incorrect')) >= $1
    order by (count(*) filter (where verdict = 'incorrect'))::float
      / nullif(count(*) filter (where verdict in ('correct', 'incorrect')), 0) desc
    `,
    [minAttempts]
  )) as WrongRateRow[];

  const candidates: { id: string; rate: number; graded: number; stem: string }[] = [];
  const confirmedOrContradicted: { id: string; rate: number; graded: number; flags: string[]; stem: string }[] = [];

  for (const row of rows) {
    const rate = row.wrong / row.graded;
    if (rate < threshold) continue;
    const question = getQuestionById(row.question_id);
    if (question === null) continue; // deleted/rebuilt corpus since these attempts were recorded

    const hasCorrectnessFlag = question.flags.some((f) => CORRECTNESS_FLAGS.includes(f));
    const stem = question.stem.length > 90 ? `${question.stem.slice(0, 90)}…` : question.stem;
    if (hasCorrectnessFlag) {
      confirmedOrContradicted.push({ id: row.question_id, rate, graded: row.graded, flags: [...question.flags], stem });
    } else {
      candidates.push({ id: row.question_id, rate, graded: row.graded, stem });
    }
  }

  console.log(`\n=== Unflagged questions with ${Math.round(threshold * 100)}%+ wrong rate (candidates to flag) ===`);
  if (candidates.length === 0) console.log('(none)');
  for (const c of candidates) {
    console.log(`${Math.round(c.rate * 100)}% wrong, n=${c.graded}  ${c.id}  ${c.stem}`);
  }

  console.log(`\n=== Already-flagged questions with real wrong-rate data ===`);
  if (confirmedOrContradicted.length === 0) console.log('(none)');
  for (const c of confirmedOrContradicted) {
    console.log(`${Math.round(c.rate * 100)}% wrong, n=${c.graded}  [${c.flags.join(', ')}]  ${c.id}  ${c.stem}`);
  }
  console.log('');
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
