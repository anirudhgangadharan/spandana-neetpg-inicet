/**
 * Small preferences in localStorage (§7). Everything here is a handful of bytes;
 * attempts and bookmarks go to IndexedDB.
 *
 * Reads are total: a corrupted or hostile value falls back to the default rather
 * than throwing, because a broken preference must never stop the app loading (T5).
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type StudyMode = 'study' | 'exam';

export interface Preferences {
  readonly theme: ThemePreference;
  /** null means "follow the OS setting". */
  readonly reduceMotion: boolean | null;
  readonly fontScale: number;
  readonly dailyGoal: number;
  /** Streaks are opt-in and off by default (§8 P2: non-coercive by design). */
  readonly showStreak: boolean;
  readonly disclaimerAcknowledged: boolean;
  readonly storageVersion: number;
}

export const PREFS_KEY = 'medmcqa:prefs';
export const PREFS_VERSION = 1;

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  theme: 'system',
  reduceMotion: null,
  fontScale: 1,
  dailyGoal: 20,
  showStreak: false,
  disclaimerAcknowledged: false,
  storageVersion: PREFS_VERSION,
});

const THEMES: readonly string[] = ['system', 'light', 'dark'];
const MIN_FONT_SCALE = 0.875;
const MAX_FONT_SCALE = 2;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function parsePreferences(raw: unknown): Preferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;
  const v = raw as Record<string, unknown>;

  const theme = typeof v['theme'] === 'string' && THEMES.includes(v['theme'])
    ? (v['theme'] as ThemePreference)
    : DEFAULT_PREFERENCES.theme;

  const reduceMotion =
    v['reduceMotion'] === true || v['reduceMotion'] === false ? v['reduceMotion'] : null;

  const fontScaleRaw = v['fontScale'];
  const fontScale =
    typeof fontScaleRaw === 'number' && Number.isFinite(fontScaleRaw)
      ? clamp(fontScaleRaw, MIN_FONT_SCALE, MAX_FONT_SCALE)
      : DEFAULT_PREFERENCES.fontScale;

  const goalRaw = v['dailyGoal'];
  const dailyGoal =
    typeof goalRaw === 'number' && Number.isFinite(goalRaw)
      ? Math.round(clamp(goalRaw, 1, 500))
      : DEFAULT_PREFERENCES.dailyGoal;

  return {
    theme,
    reduceMotion,
    fontScale,
    dailyGoal,
    showStreak: v['showStreak'] === true,
    disclaimerAcknowledged: v['disclaimerAcknowledged'] === true,
    storageVersion: PREFS_VERSION,
  };
}

export function loadPreferences(): Preferences {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === null) return DEFAULT_PREFERENCES;
    return parsePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Full or blocked localStorage must not break the app; preferences simply
    // stop persisting.
  }
}
