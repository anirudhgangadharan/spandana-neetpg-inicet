'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import type { StudentAttemptView, StudentSavedResponse } from '@/lib/db/moduleAttempts';
import styles from '@/app/module-exam.module.css';

type Selection = 0 | 1 | 2 | 3 | null;
type SaveState = 'saved' | 'saving' | 'offline' | 'conflict';

function initialChoices(view: StudentAttemptView): Record<number, Selection> {
  if (view.status !== 'active') return {};
  return Object.fromEntries(view.responses.map((response) => [response.position, response.selectedIndex]));
}

function pendingKey(studentId: string, attemptId: string): string {
  return `faculty-unsent:${studentId}:${attemptId}`;
}

function readableTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 3600).toString().padStart(2, '0')}:${Math.floor(total % 3600 / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

export function AttemptClient({ initialView, studentId }: {
  readonly initialView: StudentAttemptView;
  readonly studentId: string;
}): React.JSX.Element {
  const [view, setView] = useState<StudentAttemptView>(initialView);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [position, setPosition] = useState(1);
  const positionRef = useRef(position);
  positionRef.current = position;
  const [choices, setChoices] = useState<Record<number, Selection>>(() => initialChoices(initialView));
  const [pendingCount, setPendingCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(initialView.status === 'active'
    ? Math.max(0, Date.parse(initialView.deadlineAt) - Date.parse(initialView.serverNow)) : 0);
  const remainingRef = useRef(remainingMs);
  remainingRef.current = remainingMs;
  const pendingRef = useRef(new Map<number, Selection>());
  const revisionsRef = useRef(new Map<number, number>());
  const runRef = useRef<Promise<void> | null>(null);
  const pausedRef = useRef(false);
  const expiryRequestedRef = useRef(false);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstQuestionRenderRef = useRef(true);
  const storageKey = pendingKey(studentId, initialView.id);

  const persistPending = useCallback((): void => {
    try {
      if (pendingRef.current.size === 0) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify([...pendingRef.current]));
    } catch {
      setError('This browser could not retain unsent answers across a refresh. Keep this page open until saving succeeds.');
    }
    setPendingCount(pendingRef.current.size);
  }, [storageKey]);

  const finish = useCallback((result: StudentAttemptView): void => {
    if (result.status === 'active') return;
    pendingRef.current.clear();
    persistPending();
    setView(result);
    setError(null);
    setSaveState('saved');
  }, [persistPending]);

  const fetchCurrent = useCallback(async (): Promise<StudentAttemptView> => {
    const response = await fetch(`/api/module-attempts/${initialView.id}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not reconnect to the server.');
    return await response.json() as StudentAttemptView;
  }, [initialView.id]);

  const observe = useCallback((observedPosition: number | null): void => {
    if (viewRef.current.status !== 'active') return;
    void fetch(`/api/module-attempts/${initialView.id}/activity`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      keepalive: true, body: JSON.stringify({ position: observedPosition }),
    }).catch(() => undefined);
  }, [initialView.id]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (runRef.current) {
      await runRef.current;
      return pendingRef.current.size === 0;
    }
    if (pausedRef.current || viewRef.current.status !== 'active') return false;
    const run = (async () => {
      while (pendingRef.current.size > 0 && !pausedRef.current && viewRef.current.status === 'active') {
        const [questionPosition, selectedIndex] = pendingRef.current.entries().next().value as [number, Selection];
        setSaveState('saving');
        try {
          const response = await fetch(`/api/module-attempts/${initialView.id}/responses`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ position: questionPosition, selectedIndex,
              expectedRevision: revisionsRef.current.get(questionPosition) ?? 0 }),
          });
          if (response.status === 409) {
            const current = await fetchCurrent();
            if (current.status !== 'active') {
              finish(current);
              return;
            }
            revisionsRef.current = new Map(current.responses.map((item) => [item.position, item.revision]));
            pausedRef.current = true;
            setSaveState('conflict');
            setError('An answer changed in another tab or this attempt ended. Review the saved answers before replacing them.');
            return;
          }
          if (!response.ok) {
            const data = await response.json() as { message?: string };
            throw new Error(data.message ?? 'Could not save this answer.');
          }
          const saved = await response.json() as StudentSavedResponse;
          revisionsRef.current.set(questionPosition, saved.revision);
          if (pendingRef.current.get(questionPosition) === selectedIndex) pendingRef.current.delete(questionPosition);
          persistPending();
          setSaveState(pendingRef.current.size === 0 ? 'saved' : 'saving');
          setError(null);
        } catch (cause) {
          setSaveState('offline');
          setError(cause instanceof Error ? cause.message : 'Connection lost. Your unsent choice is held in this tab.');
          return;
        }
      }
    })();
    runRef.current = run;
    try { await run; } finally { runRef.current = null; }
    return pendingRef.current.size === 0;
  }, [fetchCurrent, finish, initialView.id, persistPending]);

  useEffect(() => {
    if (initialView.status !== 'active') return;
    revisionsRef.current = new Map(initialView.responses.map((response) => [response.position, response.revision]));
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as unknown;
      if (Array.isArray(stored)) {
        const restored: Record<number, Selection> = {};
        for (const entry of stored) {
          if (!Array.isArray(entry) || entry.length !== 2) continue;
          const [questionPosition, selection] = entry as unknown[];
          if (!Number.isInteger(questionPosition) || (questionPosition as number) < 1 ||
              (questionPosition as number) > initialView.questions.length ||
              (selection !== null && selection !== 0 && selection !== 1 && selection !== 2 && selection !== 3)) continue;
          pendingRef.current.set(questionPosition as number, selection as Selection);
          restored[questionPosition as number] = selection as Selection;
        }
        setChoices((previous) => ({ ...previous, ...restored }));
        setPendingCount(pendingRef.current.size);
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
    if (pendingRef.current.size > 0) void flush();
    // The initial server snapshot and attempt identity do not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view.status !== 'active') return;
    const serverNow = Date.parse(view.serverNow);
    const deadline = Date.parse(view.deadlineAt);
    const started = performance.now();
    const tick = () => setRemainingMs(Math.max(0, deadline - serverNow - (performance.now() - started)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (firstQuestionRenderRef.current) {
      firstQuestionRenderRef.current = false;
      return;
    }
    questionHeadingRef.current?.focus();
  }, [position]);

  useEffect(() => {
    const reconnect = () => {
      if (viewRef.current.status !== 'active') return;
      if (remainingRef.current <= 0) {
        void fetchCurrent().then((current) => {
          if (current.status === 'active') setView(current);
          else finish(current);
        }).catch(() => undefined);
      } else if (!pausedRef.current && pendingRef.current.size > 0) void flush();
    };
    window.addEventListener('online', reconnect);
    const interval = window.setInterval(reconnect, 10_000);
    return () => { window.removeEventListener('online', reconnect); window.clearInterval(interval); };
  }, [fetchCurrent, finish, flush]);

  useEffect(() => {
    if (view.status !== 'active') return;
    observe(positionRef.current);
    const visibility = () => observe(document.visibilityState === 'hidden' ? null : positionRef.current);
    const pageHide = () => observe(null);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHide);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [observe, view.status]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  useEffect(() => {
    if (view.status !== 'active' || remainingMs > 0 || expiryRequestedRef.current) return;
    expiryRequestedRef.current = true;
    void fetchCurrent().then((current) => {
      if (current.status === 'active') {
        setView(current);
        expiryRequestedRef.current = false;
      } else finish(current);
    }).catch(() => {
      setSaveState('offline');
      setError('Time has ended. Reconnect to finish and see the server-scored result.');
      expiryRequestedRef.current = false;
    });
  }, [fetchCurrent, finish, remainingMs, view.status]);

  function select(selected: Selection): void {
    if (viewRef.current.status !== 'active' || remainingMs <= 0 || submitting) return;
    setChoices((previous) => ({ ...previous, [position]: selected }));
    pendingRef.current.set(position, selected);
    persistPending();
    if (!pausedRef.current) void flush();
  }

  function goTo(nextPosition: number): void {
    const activeView = viewRef.current;
    if (activeView.status !== 'active' || nextPosition === position || nextPosition < 1 ||
        nextPosition > activeView.questions.length) return;
    observe(nextPosition);
    setPosition(nextPosition);
  }

  async function resolveConflict(keepLocal: boolean): Promise<void> {
    try {
      const current = await fetchCurrent();
      if (current.status !== 'active') return finish(current);
      revisionsRef.current = new Map(current.responses.map((item) => [item.position, item.revision]));
      if (!keepLocal) {
        pendingRef.current.clear();
        persistPending();
        setChoices(initialChoices(current));
      }
      setView(current);
      pausedRef.current = false;
      setSaveState('saved');
      setError(null);
      if (keepLocal) void flush();
    } catch {
      setSaveState('offline');
      setError('Could not load server answers. Try again when connected.');
    }
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    if (remainingMs > 0 && !window.confirm('Submit this attempt now? You will not be able to change your answers afterward.')) return;
    setSubmitting(true);
    setError(null);
    try {
      if (remainingMs > 0 && !(await flush())) {
        setError('Some answers are not saved. Reconnect or resolve the conflict before submitting.');
        return;
      }
      const response = await fetch(`/api/module-attempts/${initialView.id}/submit`, { method: 'POST', cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message ?? 'Could not submit.');
      }
      finish(await response.json() as StudentAttemptView);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit. Check your connection.');
    } finally { setSubmitting(false); }
  }

  if (view.status !== 'active') return <>
    <header className={styles.header}><h1>{view.title}: result</h1></header>
    <section className={`card ${styles.panel}`} aria-labelledby="result-heading">
      <h2 id="result-heading">{view.status === 'expired' ? 'Time ended' : 'Submitted'}</h2>
      <p className={styles.score}>{view.score} / {view.maxPoints} points</p>
      <p>{view.correctCount} correct · {view.wrongCount} incorrect · {view.unansweredCount} unanswered</p>
      <p>Attempt {view.attemptNumber} · Finished {new Date(view.submittedAt).toLocaleString()}</p>
      {view.review === null ? <p>Answer review is disabled for this module. Your score is available now.</p> : null}
      <Link href="/">Return to practice</Link>
    </section>
    {view.review ? <section className={`card ${styles.panel}`} aria-labelledby="review-heading">
      <h2 id="review-heading">Answer review</h2>
      <ol className={styles.reviewList}>{view.review.map((question) => <li key={question.position}>
        <h3>{question.position}. {question.stem}</h3>
        <ol type="A">{question.options.map((option, index) => <li key={index}>
          {option}{index === question.correctIndex ? ' — correct answer' : ''}
          {index === question.selectedIndex ? ' — your choice' : ''}
        </li>)}</ol>
        {question.explanation ? <p>{question.explanation}</p> : <p>No explanation is available for this question.</p>}
      </li>)}</ol>
    </section> : null}
  </>;

  const question = view.questions[position - 1];
  const answered = Object.values(choices).filter((choice) => choice !== null).length;
  const announcement = remainingMs <= 0 ? 'Time has ended.'
    : remainingMs <= 60_000 ? 'Less than one minute remains.'
      : remainingMs <= 300_000 ? 'Less than five minutes remain.' : '';
  return <>
    <header className={styles.header}>
      <h1>{view.title}</h1>
      <p>Attempt {view.attemptNumber} · {answered} of {view.questions.length} answered</p>
      <div className={styles.timerBox}>
        <span>Time remaining</span>
        <span role="timer" aria-live="off" className={styles.timer}>{readableTime(remainingMs)}</span>
        <span role="status" className="sr-only">{announcement}</span>
      </div>
    </header>
    <p className={styles.notice}>The server enforces the deadline. Offline choices are held only in this tab and cannot be accepted after time runs out.</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <p role="status" className={styles.saveStatus}>
      {saveState === 'saved' && pendingCount === 0 ? 'All answers saved.'
        : saveState === 'saving' ? `Saving ${pendingCount} answer${pendingCount === 1 ? '' : 's'}…`
          : saveState === 'conflict' ? `${pendingCount} unsaved answer${pendingCount === 1 ? '' : 's'} need your decision.`
            : `${pendingCount} unsaved answer${pendingCount === 1 ? '' : 's'}. Reconnect to retry.`}
    </p>
    {saveState === 'conflict' ? <div className={styles.actions}>
      <Button onClick={() => void resolveConflict(false)}>Use server answers</Button>
      <Button onClick={() => void resolveConflict(true)}>Keep and retry my choices</Button>
    </div> : saveState === 'offline' && pendingCount > 0 ? <Button onClick={() => void flush()}>Retry saving</Button> : null}
    <div className={styles.examGrid}>
      <section className={`card ${styles.panel}`} aria-labelledby="question-heading">
        <h2 id="question-heading" ref={questionHeadingRef} tabIndex={-1}>Question {position} of {view.questions.length}</h2>
        {question ? <>
          <p className={styles.stem}>{question.stem}</p>
          <p className={styles.meta}>{question.source} · {question.subject}{question.topic ? ` · ${question.topic}` : ''}</p>
          <fieldset className={styles.choices} disabled={remainingMs <= 0 || submitting}>
            <legend className="sr-only">Choose one answer for question {position}</legend>
            {question.options.map((option, index) => <label key={index} className={styles.choice}>
              <input type="radio" name={`question-${position}`} checked={choices[position] === index}
                onChange={() => select(index as 0 | 1 | 2 | 3)} />
              <span>{String.fromCharCode(65 + index)}. {option}</span>
            </label>)}
          </fieldset>
          <Button variant="ghost" disabled={remainingMs <= 0 || submitting || choices[position] == null}
            onClick={() => select(null)}>Clear answer</Button>
        </> : null}
        <div className={styles.actions}>
          <Button disabled={position === 1} onClick={() => goTo(position - 1)}>← Previous</Button>
          <Button disabled={position === view.questions.length} onClick={() => goTo(position + 1)}>Next →</Button>
        </div>
      </section>
      <nav className={`card ${styles.panel}`} aria-label="Question navigation">
        <h2>Questions</h2>
        <div className={styles.numberGrid}>{view.questions.map((item) => <button key={item.position}
          type="button" aria-label={`Question ${item.position}, ${choices[item.position] == null ? 'unanswered' : 'answered'}`}
          aria-current={item.position === position ? 'step' : undefined}
          data-answered={choices[item.position] != null ? 'true' : undefined}
          className={item.position === position ? styles.currentNumber : styles.number}
          onClick={() => goTo(item.position)}>{item.position}</button>)}</div>
      </nav>
    </div>
    <section className={`card ${styles.panel}`} aria-labelledby="submit-heading">
      <h2 id="submit-heading">Finish attempt</h2>
      <p>Unanswered questions count according to your professor’s marking policy. Once submitted, you cannot change this attempt.</p>
      <Button variant="primary" disabled={submitting || saveState === 'conflict'} onClick={() => void submit()}>
        {submitting ? 'Submitting…' : 'Submit attempt'}
      </Button>
    </section>
  </>;
}
