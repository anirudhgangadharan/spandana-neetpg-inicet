/**
 * SQLite access (§3.1, D-005). Server-only.
 *
 * `better-sqlite3` is synchronous and in-process: there is no network hop, so a
 * point lookup costs microseconds and the query layer's latency is dominated by
 * SQLite itself. The corpus is opened read-only — nothing in the running
 * application may write to it (I3).
 *
 * The §3.2 integrity check runs once, lazily, on first access. If it fails the
 * module refuses to hand out a connection, so there is no code path in which a
 * route handler can serve questions from a corrupted answer key (T6).
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { BuildManifest } from '@/types';
import { verifyIntegrity, type IntegrityResult } from './integrity';

/**
 * Where the built corpus lives. Overridable with `CORPUS_DIR` so a container can
 * mount it somewhere other than the working directory.
 */
export const BUILD_DIR =
  process.env['CORPUS_DIR'] !== undefined && process.env['CORPUS_DIR'].length > 0
    ? path.resolve(process.env['CORPUS_DIR'])
    : path.join(process.cwd(), 'data', 'build');
export const DB_PATH = path.join(BUILD_DIR, 'corpus.sqlite');
export const MANIFEST_PATH = path.join(BUILD_DIR, 'manifest.json');

export class CorpusUnavailableError extends Error {
  constructor(
    message: string,
    readonly problems: readonly string[] = []
  ) {
    super(message);
    this.name = 'CorpusUnavailableError';
  }
}

export interface CorpusStatus {
  readonly ready: boolean;
  readonly reason: string | null;
  readonly problems: readonly string[];
  readonly manifest: BuildManifest | null;
  readonly integrity: IntegrityResult | null;
}

interface CorpusHandle {
  readonly db: Database.Database;
  readonly manifest: BuildManifest;
  readonly integrity: IntegrityResult;
}

let cached: CorpusHandle | null = null;
let failure: CorpusStatus | null = null;

export function readManifest(manifestPath: string = MANIFEST_PATH): BuildManifest | null {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BuildManifest;
  } catch {
    return null;
  }
}

/**
 * Open the corpus and verify it. Cached after the first successful call; a
 * failure is also cached so a broken build does not pay the verification cost on
 * every request.
 */
export function openCorpus(): CorpusHandle {
  if (cached !== null) return cached;
  if (failure !== null) throw new CorpusUnavailableError(failure.reason ?? 'corpus unavailable', failure.problems);

  const recordFailure = (reason: string, problems: readonly string[] = []): never => {
    failure = { ready: false, reason, problems, manifest: null, integrity: null };
    throw new CorpusUnavailableError(reason, problems);
  };

  if (!fs.existsSync(DB_PATH)) {
    return recordFailure(`corpus.sqlite not found at ${DB_PATH} — run \`pnpm data:build\``);
  }
  const manifest = readManifest();
  if (manifest === null) {
    return recordFailure(`manifest.json missing or unreadable at ${MANIFEST_PATH} — run \`pnpm data:build\``);
  }

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma('query_only = 1');

  const integrity = verifyIntegrity(db, manifest);
  if (!integrity.ok) {
    db.close();
    failure = {
      ready: false,
      reason: 'answer-key integrity check failed; refusing to serve questions',
      problems: integrity.problems,
      manifest,
      integrity,
    };
    throw new CorpusUnavailableError(failure.reason ?? '', integrity.problems);
  }

  cached = { db, manifest, integrity };
  return cached;
}

/** Non-throwing status, for the maintenance page and the health endpoint. */
export function corpusStatus(): CorpusStatus {
  try {
    const handle = openCorpus();
    return {
      ready: true,
      reason: null,
      problems: [],
      manifest: handle.manifest,
      integrity: handle.integrity,
    };
  } catch (err) {
    if (failure !== null) return failure;
    return {
      ready: false,
      reason: err instanceof Error ? err.message : String(err),
      problems: [],
      manifest: null,
      integrity: null,
    };
  }
}

export function getDb(): Database.Database {
  return openCorpus().db;
}

export function getManifest(): BuildManifest {
  return openCorpus().manifest;
}

/** Test seam: drop the cached handle so a later call re-verifies. */
export function resetCorpusCache(): void {
  if (cached !== null) cached.db.close();
  cached = null;
  failure = null;
}
