'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import type { StudentAttemptView } from '@/lib/db/moduleAttempts';
import styles from '@/app/module-exam.module.css';

type Choice = 0 | 1 | 2 | 3 | null;

export function FinalAttemptClient({ initialView }: { readonly initialView: StudentAttemptView }): React.JSX.Element {
  const [view, setView] = useState(initialView);
  const [position, setPosition] = useState(1);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const choicesRef = useRef<Record<number, Choice>>({});
  const [remainingMs, setRemainingMs] = useState(initialView.status === 'active'
    ? Math.max(0, Date.parse(initialView.deadlineAt) - Date.parse(initialView.serverNow)) : 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const inFlight = useRef(false);
  const automaticSent = useRef(false);
  const key = `faculty-answers:${initialView.id}`;

  const finish = useCallback((result: StudentAttemptView) => {
    setView(result);
    setError(null);
    try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
  }, [key]);

  useEffect(() => {
    if (initialView.status !== 'active') return;
    const recovered: Record<number, Choice> = Object.fromEntries(
      initialView.responses.map((item) => [item.position, item.selectedIndex])
    );
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [rawPosition, answer] of Object.entries(stored)) {
          const p = Number(rawPosition);
          if (Number.isInteger(p) && p >= 1 && p <= initialView.questions.length &&
            (answer === null || answer === 0 || answer === 1 || answer === 2 || answer === 3)) recovered[p] = answer;
        }
      }
    } catch { setStorageFailed(true); }
    choicesRef.current = recovered;
    setChoices(recovered);
  }, [initialView, key]);

  useEffect(() => {
    if (view.status !== 'active') return;
    const started = performance.now();
    const duration = Date.parse(view.deadlineAt) - Date.parse(view.serverNow);
    const tick = () => setRemainingMs(Math.max(0, duration - (performance.now() - started)));
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [view]);

  function select(answer: Choice): void {
    if (view.status !== 'active' || remainingMs <= 0 || inFlight.current) return;
    const next = { ...choicesRef.current, [position]: answer };
    choicesRef.current = next;
    setChoices(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { setStorageFailed(true); }
  }

  async function submit(automatic: boolean): Promise<void> {
    if (inFlight.current || view.status !== 'active') return;
    if (!automatic && remainingMs > 0 && !window.confirm('Submit this attempt? You cannot change your answers afterward.')) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const answers = Object.entries(choicesRef.current)
      .filter(([, answer]) => answer !== null)
      .map(([p, selectedIndex]) => ({ position: Number(p), selectedIndex }));
    try {
      const response = await fetch(`/api/module-attempts/${initialView.id}/submit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message ?? 'Submission failed.');
      }
      finish(await response.json() as StudentAttemptView);
    } catch (cause) {
      // The request may have committed even if its response was lost.
      try {
        const current = await fetch(`/api/module-attempts/${initialView.id}`, { cache: 'no-store' });
        if (current.ok) {
          const result = await current.json() as StudentAttemptView;
          if (result.status !== 'active') { finish(result); return; }
        }
      } catch { /* Local choices remain available for retry. */ }
      setError(cause instanceof Error ? cause.message : 'Connection lost. Retry submission.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (view.status !== 'active' || remainingMs > 0 || automaticSent.current) return;
    automaticSent.current = true;
    void submit(true);
    // submit reads the current choice ref when the server-timed countdown ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, view.status]);

  if (view.status !== 'active') return <>
    <header className={styles.header}><h1>{view.title}: result</h1></header>
    <section className={`card ${styles.panel}`}><h2>{view.status === 'expired' ? 'Expired without saved answers' : 'Submitted'}</h2>
      <p className={styles.score}>{view.score} / {view.maxPoints} points</p>
      <p>{view.correctCount} correct · {view.wrongCount} incorrect · {view.unansweredCount} unanswered</p>
    </section>
    {view.review ? <section className={`card ${styles.panel}`}><h2>Answer review</h2>
      <ol className={styles.reviewList}>{view.review.map((q) => <li key={q.position}><h3>{q.position}. {q.stem}</h3>
        <ol type="A">{q.options.map((option, index) => <li key={index}>{option}
          {index === q.correctIndex ? ' — correct answer' : ''}{index === q.selectedIndex ? ' — your choice' : ''}
        </li>)}</ol>{q.explanation ? <p>{q.explanation}</p> : null}</li>)}</ol>
    </section> : <p>Answer review is disabled for this test.</p>}
  </>;

  const q = view.questions[position - 1];
  const answered = Object.values(choices).filter((answer) => answer !== null).length;
  const seconds = Math.ceil(remainingMs / 1000);
  const timeText = `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return <>
    <header className={styles.header}><h1>{view.title}</h1>
      <p>Attempt {view.attemptNumber} · {answered} of {view.questions.length} answered</p>
      <div className={styles.timerBox}><span>Time remaining</span><span role="timer" aria-live="off" className={styles.timer}>{timeText}</span>
        <span role="status" className="sr-only">{remainingMs <= 60_000 ? 'Less than one minute remains.' : ''}</span></div>
    </header>
    <p className={styles.notice}>Answers stay only in this browser until submission. A browser or connection failure may lose them. Time expiry triggers automatic submission.</p>
    {storageFailed ? <p role="alert" className={styles.error}>This browser cannot restore answers after refresh. Keep this page open until submission.</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <p role="status" className={styles.saveStatus}>Answers not yet saved to the server.</p>
    <div className={styles.examGrid}><section className={`card ${styles.panel}`} aria-labelledby="question-heading">
      <h2 id="question-heading" tabIndex={-1}>Question {position} of {view.questions.length}</h2>
      {q ? <><p className={styles.stem}>{q.stem}</p>
        <p className={styles.meta}>{q.source} · {q.subject}{q.topic ? ` · ${q.topic}` : ''}</p>
        <fieldset className={styles.choices} disabled={remainingMs <= 0 || submitting}>
          <legend className="sr-only">Choose one answer for question {position}</legend>
          {q.options.map((option, index) => <label key={index} className={styles.choice}>
            <input type="radio" name={`question-${position}`} checked={choices[position] === index}
              onChange={() => select(index as 0 | 1 | 2 | 3)} />
            <span>{String.fromCharCode(65 + index)}. {option}</span></label>)}
        </fieldset><Button variant="ghost" disabled={remainingMs <= 0 || submitting || choices[position] == null}
          onClick={() => select(null)}>Clear answer</Button></> : null}
      <div className={styles.actions}><Button disabled={position === 1} onClick={() => setPosition(position - 1)}>← Previous</Button>
        <Button disabled={position === view.questions.length} onClick={() => setPosition(position + 1)}>Next →</Button></div>
    </section><nav className={`card ${styles.panel}`} aria-label="Question navigation"><h2>Questions</h2>
      <div className={styles.numberGrid}>{view.questions.map((item) => <button key={item.position} type="button"
        aria-label={`Question ${item.position}, ${choices[item.position] == null ? 'unanswered' : 'answered'}`}
        aria-current={item.position === position ? 'step' : undefined}
        data-answered={choices[item.position] != null ? 'true' : undefined}
        className={item.position === position ? styles.currentNumber : styles.number}
        onClick={() => setPosition(item.position)}>{item.position}</button>)}</div>
    </nav></div>
    <section className={`card ${styles.panel}`}><h2>Finish attempt</h2>
      <p>Submission is final. Unanswered questions follow your professor’s marking policy.</p>
      <Button variant="primary" disabled={submitting} onClick={() => void submit(false)}>
        {submitting ? 'Submitting…' : error ? 'Retry submission' : 'Submit attempt'}</Button>
    </section>
  </>;
}
