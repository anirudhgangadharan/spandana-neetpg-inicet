/**
 * Connection to the mutable user database (Neon Postgres) — accounts,
 * bookmarks, session and attempt history.
 *
 * Deliberately separate from lib/db/client.ts, which opens the read-only,
 * checksum-verified question corpus. Nothing in this file may be imported
 * by anything that touches corpus.sqlite, and vice versa: one database is
 * append-and-read-only by policy, the other exists to be written to.
 */

import { neon } from '@neondatabase/serverless';

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local (see README) before using the user database.');
}

/**
 * Tagged-template query function from the Neon serverless driver. Also
 * callable as `sql(text, params)` for plain strings — used by the migration
 * script, which needs to run each schema statement in turn.
 */
export const sql = neon(connectionString);
