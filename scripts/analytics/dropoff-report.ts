/**
 * Operator tool, not user-facing. Reports how often sessions get abandoned
 * and roughly where, using the `sessions` + `attempt_events` tables.
 *
 * A session with no `ended_at` isn't necessarily abandoned — it might just
 * be in progress right now. It only counts as abandoned once its
 * `last_event_at` is stale (default: over 2 hours old) with no close-out.
 *
 * Usage: pnpm analytics:dropoff [staleHours]
 */
import { neon } from '@neondatabase/serverless';

interface SessionRow {
  id: string;
  planned_count: number;
  ended_at: string | null;
  last_event_at: string;
  started_at: string;
  answered: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is not set. Add it to .env.local first.');
    process.exit(1);
  }
  const staleHours = Number.parseFloat(process.argv[2] ?? '2');

  const sql = neon(connectionString);
  const rows = (await sql.query(`
    select
      s.id,
      s.planned_count,
      s.ended_at,
      s.last_event_at,
      s.started_at,
      count(ae.id)::int as answered
    from sessions s
    left join attempt_events ae on ae.session_id = s.id
    group by s.id, s.planned_count, s.ended_at, s.last_event_at, s.started_at
  `)) as SessionRow[];

  const staleMs = staleHours * 60 * 60 * 1000;
  const now = new Date(); // one wall-clock read for the whole report, not per-row

  const completed = rows.filter((r) => r.ended_at !== null);
  const abandoned = rows.filter((r) => r.ended_at === null && now.getTime() - new Date(r.last_event_at).getTime() > staleMs);
  const inProgress = rows.length - completed.length - abandoned.length;

  console.log(`\nSessions: ${rows.length} total — ${completed.length} completed, ${abandoned.length} abandoned, ${inProgress} in progress\n`);

  if (rows.length > 0) {
    const abandonmentRate = abandoned.length / (completed.length + abandoned.length || 1);
    console.log(`Abandonment rate (of sessions that aren't still in progress): ${Math.round(abandonmentRate * 100)}%`);
  }

  if (abandoned.length > 0) {
    const fractions = abandoned
      .filter((r) => r.planned_count > 0)
      .map((r) => Math.min(1, r.answered / r.planned_count));
    console.log(`\nOf abandoned sessions, how far people got before quitting:`);
    console.log(`  median: ${Math.round(median(fractions) * 100)}% of the way through`);
    const buckets: [number, number, number, number] = [0, 0, 0, 0]; // 0-25 / 25-50 / 50-75 / 75-100
    for (const f of fractions) {
      const index = Math.min(3, Math.floor(f * 4)) as 0 | 1 | 2 | 3;
      buckets[index] += 1;
    }
    console.log(
      `  distribution: 0-25% quit: ${buckets[0]}, 25-50%: ${buckets[1]}, 50-75%: ${buckets[2]}, 75-100%: ${buckets[3]}`
    );
  }
  console.log('');
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
