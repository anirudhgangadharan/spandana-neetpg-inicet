'use client';

/**
 * I6 — clinical safety framing.
 *
 * "The app displays a persistent, non-dismissible-on-first-run disclaimer … This
 * is not optional boilerplate — the dataset has documented quality issues."
 *
 * Implemented as two things:
 *   1. A first-run dialog that cannot be dismissed without acknowledgement. No
 *      close button, no backdrop dismiss, no Escape — the only exit is the
 *      acknowledge control. Focus is trapped inside it.
 *   2. A persistent footer note that never goes away afterwards.
 *
 * The specific defects named here are the ones actually measured in this corpus,
 * not generic hedging: 1,104 questions have a duplicate elsewhere with a
 * different answer marked correct, and thousands carry the `rt` token-loss
 * corruption.
 */

import { useCallback, useEffect, useRef } from 'react';
import { uiStyles } from '@/components/ui/primitives';
import { Button } from '@/components/ui/primitives';

export interface DisclaimerProps {
  readonly acknowledged: boolean;
  readonly onAcknowledge: () => void;
}

export function DisclaimerGate({ acknowledged, onAcknowledge }: DisclaimerProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const acknowledgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (acknowledged) return;
    acknowledgeRef.current?.focus();

    // Trap focus: this dialog has no dismissal path other than acknowledgement,
    // so Tab must cycle within it and Escape must do nothing.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (focusable === undefined || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [acknowledged]);

  const handleAcknowledge = useCallback(() => onAcknowledge(), [onAcknowledge]);

  if (acknowledged) return null;

  return (
    <div className={uiStyles.disclaimerOverlay}>
      <div
        ref={dialogRef}
        className={uiStyles.disclaimerDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
        aria-describedby="disclaimer-body"
      >
        <h1 id="disclaimer-title" className={uiStyles.disclaimerTitle}>
          Before you start
        </h1>
        <div id="disclaimer-body" className={uiStyles.disclaimerBody}>
          <p>
            <strong>This is exam-preparation material, not clinical guidance.</strong> Every question and
            answer here comes from a public research dataset &mdash; MedMCQA (AIIMS / NEET-PG style questions)
            or USMLE (MedQA-USMLE, US medical licensing exam questions), labelled per card. It must not be used
            to make decisions about patient care.
          </p>
          <p>
            <strong>The datasets contain known errors.</strong> They are documented, and this app shows them to
            you rather than hiding them. In the MedMCQA portion of the corpus:
          </p>
          <ul style={{ margin: 0, paddingInlineStart: '20px', display: 'grid', gap: 'var(--space-1)' }}>
            <li>
              1,104 questions appear twice with <em>different</em> answers marked correct. Those are labelled
              &ldquo;Disputed answer&rdquo;.
            </li>
            <li>
              Thousands of questions have the letters &ldquo;rt&rdquo; missing from words &mdash;
              &ldquo;artery&rdquo; printed as &ldquo;aery&rdquo;. Those are labelled &ldquo;Possible text
              error&rdquo;. The text is deliberately <em>not</em> auto-corrected.
            </li>
            <li>About one question in eight has no explanation at all.</li>
          </ul>
          <p>
            The USMLE portion has no explanation field at all &mdash; every USMLE card shows the same honest
            empty state for that reason, not because anything is missing or hidden.
          </p>
          <p>
            Nothing on any card is generated, inferred, or rewritten. Where the dataset is silent, this app is
            silent too. When an answer looks wrong to you, it may well be &mdash; use
            &ldquo;Report this question&rdquo; to copy its exact source record.
          </p>
        </div>
        <Button ref={acknowledgeRef} variant="primary" onClick={handleAcknowledge} style={{ width: '100%' }}>
          I understand — start practising
        </Button>
      </div>
    </div>
  );
}

/**
 * The persistent note, plus the credits §2.4 requires: the paper cited and the
 * dataset repository linked. This is a licence obligation on a public
 * deployment, not decoration — Apache-2.0 redistribution requires attribution.
 */
export function DisclaimerFooter(): React.JSX.Element {
  return (
    <footer className={uiStyles.disclaimerBar}>
      <p>
        <strong>Not clinical guidance.</strong> Exam-preparation material only, drawn from a public research
        dataset that contains known errata. Never use it for patient care decisions.
      </p>
      <p style={{ marginTop: 'var(--space-2)' }}>
        MedMCQA questions — Pal, Umapathi &amp; Sankarasubbu,{' '}
        <em>MedMCQA: A Large-scale Multi-Subject Multi-Choice Dataset for Medical domain Question Answering</em>,
        PMLR v174, 2022.{' '}
        <a href="https://proceedings.mlr.press/v174/pal22a.html" target="_blank" rel="noreferrer noopener">
          Paper
        </a>
        {' · '}
        <a href="https://github.com/medmcqa/medmcqa" target="_blank" rel="noreferrer noopener">
          Dataset repository
        </a>
        {' · '}
        <a
          href="https://huggingface.co/datasets/openlifescienceai/medmcqa"
          target="_blank"
          rel="noreferrer noopener"
        >
          Licence (Apache-2.0)
        </a>
      </p>
      <p style={{ marginTop: 'var(--space-2)' }}>
        USMLE questions — Jin, Pan, Oufattole, Weng, Fang &amp; Szolovits,{' '}
        <em>What Disease does this Patient Have? A Large-scale Open Domain Question Answering Dataset from
        Medical Exams</em>, arXiv:2009.13081, 2020 (&ldquo;MedQA-USMLE&rdquo;, US English subset).{' '}
        <a href="https://arxiv.org/abs/2009.13081" target="_blank" rel="noreferrer noopener">
          Paper
        </a>
        {' · '}
        <a href="https://github.com/jind11/MedQA" target="_blank" rel="noreferrer noopener">
          Dataset repository
        </a>
        . No licence file accompanied the copy of this dataset used to build this corpus; a specific
        redistribution licence is not asserted here.
      </p>
      <p style={{ marginTop: 'var(--space-2)' }}>
        Answers come from the datasets alone. Nothing is generated, inferred, or auto-corrected; questions with
        known defects are labelled rather than hidden.
      </p>
    </footer>
  );
}
