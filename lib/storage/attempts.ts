/**
 * Attempt and bookmark persistence (§7).
 *
 * Writes are debounced and batched — no write on every keystroke. Quota
 * exhaustion is handled explicitly: the user is warned, offered an export, and
 * the app degrades to session-only rather than failing silently.
 *
 * Every record read back from storage is VALIDATED before use. A user (or a bug,
 * or a hostile page) can put anything in IndexedDB, so nothing here trusts what
 * it finds (T5).
 */

import type { AttemptRecord } from '@/types';
import { getStorage, isQuotaError, type BookmarkRecord } from './db';
import { pushSync } from './sync';

/**
 * Re-exported from lib/core/ so the client write path and the server's
 * /api/sync route validate incoming records with the exact same rules — see
 * that file for the actual logic.
 */
import { parseAttemptRecord } from '@/lib/core/attempt-record';
export { parseAttemptRecord };

export interface StorageHealth {
  readonly writable: boolean;
  readonly quotaExceeded: boolean;
  readonly message: string | null;
}

let health: StorageHealth = { writable: true, quotaExceeded: false, message: null };
export const getStorageHealth = (): StorageHealth => health;

function degrade(message: string, quota: boolean): void {
  health = { writable: false, quotaExceeded: quota, message };
  console.warn(`[storage] ${message}`);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadAllAttempts(): Promise<Map<string, AttemptRecord>> {
  const out = new Map<string, AttemptRecord>();
  try {
    const db = await getStorage();
    const raw = await db.getAll('attempts');
    let discarded = 0;
    for (const item of raw) {
      const parsed = parseAttemptRecord(item);
      if (parsed === null) {
        discarded++;
        continue;
      }
      out.set(parsed.questionId, parsed);
    }
    if (discarded > 0) {
      console.warn(`[storage] discarded ${discarded} malformed attempt record(s)`);
    }
  } catch (err) {
    degrade('Could not read saved progress; continuing in session-only mode.', false);
    console.warn(err);
  }
  return out;
}

export async function loadBookmarks(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const db = await getStorage();
    for (const item of await db.getAll('bookmarks')) {
      if (typeof item === 'object' && item !== null && typeof (item as BookmarkRecord).questionId === 'string') {
        out.add((item as BookmarkRecord).questionId);
      }
    }
  } catch (err) {
    console.warn('[storage] could not read bookmarks', err);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Debounced batched writes
// ---------------------------------------------------------------------------

const WRITE_DEBOUNCE_MS = 350;

const pendingAttempts = new Map<string, AttemptRecord>();
const pendingBookmarkPuts = new Map<string, BookmarkRecord>();
const pendingBookmarkDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  if (pendingAttempts.size === 0 && pendingBookmarkPuts.size === 0 && pendingBookmarkDeletes.size === 0) return;
  if (!health.writable) {
    pendingAttempts.clear();
    pendingBookmarkPuts.clear();
    pendingBookmarkDeletes.clear();
    return;
  }

  const attempts = [...pendingAttempts.values()];
  const bookmarkPuts = [...pendingBookmarkPuts.values()];
  const bookmarkDeletes = [...pendingBookmarkDeletes];
  pendingAttempts.clear();
  pendingBookmarkPuts.clear();
  pendingBookmarkDeletes.clear();

  try {
    const db = await getStorage();
    if (attempts.length > 0) {
      const tx = db.transaction('attempts', 'readwrite');
      await Promise.all([...attempts.map((a) => tx.store.put(a)), tx.done]);
    }
    if (bookmarkPuts.length > 0 || bookmarkDeletes.length > 0) {
      const tx = db.transaction('bookmarks', 'readwrite');
      await Promise.all([
        ...bookmarkPuts.map((b) => tx.store.put(b)),
        ...bookmarkDeletes.map((id) => tx.store.delete(id)),
        tx.done,
      ]);
    }
  } catch (err) {
    if (isQuotaError(err)) {
      degrade(
        'Storage is full. Your progress from this point will not be saved — export your progress to keep it.',
        true
      );
    } else {
      degrade('Could not save progress; continuing in session-only mode.', false);
    }
    console.warn(err);
    return;
  }

  // Mirror the same batch to the server. IndexedDB already has it, so a
  // failure here (offline, expired session) is not user-visible — the next
  // successful flush, or the next hydrate's pull, reconciles it.
  await pushSync({
    attempts: attempts.length > 0 ? attempts : undefined,
    bookmarkPuts: bookmarkPuts.length > 0 ? bookmarkPuts.map((b) => b.questionId) : undefined,
    bookmarkDeletes: bookmarkDeletes.length > 0 ? bookmarkDeletes : undefined,
  });
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);
}

export function queueAttempt(record: AttemptRecord): void {
  pendingAttempts.set(record.questionId, record);
  scheduleFlush();
}

export function queueBookmark(questionId: string, bookmarked: boolean): void {
  if (bookmarked) {
    pendingBookmarkDeletes.delete(questionId);
    pendingBookmarkPuts.set(questionId, { questionId, createdAt: Date.now() });
  } else {
    pendingBookmarkPuts.delete(questionId);
    pendingBookmarkDeletes.add(questionId);
  }
  scheduleFlush();
}

/** Force a write now — used on `pagehide` so a refresh does not lose the last answer. */
export async function flushNow(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}

export async function clearAllProgress(): Promise<void> {
  await flushNow();
  const db = await getStorage();
  await Promise.all([db.clear('attempts'), db.clear('bookmarks')]);
}

/** Account deletion must discard, not sync, queued and persisted browser data. */
export async function discardAllLocalProgress(): Promise<void> {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  pendingAttempts.clear();
  pendingBookmarkPuts.clear();
  pendingBookmarkDeletes.clear();
  const db = await getStorage();
  await Promise.all([db.clear('attempts'), db.clear('bookmarks')]);
}
