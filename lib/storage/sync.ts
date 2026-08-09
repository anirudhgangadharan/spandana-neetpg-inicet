/**
 * Client-side glue for /api/sync (accounts plan). IndexedDB stays the
 * source of truth for "what does this device show right now" — this module
 * only mirrors writes to the server and pulls the server's view down on
 * hydrate. Every network call swallows its own errors: losing connectivity
 * must degrade to local-only, never break the app (same posture as
 * lib/storage/attempts.ts's IndexedDB writes).
 */

import type { AttemptRecord } from '@/types';

const IMPORTED_FLAG_KEY = 'medmcqa:importedLocalProgress';

// The active session id, set by features/session/store.ts whenever a
// session starts/resumes/ends. Module-level rather than threaded through
// every queueAttempt() call, matching the existing module-level pending-
// writes state in lib/storage/attempts.ts.
let activeSessionId: string | null = null;

export function setSyncSessionId(id: string | null): void {
  activeSessionId = id;
}

export function getSyncSessionId(): string | null {
  return activeSessionId;
}

export interface RemoteSyncPayload {
  readonly attempts?: readonly AttemptRecord[] | undefined;
  readonly bookmarkPuts?: readonly string[] | undefined;
  readonly bookmarkDeletes?: readonly string[] | undefined;
}

/** Returns whether the server actually accepted the batch — callers that
 *  gate one-time work (importLocalProgressOnce) on success must not treat a
 *  non-2xx response as success just because fetch() itself didn't throw. */
export async function pushSync(payload: RemoteSyncPayload): Promise<boolean> {
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `keepalive` lets this survive a pagehide-triggered flush even if the
      // tab finishes unloading before the response arrives.
      keepalive: true,
      body: JSON.stringify({ ...payload, sessionId: activeSessionId }),
    });
    return res.ok;
  } catch {
    // Best-effort. IndexedDB already has the record; nothing else to do
    // until the next successful sync.
    return false;
  }
}

export interface RemoteSyncState {
  readonly attempts: readonly AttemptRecord[];
  readonly bookmarks: readonly string[];
}

export async function pullSync(): Promise<RemoteSyncState | null> {
  try {
    const res = await fetch('/api/sync');
    if (!res.ok) return null;
    return (await res.json()) as RemoteSyncState;
  } catch {
    return null;
  }
}

/** Remote wins per-question on conflict; anything local-only that the server
 *  hasn't seen yet is kept, not discarded. */
export function mergeWithRemote(
  localAttempts: ReadonlyMap<string, AttemptRecord>,
  localBookmarks: ReadonlySet<string>,
  remote: RemoteSyncState
): { attempts: Map<string, AttemptRecord>; bookmarks: Set<string> } {
  const attempts = new Map(localAttempts);
  for (const a of remote.attempts) attempts.set(a.questionId, a);
  const bookmarks = new Set(localBookmarks);
  for (const id of remote.bookmarks) bookmarks.add(id);
  return { attempts, bookmarks };
}

export interface StartRemoteSessionInput {
  readonly sessionId: string;
  readonly sources: readonly string[];
  readonly subjects: readonly string[];
  readonly topics: readonly string[];
  readonly mode: string;
  readonly plannedCount: number;
  /** Saved as "last used" for the one-tap Continue path (frictionless-
   *  re-entry plan) — the full SessionConfig, opaque to this layer. */
  readonly rememberConfig?: unknown;
}

/** Analytics-only — a failed/missing `sessions` row never affects the
 *  practice flow itself, only the drop-off report. */
export async function startRemoteSession(input: StartRemoteSessionInput): Promise<void> {
  try {
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    // Best-effort, see above.
  }
}

export async function endRemoteSession(sessionId: string, submittedPaper: boolean): Promise<void> {
  try {
    await fetch('/api/sessions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ sessionId, submittedPaper }),
    });
  } catch {
    // Best-effort, see above.
  }
}

/**
 * Runs once per browser, ever: uploads whatever local history predates this
 * device ever having synced (typically: history from before accounts
 * existed at all). Guarded by a localStorage flag rather than a server-side
 * one, since the question is "has THIS browser uploaded yet," not "has this
 * account" — a second device's local-only history is exactly as much worth
 * keeping as the first's.
 */
export async function importLocalProgressOnce(
  attempts: ReadonlyMap<string, AttemptRecord>,
  bookmarks: ReadonlySet<string>
): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(IMPORTED_FLAG_KEY) === '1') return;

  if (attempts.size === 0 && bookmarks.size === 0) {
    localStorage.setItem(IMPORTED_FLAG_KEY, '1');
    return;
  }

  const ok = await pushSync({ attempts: [...attempts.values()], bookmarkPuts: [...bookmarks] });
  // Only mark it done on a confirmed 2xx — a rejected or failed request
  // must retry on the next hydrate, not be silently treated as imported.
  if (ok) localStorage.setItem(IMPORTED_FLAG_KEY, '1');
}
