'use client';

/**
 * Session state (§7). Zustand, sliced, persisted selectively.
 *
 * | slice       | persisted to   |
 * |-------------|----------------|
 * | session     | sessionStorage |
 * | attempts    | IndexedDB      |
 * | bookmarks   | IndexedDB      |
 * | prefs       | localStorage   |
 * | corpusCache | never          |
 *
 * Two rules this file exists to uphold:
 *
 *  1. Every verdict is produced by `evaluate` from `lib/core/` (I1). No component
 *     and no other store action decides correctness.
 *  2. The cache never exceeds `MAX_CACHED_QUESTIONS`, so a 500-question exam does
 *     not put 500 questions in browser memory (§3.1, §11's heap budget).
 */

import { create } from 'zustand';
import type { AnswerIndex, AttemptRecord, Question, Verdict } from '@/types';
import { evaluate } from '@/lib/core/verdict';
import {
  flushNow,
  getStorageHealth,
  loadAllAttempts,
  loadBookmarks,
  queueAttempt,
  queueBookmark,
} from '@/lib/storage/attempts';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type Preferences,
  type StudyMode,
} from '@/lib/storage/prefs';

/** §3.1 caps a window at 200; hold at most that many client-side. */
export const MAX_CACHED_QUESTIONS = 200;
/** How many ids to request per fetch. */
export const FETCH_CHUNK = 25;

export interface SessionConfig {
  readonly seed: string;
  readonly count: number;
  readonly subjects: readonly string[];
  readonly topics: readonly string[];
  readonly onlyFlagged: boolean;
  readonly mode: StudyMode;
}

export const SESSION_STORAGE_KEY = 'medmcqa:session';

interface PersistedSession {
  readonly config: SessionConfig;
  readonly ids: readonly string[];
  readonly index: number;
  readonly startedAt: number;
  readonly revealed: readonly string[];
  readonly submittedPaper: boolean;
}

export interface SessionStore {
  // ---- session ----------------------------------------------------------
  config: SessionConfig | null;
  ids: readonly string[];
  index: number;
  startedAt: number;
  /** Question ids whose verdict has been revealed to the user. */
  revealed: ReadonlySet<string>;
  /** Exam mode: true once the whole paper has been submitted. */
  submittedPaper: boolean;

  /** The user's current, unsubmitted choice for the question on screen. */
  selection: AnswerIndex | null;
  questionStartedAt: number;

  // ---- corpus cache (never persisted) -----------------------------------
  questions: ReadonlyMap<string, Question>;
  loadingIds: ReadonlySet<string>;

  // ---- user data --------------------------------------------------------
  attempts: ReadonlyMap<string, AttemptRecord>;
  bookmarks: ReadonlySet<string>;
  prefs: Preferences;

  // ---- lifecycle --------------------------------------------------------
  hydrated: boolean;
  status: 'idle' | 'planning' | 'ready' | 'error';
  error: string | null;

  // ---- actions ----------------------------------------------------------
  hydrate: () => Promise<void>;
  startSession: (config: SessionConfig) => Promise<void>;
  resumeFromStorage: () => Promise<boolean>;
  endSession: () => void;

  select: (index: AnswerIndex) => void;
  submit: () => void;
  skip: () => void;
  goTo: (index: number) => void;
  next: () => void;
  previous: () => void;
  submitPaper: () => void;

  toggleBookmark: (questionId?: string) => void;
  setPrefs: (patch: Partial<Preferences>) => void;

  ensureWindow: () => Promise<void>;
  currentQuestion: () => Question | null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readPersistedSession(): PersistedSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (!Array.isArray(v['ids']) || typeof v['config'] !== 'object' || v['config'] === null) return null;
    const ids = (v['ids'] as unknown[]).filter((i): i is string => typeof i === 'string');
    if (ids.length === 0) return null;
    const indexRaw = v['index'];
    const index = typeof indexRaw === 'number' && Number.isFinite(indexRaw) ? indexRaw : 0;
    return {
      config: v['config'] as SessionConfig,
      ids,
      index: Math.min(Math.max(0, Math.floor(index)), ids.length - 1),
      startedAt: typeof v['startedAt'] === 'number' ? v['startedAt'] : Date.now(),
      revealed: Array.isArray(v['revealed'])
        ? (v['revealed'] as unknown[]).filter((i): i is string => typeof i === 'string')
        : [],
      submittedPaper: v['submittedPaper'] === true,
    };
  } catch {
    return null;
  }
}

function writePersistedSession(state: SessionStore): void {
  if (typeof sessionStorage === 'undefined' || state.config === null) return;
  try {
    const payload: PersistedSession = {
      config: state.config,
      ids: state.ids,
      index: state.index,
      startedAt: state.startedAt,
      revealed: [...state.revealed],
      submittedPaper: state.submittedPaper,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Session persistence is a convenience; losing it must not break the session.
  }
}

/** Evict the entries furthest from the current index once over the cap. */
function evict(
  questions: ReadonlyMap<string, Question>,
  ids: readonly string[],
  index: number
): ReadonlyMap<string, Question> {
  if (questions.size <= MAX_CACHED_QUESTIONS) return questions;
  const position = new Map<string, number>();
  ids.forEach((id, i) => position.set(id, i));
  const ranked = [...questions.keys()].sort((a, b) => {
    const da = Math.abs((position.get(a) ?? Number.MAX_SAFE_INTEGER) - index);
    const db = Math.abs((position.get(b) ?? Number.MAX_SAFE_INTEGER) - index);
    return da - db;
  });
  const kept = new Map<string, Question>();
  for (const id of ranked.slice(0, MAX_CACHED_QUESTIONS)) {
    const q = questions.get(id);
    if (q !== undefined) kept.set(id, q);
  }
  return kept;
}

function buildQueryString(config: SessionConfig): URLSearchParams {
  const params = new URLSearchParams();
  params.set('seed', config.seed);
  params.set('count', String(config.count));
  for (const s of config.subjects) params.append('subject', s);
  for (const t of config.topics) params.append('topic', t);
  if (config.onlyFlagged) params.set('flagged', '1');
  return params;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useSessionStore = create<SessionStore>((set, get) => ({
  config: null,
  ids: [],
  index: 0,
  startedAt: 0,
  revealed: new Set<string>(),
  submittedPaper: false,
  selection: null,
  questionStartedAt: 0,
  questions: new Map<string, Question>(),
  loadingIds: new Set<string>(),
  attempts: new Map<string, AttemptRecord>(),
  bookmarks: new Set<string>(),
  prefs: DEFAULT_PREFERENCES,
  hydrated: false,
  status: 'idle',
  error: null,

  async hydrate() {
    if (get().hydrated) return;
    const prefs = loadPreferences();
    set({ prefs });
    const [attempts, bookmarks] = await Promise.all([loadAllAttempts(), loadBookmarks()]);
    set({ attempts, bookmarks, hydrated: true });

    if (typeof window !== 'undefined') {
      // A refresh must not lose the last answer (§16: persistence survives reload).
      window.addEventListener('pagehide', () => void flushNow());
    }
  },

  async startSession(config) {
    set({ status: 'planning', error: null });
    try {
      const res = await fetch(`/api/session/plan?${buildQueryString(config).toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Could not plan a session (HTTP ${res.status}).`);
      }
      const plan = (await res.json()) as { ids: string[]; seed: string };
      set({
        config,
        ids: plan.ids,
        index: 0,
        startedAt: Date.now(),
        questionStartedAt: Date.now(),
        revealed: new Set<string>(),
        submittedPaper: false,
        selection: null,
        questions: new Map<string, Question>(),
        status: 'ready',
      });
      writePersistedSession(get());
      await get().ensureWindow();
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  async resumeFromStorage() {
    const persisted = readPersistedSession();
    if (persisted === null) return false;
    set({
      config: persisted.config,
      ids: persisted.ids,
      index: persisted.index,
      startedAt: persisted.startedAt,
      questionStartedAt: Date.now(),
      revealed: new Set(persisted.revealed),
      submittedPaper: persisted.submittedPaper,
      selection: null,
      status: 'ready',
    });
    await get().ensureWindow();
    return true;
  },

  endSession() {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_STORAGE_KEY);
    set({
      config: null,
      ids: [],
      index: 0,
      revealed: new Set<string>(),
      submittedPaper: false,
      selection: null,
      questions: new Map<string, Question>(),
      status: 'idle',
      error: null,
    });
  },

  select(index) {
    const state = get();
    const id = state.ids[state.index];
    if (id === undefined) return;
    // Once revealed, the choice is history and must not change (I1's spirit: the
    // record of what the user answered is as immutable as the answer itself).
    if (state.revealed.has(id)) return;
    set({ selection: index });
  },

  submit() {
    const state = get();
    const id = state.ids[state.index];
    if (id === undefined || state.selection === null) return;
    const question = state.questions.get(id);
    if (question === undefined) return;
    if (state.revealed.has(id)) return;

    // THE verdict computation. Routed through lib/core (I1).
    const verdict: Verdict = evaluate(question, state.selection);

    const record: AttemptRecord = {
      questionId: id,
      selectedIndex: state.selection,
      verdict,
      attemptedAt: Date.now(),
      durationMs: Math.max(0, Date.now() - state.questionStartedAt),
      bookmarked: state.bookmarks.has(id),
    };

    const attempts = new Map(state.attempts);
    attempts.set(id, record);
    queueAttempt(record);

    // Exam mode withholds feedback until the whole paper is submitted (§8 P1).
    const revealed = new Set(state.revealed);
    if (state.config?.mode !== 'exam') revealed.add(id);

    set({ attempts, revealed });
    writePersistedSession(get());
  },

  skip() {
    const state = get();
    const id = state.ids[state.index];
    if (id === undefined) return;

    if (!state.attempts.has(id)) {
      const question = state.questions.get(id);
      // `evaluate(q, null)` is 'skipped' — again, core decides, not this file.
      const verdict: Verdict = question === undefined ? 'skipped' : evaluate(question, null);
      const record: AttemptRecord = {
        questionId: id,
        selectedIndex: null,
        verdict,
        attemptedAt: Date.now(),
        durationMs: Math.max(0, Date.now() - state.questionStartedAt),
        bookmarked: state.bookmarks.has(id),
      };
      const attempts = new Map(state.attempts);
      attempts.set(id, record);
      queueAttempt(record);
      set({ attempts });
    }
    get().next();
  },

  goTo(index) {
    const state = get();
    if (state.ids.length === 0) return;
    const clamped = Math.min(Math.max(0, index), state.ids.length - 1);
    if (clamped === state.index) return;
    const nextId = state.ids[clamped];
    const existing = nextId === undefined ? undefined : state.attempts.get(nextId);
    set({
      index: clamped,
      // Restore the previous choice when revisiting an answered question.
      selection: existing?.selectedIndex ?? null,
      questionStartedAt: Date.now(),
      questions: evict(state.questions, state.ids, clamped),
    });
    writePersistedSession(get());
    void get().ensureWindow();
  },

  next() {
    get().goTo(get().index + 1);
  },

  previous() {
    get().goTo(get().index - 1);
  },

  submitPaper() {
    const state = get();
    if (state.config?.mode !== 'exam') return;
    set({ submittedPaper: true, revealed: new Set(state.ids) });
    writePersistedSession(get());
  },

  toggleBookmark(questionId) {
    const state = get();
    const id = questionId ?? state.ids[state.index];
    if (id === undefined) return;
    const bookmarks = new Set(state.bookmarks);
    const nowBookmarked = !bookmarks.has(id);
    if (nowBookmarked) bookmarks.add(id);
    else bookmarks.delete(id);
    queueBookmark(id, nowBookmarked);

    // Keep any existing attempt record's flag in step.
    const attempts = new Map(state.attempts);
    const existing = attempts.get(id);
    if (existing !== undefined) {
      const updated: AttemptRecord = { ...existing, bookmarked: nowBookmarked };
      attempts.set(id, updated);
      queueAttempt(updated);
    }
    set({ bookmarks, attempts });
  },

  setPrefs(patch) {
    const prefs: Preferences = { ...get().prefs, ...patch };
    savePreferences(prefs);
    set({ prefs });
  },

  async ensureWindow() {
    const state = get();
    if (state.ids.length === 0) return;

    // Fetch a small band around the cursor, and prefetch the next/previous
    // question so navigation costs no spinner (§11: cached navigation < 50 ms).
    const from = Math.max(0, state.index - 5);
    const to = Math.min(state.ids.length, state.index + FETCH_CHUNK);
    const wanted = state.ids
      .slice(from, to)
      .filter((id) => !state.questions.has(id) && !state.loadingIds.has(id));
    if (wanted.length === 0) return;

    const loading = new Set(state.loadingIds);
    for (const id of wanted) loading.add(id);
    set({ loadingIds: loading });

    try {
      const res = await fetch(`/api/questions?ids=${wanted.map(encodeURIComponent).join(',')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { questions: Question[] };

      const current = get();
      const questions = new Map(current.questions);
      for (const q of body.questions) questions.set(q.id, q);
      const stillLoading = new Set(current.loadingIds);
      for (const id of wanted) stillLoading.delete(id);
      set({
        questions: evict(questions, current.ids, current.index),
        loadingIds: stillLoading,
      });
    } catch (err) {
      const current = get();
      const stillLoading = new Set(current.loadingIds);
      for (const id of wanted) stillLoading.delete(id);
      set({
        loadingIds: stillLoading,
        error: err instanceof Error ? `Could not load questions: ${err.message}` : 'Could not load questions.',
      });
    }
  },

  currentQuestion() {
    const state = get();
    const id = state.ids[state.index];
    if (id === undefined) return null;
    return state.questions.get(id) ?? null;
  },
}));

/** Aggregate progress counters, derived — never stored (§13: no invented data). */
export interface ProgressSummary {
  readonly total: number;
  readonly answered: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly skipped: number;
  readonly accuracy: number | null;
}

export function summariseProgress(state: SessionStore): ProgressSummary {
  let correct = 0;
  let incorrect = 0;
  let skipped = 0;
  for (const id of state.ids) {
    const a = state.attempts.get(id);
    if (a === undefined) continue;
    if (a.verdict === 'correct') correct++;
    else if (a.verdict === 'incorrect') incorrect++;
    else if (a.verdict === 'skipped') skipped++;
  }
  const graded = correct + incorrect;
  return {
    total: state.ids.length,
    answered: correct + incorrect + skipped,
    correct,
    incorrect,
    skipped,
    accuracy: graded === 0 ? null : correct / graded,
  };
}

export { getStorageHealth };
