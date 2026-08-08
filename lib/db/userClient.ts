/**
 * Connection to the mutable user database (Neon Postgres) — accounts,
 * bookmarks, session and attempt history.
 *
 * Deliberately separate from lib/db/client.ts, which opens the read-only,
 * checksum-verified question corpus. Nothing in this file may be imported
 * by anything that touches corpus.sqlite, and vice versa: one database is
 * append-and-read-only by policy, the other exists to be written to.
 *
 * DATABASE_URL is read LAZILY, on first query, not at module load. The
 * Docker build (Dockerfile.fetch) runs `next build` in a stage that has no
 * runtime env vars — Render only injects the dashboard-configured ones into
 * the final container — and Next's build traces this module while bundling
 * routes/middleware regardless of whether a request ever queries it. Reading
 * process.env at import time made the build itself throw before the app
 * ever ran, exactly the failure mode lib/db/client.ts already avoids for the
 * corpus (see `openCorpus()`, which opens on first access, not at import).
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (client !== null) return client;
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local (see README) before using the user database.');
  }
  client = neon(connectionString);
  return client;
}

/** Every call site in this codebase uses `sql.query(text, params)`, never
 *  the tagged-template form — so that's the only shape this wrapper needs
 *  to support. */
export const sql = {
  query: (text: string, params?: unknown[]) => getClient().query(text, params),
};
