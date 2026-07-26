'use client';

/**
 * The option list, as a real radiogroup with roving tabindex (§10).
 *
 * Not divs with click handlers: `role="radiogroup"` wrapping `role="radio"`
 * buttons, one tab stop for the whole group, arrow keys moving within it, and
 * `aria-checked` carrying the selection to assistive technology.
 *
 * Keyboard split (documented in A11Y.md): ↑/↓ move within the group, while ←/→
 * are reserved for question navigation because §8 P0 assigns them that role
 * globally. Home/End jump to the first and last option.
 *
 * This component NEVER reads `q.answerIndex`. The correct position arrives as a
 * prop already resolved through `lib/core`, so the CI grep in
 * `scripts/ci/check-invariants.mjs` stays meaningful (I3).
 */

import { useCallback, useEffect, useRef } from 'react';
import type { AnswerIndex } from '@/types';
import styles from './question.module.css';

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const INDICES: readonly AnswerIndex[] = [0, 1, 2, 3];

export type OptionState = 'idle' | 'selected' | 'correct' | 'incorrect' | 'dimmed';

export interface OptionGroupProps {
  readonly questionId: string;
  readonly options: readonly [string, string, string, string];
  readonly selected: AnswerIndex | null;
  /** Resolved via `correctOptionPosition()`; null until the verdict is revealed. */
  readonly correctPosition: AnswerIndex | null;
  readonly revealed: boolean;
  readonly onSelect: (index: AnswerIndex) => void;
  readonly onSubmit: () => void;
}

function CheckGlyph(): React.JSX.Element {
  return (
    <svg className={`${styles.optionGlyph} ${styles.glyphCorrect}`} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossGlyph(): React.JSX.Element {
  return (
    <svg className={`${styles.optionGlyph} ${styles.glyphIncorrect}`} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5.5 5.5l9 9m0-9l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function stateFor(
  index: AnswerIndex,
  selected: AnswerIndex | null,
  correctPosition: AnswerIndex | null,
  revealed: boolean
): OptionState {
  if (!revealed) return selected === index ? 'selected' : 'idle';
  if (correctPosition === index) return 'correct';
  if (selected === index) return 'incorrect';
  return 'dimmed';
}

export function OptionGroup({
  questionId,
  options,
  selected,
  correctPosition,
  revealed,
  onSelect,
  onSubmit,
}: OptionGroupProps): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus moves deliberately on question change (§10): reset the roving tab stop
  // to the first option rather than leaving it wherever the last question left it.
  useEffect(() => {
    refs.current = refs.current.slice(0, 4);
  }, [questionId]);

  const focusOption = useCallback((index: number): void => {
    const clamped = Math.min(Math.max(0, index), 3);
    refs.current[clamped]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: AnswerIndex): void => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusOption(index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusOption(index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusOption(0);
          break;
        case 'End':
          event.preventDefault();
          focusOption(3);
          break;
        case ' ':
          event.preventDefault();
          if (!revealed) onSelect(index);
          break;
        case 'Enter':
          event.preventDefault();
          if (revealed) break;
          if (selected === index) onSubmit();
          else onSelect(index);
          break;
        default:
          break;
      }
    },
    [focusOption, onSelect, onSubmit, revealed, selected]
  );

  // Roving tabindex: exactly one option is tabbable — the selected one, or the
  // first if nothing is selected yet.
  const tabbable = selected ?? 0;

  return (
    <div className={styles.optionList} role="radiogroup" aria-label="Answer options">
      {INDICES.map((index) => {
        const state = stateFor(index, selected, correctPosition, revealed);
        const text = options[index];
        return (
          <button
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected === index}
            tabIndex={index === tabbable ? 0 : -1}
            data-state={state}
            className={`${styles.option} motion-scale`}
            disabled={revealed}
            onClick={() => {
              if (!revealed) onSelect(index);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className={styles.optionLetter} aria-hidden="true">
              {LETTERS[index]}
            </span>
            <span className={styles.optionText}>
              {/* Screen readers need the letter spoken as part of the option. */}
              <span className="sr-only">{`Option ${LETTERS[index]}: `}</span>
              {text}
            </span>
            {state === 'correct' ? <CheckGlyph /> : null}
            {state === 'incorrect' ? <CrossGlyph /> : null}
          </button>
        );
      })}
    </div>
  );
}
