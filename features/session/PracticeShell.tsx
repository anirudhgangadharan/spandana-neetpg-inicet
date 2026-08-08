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
import type { AnswerIndex, Question } from '@/types';
import type { Facets } from '@/lib/db/queries';
import { QuestionCard } from '@/components/question/QuestionCard';
import { NavigatorGrid } from '@/components/navigator/NavigatorGrid';
import { SessionSetup } from '@/components/filters/SessionSetup';
import { SearchField } from '@/components/filters/SearchField';
import { Button, ProgressBar, uiStyles } from '@/components/ui/primitives';
import { DisclaimerGate, DisclaimerFooter } from '@/components/Disclaimer';
import { SHORTCUT_HELP, useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getStorageHealth, summariseProgress, useSessionStore } from './store';
import styles from './practice.module.css';

export interface PracticeShellProps {
  readonly facets: Facets;
  readonly copIndexBase: 0 | 1;
  readonly appVersion: string;
}

export function PracticeShell({ facets, copIndexBase, appVersion }: PracticeShellProps): React.JSX.Element {
  const store = useSessionStore();
  const [showHelp, setShowHelp] = useState(false);
  const [reviewQuestion, setReviewQuestion] = useState<Question | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

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

  const question = store.currentQuestion();
  const currentId = store.ids[store.index];
  const revealed = currentId !== undefined && store.revealed.has(currentId);
  const attempt = currentId === undefined ? undefined : store.attempts.get(currentId);
  const progress = useMemo(() => summariseProgress(store), [store]);
  const inSession = store.config !== null && store.ids.length > 0;

  const handleSubmitOrAdvance = useCallback((): void => {
    const state = useSessionStore.getState();
    const id = state.ids[state.index];
    if (id === undefined) return;
    if (state.revealed.has(id)) state.next();
    else if (state.selection !== null) state.submit();
  }, []);

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
          {inSession ? (
            <div className={`glass ${styles.panel}`}>
              <h2 className={styles.panelTitle}>This session</h2>
              <dl className={styles.metaList}>
                <div>
                  <dt>Mode</dt>
                  <dd>{store.config?.mode === 'exam' ? 'Exam' : 'Study'}</dd>
                </div>
                <div>
                  <dt>Questions</dt>
                  <dd className="tabular">{store.ids.length}</dd>
                </div>
                <div>
                  <dt>Seed</dt>
                  <dd>
                    <code className={styles.seed}>{store.config?.seed}</code>
                  </dd>
                </div>
              </dl>
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
            </div>
          ) : (
            <SessionSetup
              facets={facets}
              busy={store.status === 'planning'}
              error={store.error}
              onStart={(config) => void store.startSession(config)}
            />
          )}

          <div className={`glass ${styles.panel}`}>
            <SearchField onOpenQuestion={(q) => setReviewQuestion(q)} />
          </div>
        </aside>

        <main id="main" className={styles.main}>
          {storageWarning === null ? null : (
            <div role="alert" className={styles.warningBar}>
              {storageWarning}
            </div>
          )}

          {reviewQuestion !== null ? (
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

              <div className={`glass ${styles.actionBar}`}>
                <Button onClick={() => store.previous()} disabled={store.index === 0}>
                  ← Previous
                </Button>
                <Button variant="ghost" onClick={() => store.skip()} disabled={revealed}>
                  Skip
                </Button>
                <span className={styles.spacer} />
                {revealed ? (
                  <Button
                    variant="primary"
                    onClick={() => store.next()}
                    disabled={store.index >= store.ids.length - 1}
                  >
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
