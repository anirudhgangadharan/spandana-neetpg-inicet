/**
 * IndexedDB persistence (§7).
 *
 * localStorage caps at roughly 5 MB and 190,000 attempts will not fit, so
 * attempts and bookmarks live in IndexedDB; only small preferences use
 * localStorage.
 *
 * I3: nothing stored here contains answer data. An AttemptRecord holds the
 * question id, the user's selection, and the verdict that was derived at the
 * time. A user who edits their IndexedDB can corrupt their own progress but
 * cannot change what the application considers correct — the answer key lives in
 * `corpus.sqlite` on the server and is verified by checksum at startup.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AttemptRecord } from '@/types';

export const DB_NAME = 'medmcqa-practice';
/** Bump on any schema change and add a forward migration below. */
export const DB_VERSION = 1;

export interface BookmarkRecord {
  readonly questionId: string;
  readonly createdAt: number;
}

interface PracticeDB extends DBSchema {
  attempts: {
    key: string;
    value: AttemptRecord;
    indexes: { 'by-attemptedAt': number; 'by-verdict': string };
  };
  bookmarks: {
    key: string;
    value: BookmarkRecord;
    indexes: { 'by-createdAt': number };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

export class StorageUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StorageUnavailableError';
  }
}

let dbPromise: Promise<IDBPDatabase<PracticeDB>> | null = null;

/**
 * Migrations are FORWARD ONLY and must never silently discard user data (§7).
 * Each version step is additive; if a future version needs to reshape a record,
 * it must read the old shape, write the new one, and keep an archive copy in
 * `meta` rather than dropping the store.
 */
export function getStorage(): Promise<IDBPDatabase<PracticeDB>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new StorageUnavailableError('IndexedDB is not available in this environment'));
  }
  if (dbPromise !== null) return dbPromise;

  dbPromise = openDB<PracticeDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const attempts = db.createObjectStore('attempts', { keyPath: 'questionId' });
        attempts.createIndex('by-attemptedAt', 'attemptedAt');
        attempts.createIndex('by-verdict', 'verdict');

        const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'questionId' });
        bookmarks.createIndex('by-createdAt', 'createdAt');

        db.createObjectStore('meta');
      }
      // Future steps go here as `if (oldVersion < 2) { … }`, each additive.

      tx.objectStore('meta').put(DB_VERSION, 'storageVersion');
    },
    blocked() {
      console.warn('[storage] upgrade blocked by another open tab');
    },
    terminated() {
      // Connection died (e.g. the user cleared site data); drop the cache so the
      // next call reopens rather than reusing a dead handle.
      dbPromise = null;
    },
  }).catch((err: unknown) => {
    dbPromise = null;
    throw new StorageUnavailableError('Could not open IndexedDB', err);
  });

  return dbPromise;
}

/** Test seam. */
export function resetStorageCache(): void {
  dbPromise = null;
}

export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
