'use client';

/**
 * The question card (§8 P0, §9.3).
 *
 * Everything correctness-related on this card comes from `lib/core/`:
 * `correctOptionPosition` for which row to mark, `correctOptionText` for the
 * announcement. This component contains no comparison of its own (I1).
 */

import { useCallback, useMemo, useState } from 'react';
import type { AnswerIndex, Question, Verdict } from '@/types';
import { correctOptionPosition, correctOptionText } from '@/lib/core/verdict';
import { Badge, IconButton } from '@/components/ui/primitives';
import { SOURCE_LABEL } from '@/lib/constants/sources';
import { FLAG_PRESENTATION, flagsForCard, flagsForDetail } from './flags';
import { OptionGroup } from './OptionGroup';
import styles from './question.module.css';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface QuestionCardProps {
  readonly question: Question;
  readonly position: number;
  readonly total: number;
  readonly selection: AnswerIndex | null;
  readonly revealed: boolean;
  readonly verdict: Verdict | null;
  readonly bookmarked: boolean;
  readonly copIndexBase: 0 | 1;
  readonly appVersion: string;
  readonly onSelect: (index: AnswerIndex) => void;
  readonly onSubmit: () => void;
  readonly onToggleBookmark: () => void;
}

function BookmarkGlyph({ filled }: { readonly filled: boolean }): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 3.5h10a1 1 0 011 1v12l-6-3.5-6 3.5v-12a1 1 0 011-1z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function QuestionCard({
  question,
  position,
  total,
  selection,
  revealed,
  verdict,
  bookmarked,
  copIndexBase,
  appVersion,
  onSelect,
  onSubmit,
  onToggleBookmark,
}: QuestionCardProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Read once, through the sanctioned accessor.
  const correctPosition = revealed ? correctOptionPosition(question) : null;
  const correctText = useMemo(() => correctOptionText(question), [question]);

  const cardFlags = flagsForCard(question.flags);
  const detailFlags = flagsForDetail(question.flags);

  /**
   * I5 — "Report this question" copies enough to trace the item back to a
   * specific dataset record.
   *
   * `datasetAnswer`/`datasetAnswerEncoding` are branched by `question.source`:
   * MedMCQA's answer is encoded as `cop`, an integer offset by `copIndexBase`
   * (H1) — expressing it that way lets the report be compared against the raw
   * JSON directly. USMLE has no `cop` and no index-base ambiguity at all; its
   * native encoding is the letter itself (`answer_idx`), so reporting a
   * `copIndexBase`-adjusted number for a USMLE question would be reporting a
   * fact about a field that record doesn't have (D-025).
   */
  const handleReport = useCallback(() => {
    const letter = LETTERS[correctOptionPosition(question)];
    const payload = {
      id: question.id,
      source: question.source,
      split: question.split,
      datasetAnswer: question.source === 'medmcqa' ? correctOptionPosition(question) + copIndexBase : letter,
      datasetAnswerEncoding: question.source === 'medmcqa' ? `${copIndexBase}-based (cop)` : 'letter (answer_idx)',
      resolvedAnswerLetter: letter,
      selectedIndex: selection,
      selectedLetter: selection === null ? null : LETTERS[selection],
      flags: question.flags,
      appVersion,
    };
    void navigator.clipboard
      .writeText(JSON.stringify(payload, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      })
      .catch(() => setCopied(false));
  }, [appVersion, copIndexBase, question, selection]);

  /**
   * §10 — the announcement must stand alone: "Incorrect. The correct answer is
   * C: Atrophy." Colour is never the sole carrier of the verdict.
   */
  const announcement = !revealed
    ? ''
    : verdict === 'correct'
      ? `Correct. The answer is ${LETTERS[correctOptionPosition(question)]}: ${correctText}.`
      : verdict === 'skipped'
        ? `Skipped. The correct answer is ${LETTERS[correctOptionPosition(question)]}: ${correctText}.`
        : `Incorrect. The correct answer is ${LETTERS[correctOptionPosition(question)]}: ${correctText}.`;

  return (
    <article className={`card ${styles.card}`} aria-labelledby={`stem-${question.id}`}>
      <header className={styles.header}>
        <Badge tone="accent">{question.subject}</Badge>
        {question.topic === null ? (
          <Badge title="This question has no topic label in the source dataset.">Uncategorised</Badge>
        ) : (
          <Badge>{question.topic}</Badge>
        )}
        {cardFlags.map((flag) => (
          <Badge key={flag} tone="warning" title={FLAG_PRESENTATION[flag].description}>
            {FLAG_PRESENTATION[flag].label}
          </Badge>
        ))}
        <span className={styles.spacer} />
        <span className="tabular" style={{ fontSize: 'var(--text-caption)', color: 'var(--text-tertiary)' }}>
          {position} / {total}
        </span>
        <IconButton
          label={bookmarked ? 'Remove bookmark' : 'Bookmark this question'}
          active={bookmarked}
          onClick={onToggleBookmark}
        >
          <BookmarkGlyph filled={bookmarked} />
        </IconButton>
      </header>

      <h2 id={`stem-${question.id}`} className={styles.stem}>
        {question.stem}
      </h2>

      <OptionGroup
        questionId={question.id}
        options={question.options}
        selected={selection}
        correctPosition={correctPosition}
        revealed={revealed}
        onSelect={onSelect}
        onSubmit={onSubmit}
      />

      {/* Verdict is announced politely and rendered with an icon + text, never
          colour alone (§10). */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {revealed && verdict !== null ? (
        <div
          className={`${styles.verdict} ${
            verdict === 'correct'
              ? styles.verdictCorrect
              : verdict === 'skipped'
                ? styles.verdictSkipped
                : styles.verdictIncorrect
          }`}
        >
          <div>
            <div className={styles.verdictTitle}>
              {verdict === 'correct' ? '✓ Correct' : verdict === 'skipped' ? '— Skipped' : '✕ Incorrect'}
            </div>
            {verdict === 'correct' ? null : (
              <div className={styles.verdictBody}>
                The correct answer is <strong>{LETTERS[correctOptionPosition(question)]}</strong> — {correctText}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {revealed ? (
        <section className={styles.explanation} aria-label="Explanation">
          <h3 className={styles.explanationTitle}>Explanation</h3>
          {question.explanation === null ? (
            /* An honest empty state — never a generated one (I2). */
            <p className={styles.explanationEmpty}>
              <span aria-hidden="true">○</span>
              <span>
                The source dataset has no explanation for this question. Nothing is generated to fill the gap —
                what you see is only ever what the dataset contains.
              </span>
            </p>
          ) : (
            <p className={styles.explanationBody}>{question.explanation}</p>
          )}
        </section>
      ) : null}

      <footer className={styles.provenance}>
        {/* I5 — every card exposes its dataset id and source split. */}
        <span>
          Source: {SOURCE_LABEL[question.source]} <code className={styles.provenanceId}>{question.id}</code> (
          {question.split})
        </span>
        <button
          type="button"
          className={styles.reportButton}
          onClick={() => setShowDetail((v) => !v)}
          aria-expanded={showDetail}
        >
          {showDetail ? 'Hide details' : 'Details'}
        </button>
        <button type="button" className={styles.reportButton} onClick={handleReport}>
          {copied ? 'Copied to clipboard' : 'Report this question'}
        </button>
      </footer>

      {showDetail ? (
        <div className={styles.explanationEmpty} style={{ flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div>
            <strong>Question bank:</strong> {SOURCE_LABEL[question.source]}
          </div>
          <div>
            <strong>Dataset id:</strong> <code className={styles.provenanceId}>{question.id}</code>
          </div>
          <div>
            <strong>Split:</strong> {question.split}
          </div>
          <div>
            <strong>Choice type:</strong> {question.choiceType}
          </div>
          {question.duplicateOf === null ? null : (
            <div>
              <strong>Duplicate of:</strong>{' '}
              <code className={styles.provenanceId}>{question.duplicateOf}</code>
            </div>
          )}
          {detailFlags.length === 0 && cardFlags.length === 0 ? (
            <div>No data-quality flags on this record.</div>
          ) : (
            <ul style={{ margin: 0, paddingInlineStart: 'var(--space-4)' }}>
              {[...cardFlags, ...detailFlags].map((flag) => (
                <li key={flag} style={{ marginBottom: 'var(--space-1)' }}>
                  <strong>{FLAG_PRESENTATION[flag].label}:</strong> {FLAG_PRESENTATION[flag].description}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}
