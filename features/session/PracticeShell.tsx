'use client';

/**
 * The practice flow (§8 P0): select → submit → verdict → explanation → next,
 * with previous / skip / bookmark, progress, navigator, filters and search.
 *
 * This component owns no correctness logic. It reads the verdict that the store
 * recorded (which the store obtained from `lib/core/evaluate`) and passes the
 * correct position down already resolved. Grep-verified: `answerIndex` appears
 * nowhere in this file (I1, I3).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnswerIndex, Question, QuestionSource } from '@/types';
import type { Facets } from '@/lib/db/queries';
import type { UserStats } from '@/lib/db/statsQueries';
import { flushNow } from '@/lib/storage/attempts';
import { QuestionCard } from '@/components/question/QuestionCard';
import { NavigatorGrid } from '@/components/navigator/NavigatorGrid';
import { SessionSetup } from '@/components/filters/SessionSetup';
import { SearchField } from '@/components/filters/SearchField';
import { Button, ProgressBar, uiStyles } from '@/components/ui/primitives';
import { DisclaimerGate, DisclaimerFooter } from '@/components/Disclaimer';
import { AccountMenu } from '@/components/auth/AccountMenu';
import { SHORTCUT_HELP, useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getStorageHealth, summariseProgress, useSessionStore, type ProgressSummary, type QuestionMode, type SessionConfig } from './store';
import { ConfidenceTap } from './ConfidenceTap';
import styles from './practice.module.css';

export interface PracticeShellProps {
  readonly facets: Facets;
  readonly copIndexBase: 0 | 1;
  readonly appVersion: string;
}

/** A short, quick-start session length — the one-tap "Continue practicing"
 *  path is for the daily habit loop, not a dedicated study block, so it
 *  deliberately ignores whatever count the remembered config used. */
const CONTINUE_PRACTICING_COUNT = 10;

/**
 * Defensive parse of the remembered config from `users.last_session_config`
 * (jsonb, opaque at the DB layer). It's data this app wrote itself, but
 * schema drift over time (a field added/renamed since it was saved) is a
 * real possibility, so every field degrades to a sane default rather than
 * the whole thing being rejected.
 */
function parseRememberedConfig(value: unknown): Omit<SessionConfig, 'seed' | 'count'> | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const sources = Array.isArray(v['sources'])
    ? v['sources'].filter((s): s is QuestionSource => s === 'medmcqa' || s === 'usmle')
    : [];
  if (sources.length === 0) return null;
  const subjects = Array.isArray(v['subjects']) ? v['subjects'].filter((s): s is string => typeof s === 'string') : [];
  const topics = Array.isArray(v['topics']) ? v['topics'].filter((s): s is string => typeof s === 'string') : [];
  const onlyFlagged = v['onlyFlagged'] === true;
  const mode = v['mode'] === 'exam' ? 'exam' : 'study';
  const rawQuestionMode = v['questionMode'];
  const questionMode: QuestionMode =
    rawQuestionMode === 'new' ||
    rawQuestionMode === 'incorrect' ||
    rawQuestionMode === 'attempted' ||
    rawQuestionMode === 'marked' ||
    rawQuestionMode === 'all'
      ? rawQuestionMode
      : 'new';
  return { sources, subjects, topics, onlyFlagged, mode, questionMode };
}

interface SessionSummaryData {
  readonly progress: ProgressSummary;
  readonly streak: number;
  readonly questionsCovered: number;
  readonly highlight: string;
}

/** Rotates which stat leads the session-end summary — a fixed message every
 *  time is a fixed reward, and fixed rewards are what habit-formation
 *  research says extinguishes fastest (variable-ratio reinforcement is the
 *  whole point). Picked from whichever candidates are actually meaningful
 *  right now, never a fabricated one. */
function pickHighlight(progress: ProgressSummary, streak: number, questionsCovered: number): string {
  const candidates: string[] = [];
  if (streak >= 2) candidates.push(`${streak}-day streak.`);
  if (progress.accuracy !== null) candidates.push(`${Math.round(progress.accuracy * 100)}% accuracy this session.`);
  candidates.push(`${questionsCovered.toLocaleString('en-IN')} questions covered so far.`);
  candidates.push('Session complete.');
  return candidates[Math.floor(Math.random() * candidates.length)] ?? 'Session complete.';
}

export function PracticeShell({ facets, copIndexBase, appVersion }: PracticeShellProps): React.JSX.Element {
  const store = useSessionStore();
  const [showHelp, setShowHelp] = useState(false);
  const [reviewQuestion, setReviewQuestion] = useState<Question | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummaryData | null>(null);

  const refreshStats = useCallback(async (): Promise<UserStats | null> => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return null;
      const body = (await res.json()) as UserStats;
      setStats(body);
      return body;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  // Hydrate saved progress, then resume an in-flight session if one survives in
  // sessionStorage (refresh-mid-session recovery).
  useEffect(() => {
    void (async () => {
      await store.hydrate();
      if (useSessionStore.getState().config === null) {
        await useSessionStore.getState().resumeFromStorage();
      }
    })();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const health = getStorageHealth();
    if (!health.writable && health.message !== null) setStorageWarning(health.message);
  }, [store.attempts]);

  // A bookmark clicked on /insights lands here as /?review=<id> — open it
  // through the exact same review path search results already use, rather
  // than building a second question-detail view.
  useEffect(() => {
    const reviewId = new URLSearchParams(window.location.search).get('review');
    if (reviewId === null) return;
    void (async () => {
      try {
        const res = await fetch(`/api/questions?ids=${encodeURIComponent(reviewId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { questions: Question[] };
        if (body.questions[0] !== undefined) setReviewQuestion(body.questions[0]);
      } finally {
        window.history.replaceState(null, '', '/');
      }
    })();
    // Only ever consult the URL as it was at mount.
  }, []);

  const question = store.currentQuestion();
  const currentId = store.ids[store.index];
  const revealed = currentId !== undefined && store.revealed.has(currentId);
  const attempt = currentId === undefined ? undefined : store.attempts.get(currentId);
  const progress = useMemo(() => summariseProgress(store), [store]);
  const inSession = store.config !== null && store.ids.length > 0;
  const isLastQuestion = store.ids.length > 0 && store.index >= store.ids.length - 1;

  // Natural end of a study-mode session (exam mode ends via the sidebar's
  // "End session" instead — reviewing revealed answers post-submission
  // doesn't have a single "last" moment the same way). Flushes the pending
  // debounced sync first so the streak/coverage numbers shown are current,
  // not whatever they were a fraction of a second before the last answer.
  const handleFinish = useCallback(async (): Promise<void> => {
    const finalProgress = progress;
    await flushNow();
    const freshStats = await refreshStats();
    setSessionSummary({
      progress: finalProgress,
      streak: freshStats?.currentStreak ?? stats?.currentStreak ?? 0,
      questionsCovered: freshStats?.questionsCovered ?? stats?.questionsCovered ?? 0,
      highlight: pickHighlight(
        finalProgress,
        freshStats?.currentStreak ?? stats?.currentStreak ?? 0,
        freshStats?.questionsCovered ?? stats?.questionsCovered ?? 0
      ),
    });
    store.endSession();
  }, [progress, refreshStats, stats, store]);

  const rememberedConfig = useMemo(() => parseRememberedConfig(stats?.lastSessionConfig), [stats]);

  const handleContinuePracticing = useCallback((): void => {
    if (rememberedConfig === null) return;
    void store.startSession({
      ...rememberedConfig,
      count: CONTINUE_PRACTICING_COUNT,
      seed: `s${Date.now().toString(36)}`,
    });
  }, [rememberedConfig, store]);

  const handleSubmitOrAdvance = useCallback((): void => {
    const state = useSessionStore.getState();
    const id = state.ids[state.index];
    if (id === undefined) return;
    if (state.revealed.has(id)) {
      const lastQuestion = state.index >= state.ids.length - 1;
      if (lastQuestion && state.config?.mode !== 'exam') void handleFinish();
      else state.next();
    } else if (state.selection !== null) {
      state.submit();
    }
  }, [handleFinish]);

  useKeyboardShortcuts({
    enabled: inSession && !showHelp && store.prefs.disclaimerAcknowledged,
    onSelect: (index: AnswerIndex) => store.select(index),
    onSubmitOrAdvance: handleSubmitOrAdvance,
    onNext: () => store.next(),
    onPrevious: () => store.previous(),
    onSkip: () => store.skip(),
    onToggleBookmark: () => store.toggleBookmark(),
    onToggleHelp: () => setShowHelp((v) => !v),
  });

  const acknowledged = store.prefs.disclaimerAcknowledged;

  return (
    <>
      <DisclaimerGate
        acknowledged={acknowledged}
        onAcknowledge={() => store.setPrefs({ disclaimerAcknowledged: true })}
      />

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Session setup and search">
          <AccountMenu />
          {stats !== null ? (
            <div className={styles.statsRow}>
              <div className={styles.streakBlock}>
                <span className={`${styles.streakNumber} tabular`}>{stats.currentStreak}</span>
                <span className={styles.streakLabel}>day streak</span>
              </div>
              <p className={styles.coverageLine}>
                <span className="tabular">{stats.questionsCovered.toLocaleString('en-IN')}</span>
                {' / '}
                <span className="tabular">{facets.sessionEligible.toLocaleString('en-IN')}</span> covered
              </p>
            </div>
          ) : null}
          {inSession ? (
            <div className={`glass ${styles.panel}`}>
              <div className={styles.sessionLine}>
                <span>{store.config?.mode === 'exam' ? 'Exam' : 'Study'}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular">{store.ids.length} questions</span>
                <span aria-hidden="true">·</span>
                <code className={styles.seed}>{store.config?.seed}</code>
              </div>
              <NavigatorGrid
                ids={store.ids}
                index={store.index}
                attempts={store.attempts}
                bookmarks={store.bookmarks}
                revealed={store.revealed}
                onJump={(i) => store.goTo(i)}
              />
              {store.config?.mode === 'exam' && !store.submittedPaper ? (
                <Button variant="primary" onClick={() => store.submitPaper()}>
                  Submit paper ({progress.answered}/{progress.total} answered)
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => store.endSession()}>
                End session
              </Button>
              <div className={styles.panelDivider} />
              <SearchField onOpenQuestion={(q) => setReviewQuestion(q)} />
            </div>
          ) : (
            <SessionSetup
              facets={facets}
              busy={store.status === 'planning'}
              error={store.error}
              onStart={(config) => void store.startSession(config)}
            />
          )}

          {inSession ? null : (
            <div className={`glass ${styles.panel}`}>
              <SearchField onOpenQuestion={(q) => setReviewQuestion(q)} />
            </div>
          )}
        </aside>

        <main id="main" className={styles.main}>
          {storageWarning === null ? null : (
            <div role="alert" className={styles.warningBar}>
              {storageWarning}
            </div>
          )}

          {sessionSummary !== null ? (
            <section className={`card ${styles.summary}`} aria-label="Session complete">
              <h1 className={styles.summaryHighlight}>{sessionSummary.highlight}</h1>
              <div className={uiStyles.progressStats}>
                <span className={`tabular ${uiStyles.statCorrect}`}>{sessionSummary.progress.correct} correct</span>
                <span className={`tabular ${uiStyles.statIncorrect}`}>
                  {sessionSummary.progress.incorrect} incorrect
                </span>
                <span className="tabular">{sessionSummary.progress.skipped} skipped</span>
                <span className="tabular">
                  {sessionSummary.progress.accuracy === null
                    ? 'no accuracy yet'
                    : `${Math.round(sessionSummary.progress.accuracy * 100)}% accuracy`}
                </span>
              </div>
              <Button variant="primary" onClick={() => setSessionSummary(null)}>
                Done
              </Button>
            </section>
          ) : reviewQuestion !== null ? (
            <section className={styles.stack} aria-label="Search result">
              <div className={styles.reviewBar}>
                <span>Viewing a search result. Answering is disabled here.</span>
                <Button variant="ghost" onClick={() => setReviewQuestion(null)}>
                  Back to session
                </Button>
              </div>
              <QuestionCard
                question={reviewQuestion}
                position={1}
                total={1}
                selection={null}
                revealed
                verdict="unattempted"
                bookmarked={store.bookmarks.has(reviewQuestion.id)}
                copIndexBase={copIndexBase}
                appVersion={appVersion}
                onSelect={() => undefined}
                onSubmit={() => undefined}
                onToggleBookmark={() => store.toggleBookmark(reviewQuestion.id)}
              />
            </section>
          ) : !inSession ? (
            <div className={styles.stack}>
              {rememberedConfig !== null ? (
                <section className={`card ${styles.continueCard}`}>
                  <h1 className={styles.continueTitle}>Continue practicing</h1>
                  <p className={styles.continueBody}>
                    {CONTINUE_PRACTICING_COUNT} questions, same filters as last time — one tap, no setup.
                  </p>
                  <Button variant="primary" onClick={handleContinuePracticing}>
                    Start
                  </Button>
                </section>
              ) : null}
              <section className={`card ${styles.empty}`}>
                <h1 className={styles.emptyTitle}>Medical MCQ practice</h1>
                <p className={styles.emptyBody}>
                  {facets.sessionEligible.toLocaleString('en-IN')} questions drawn from the MedMCQA and USMLE
                  (MedQA-USMLE) research datasets. Choose a question bank and your filters on the left and start a
                  session.
                </p>
                <p className={styles.emptyHint}>
                  Every answer comes from the dataset itself. Nothing here is generated. Questions with known
                  defects are labelled rather than hidden.
                </p>
              </section>
            </div>
          ) : question === null ? (
            <div className={`card ${styles.empty}`} aria-busy="true">
              <div className={styles.skeletonLine} style={{ width: '70%' }} />
              <div className={styles.skeletonLine} style={{ width: '90%' }} />
              <div className={styles.skeletonBlock} />
              <div className={styles.skeletonBlock} />
            </div>
          ) : (
            <section className={styles.stack} aria-label="Current question">
              <div className={`glass ${styles.progressPanel}`}>
                <ProgressBar
                  value={store.index + 1}
                  max={store.ids.length}
                  label={`Question ${store.index + 1} of ${store.ids.length}`}
                />
                <div className={uiStyles.progressStats}>
                  <span className="tabular">
                    {store.index + 1} / {store.ids.length}
                  </span>
                  <span className={`tabular ${uiStyles.statCorrect}`}>{progress.correct} correct</span>
                  <span className={`tabular ${uiStyles.statIncorrect}`}>{progress.incorrect} incorrect</span>
                  <span className="tabular">{progress.skipped} skipped</span>
                  <span className="tabular">
                    {progress.accuracy === null ? 'no accuracy yet' : `${Math.round(progress.accuracy * 100)}% accuracy`}
                  </span>
                </div>
              </div>

              <QuestionCard
                question={question}
                position={store.index + 1}
                total={store.ids.length}
                selection={store.selection}
                revealed={revealed}
                verdict={revealed ? (attempt?.verdict ?? null) : null}
                bookmarked={store.bookmarks.has(question.id)}
                copIndexBase={copIndexBase}
                appVersion={appVersion}
                onSelect={(i) => store.select(i)}
                onSubmit={() => store.submit()}
                onToggleBookmark={() => store.toggleBookmark()}
              />

              {revealed ? null : <ConfidenceTap value={store.confidence} onChange={(c) => store.setConfidence(c)} />}

              <div className={`glass ${styles.actionBar}`}>
                <Button onClick={() => store.previous()} disabled={store.index === 0}>
                  ← Previous
                </Button>
                <Button variant="ghost" onClick={() => store.skip()} disabled={revealed}>
                  Skip
                </Button>
                <span className={styles.spacer} />
                {revealed && isLastQuestion && store.config?.mode !== 'exam' ? (
                  <Button variant="primary" onClick={() => void handleFinish()}>
                    Finish session
                  </Button>
                ) : revealed ? (
                  <Button variant="primary" onClick={() => store.next()} disabled={isLastQuestion}>
                    Next →
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => store.submit()} disabled={store.selection === null}>
                    Submit answer
                  </Button>
                )}
              </div>

              <p className={styles.shortcutHint}>
                Press <kbd>1</kbd>–<kbd>4</kbd> to choose, <kbd>Enter</kbd> to submit, <kbd>?</kbd> for all
                shortcuts.
              </p>
            </section>
          )}

          <DisclaimerFooter />
        </main>
      </div>

      {showHelp ? (
        <div className={uiStyles.disclaimerOverlay} onClick={() => setShowHelp(false)}>
          <div
            className={uiStyles.disclaimerDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="shortcuts-title" className={uiStyles.disclaimerTitle}>
              Keyboard shortcuts
            </h2>
            <table className={styles.shortcutTable}>
              <tbody>
                {SHORTCUT_HELP.map((s) => (
                  <tr key={s.keys}>
                    <th scope="row">
                      <kbd>{s.keys}</kbd>
                    </th>
                    <td>{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button onClick={() => setShowHelp(false)} style={{ width: '100%', marginTop: 'var(--space-4)' }}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
