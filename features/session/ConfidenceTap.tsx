'use client';

/**
 * "How confident are you?" — quiet, skippable, tapped any time before
 * submit (quiet-gamification plan). Never blocks Submit: no option chosen
 * is a valid, common state, not an error.
 */

import type { Confidence } from '@/types';
import styles from './practice.module.css';

const OPTIONS: readonly { readonly value: Confidence; readonly label: string }[] = [
  { value: 'know', label: 'Know it' },
  { value: 'fairly_sure', label: 'Fairly sure' },
  { value: 'guessing', label: 'Guessing' },
];

export interface ConfidenceTapProps {
  readonly value: Confidence | null;
  readonly onChange: (value: Confidence | null) => void;
}

export function ConfidenceTap({ value, onChange }: ConfidenceTapProps): React.JSX.Element {
  return (
    <div className={styles.confidenceTap} role="group" aria-label="How confident are you?">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`${styles.confidencePill} ${value === opt.value ? styles.confidencePillActive : ''}`}
          aria-pressed={value === opt.value}
          onClick={() => onChange(value === opt.value ? null : opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
