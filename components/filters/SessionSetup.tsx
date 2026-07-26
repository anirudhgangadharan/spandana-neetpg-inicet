'use client';

/**
 * Session setup and filters (§8 P0).
 *
 * Subject is the primary filter. Topic is deliberately SUBORDINATE to it and
 * disabled until a subject is picked: over half the corpus has no topic at all
 * (52.3% of train, 89.9% of dev), so presenting topic as a peer of subject would
 * misrepresent the data. The "Uncategorised" bucket is a real, selectable option
 * rather than a gap (H5, Appendix A.10 point 2).
 */

import { useMemo, useState } from 'react';
import type { Facets } from '@/lib/db/queries';
import type { StudyMode } from '@/lib/storage/prefs';
import { Button } from '@/components/ui/primitives';
import type { SessionConfig } from '@/features/session/store';
import styles from './filters.module.css';

export const UNCATEGORISED = '__uncategorised__';

export interface SessionSetupProps {
  readonly facets: Facets;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onStart: (config: SessionConfig) => void;
}

const COUNT_CHOICES = [10, 20, 50, 100, 200] as const;

/** A seed derived from the config plus a nonce the user can see and re-use. */
function makeSeed(): string {
  // Not `Math.random()` (§13.7): the seed is a timestamp the user can read back,
  // and the session sequence itself is generated deterministically FROM it.
  return `s${Date.now().toString(36)}`;
}

export function SessionSetup({ facets, busy, error, onStart }: SessionSetupProps): React.JSX.Element {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [count, setCount] = useState<number>(20);
  const [mode, setMode] = useState<StudyMode>('study');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [seed, setSeed] = useState<string>(makeSeed);

  const availableTopics = useMemo(() => {
    if (subjects.length === 0) return [];
    const merged = new Map<string, number>();
    for (const subject of subjects) {
      for (const t of facets.topicsBySubject[subject] ?? []) {
        merged.set(t.name, (merged.get(t.name) ?? 0) + t.count);
      }
    }
    return [...merged.entries()]
      .map(([name, c]) => ({ name, count: c }))
      .sort((a, b) => b.count - a.count);
  }, [facets.topicsBySubject, subjects]);

  const toggle = (list: string[], value: string, set: (next: string[]) => void): void => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const matching = useMemo(() => {
    if (subjects.length === 0) return facets.sessionEligible;
    return subjects.reduce((sum, s) => sum + (facets.subjects.find((f) => f.name === s)?.count ?? 0), 0);
  }, [facets.sessionEligible, facets.subjects, subjects]);

  return (
    <div className={`glass ${styles.sidebar}`}>
      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Mode</h2>
        <div className={styles.modeToggle} role="radiogroup" aria-label="Practice mode">
          {(['study', 'exam'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`${styles.modeOption} ${mode === m ? styles.modeOptionActive : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'study' ? 'Study' : 'Exam'}
            </button>
          ))}
        </div>
        <p className={styles.hint}>
          {mode === 'study'
            ? 'Feedback and the explanation appear as soon as you answer each question.'
            : 'Feedback is withheld until you submit the whole paper.'}
        </p>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Questions</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="count">
            How many
          </label>
          <select
            id="count"
            className={styles.select}
            value={count}
            onChange={(e) => setCount(Number.parseInt(e.target.value, 10))}
          >
            {COUNT_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c} questions
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Subject</h2>
        <div className={styles.checkList}>
          {facets.subjects.map((s) => (
            <label key={s.name} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={subjects.includes(s.name)}
                onChange={() => {
                  toggle(subjects, s.name, setSubjects);
                  setTopics([]);
                }}
              />
              <span className={styles.checkLabel}>{s.name}</span>
              <span className={styles.count}>{s.count.toLocaleString('en-IN')}</span>
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          {subjects.length === 0 ? 'All subjects' : `${subjects.length} selected`} ·{' '}
          {matching.toLocaleString('en-IN')} questions available
        </p>
      </div>

      {/* Topic: secondary, and only meaningful once a subject narrows it. */}
      <div className={`${styles.group} ${styles.subordinate}`}>
        <h2 className={styles.groupTitle}>Topic (optional)</h2>
        {subjects.length === 0 ? (
          <p className={styles.hint}>
            Pick a subject first. Most questions in this dataset have no topic label, so topic is a way to
            narrow a subject rather than a way to browse.
          </p>
        ) : (
          <>
            <div className={styles.checkList}>
              {availableTopics.map((t) => (
                <label key={t.name} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={topics.includes(t.name)}
                    onChange={() => toggle(topics, t.name, setTopics)}
                  />
                  <span className={styles.checkLabel}>
                    {t.name === UNCATEGORISED ? 'Uncategorised' : t.name}
                  </span>
                  <span className={styles.count}>{t.count.toLocaleString('en-IN')}</span>
                </label>
              ))}
            </div>
            {topics.length > 0 ? <p className={styles.hint}>{topics.length} topic(s) selected</p> : null}
          </>
        )}
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Data quality</h2>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={onlyFlagged} onChange={() => setOnlyFlagged((v) => !v)} />
          <span className={styles.checkLabel}>Only flagged questions</span>
        </label>
        <p className={styles.hint}>
          Questions carrying a suspected text error or a disputed answer. Useful for reviewing the dataset&rsquo;s
          rough edges; not recommended for ordinary practice.
        </p>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Seed</h2>
        <div className={styles.field}>
          <input
            className={styles.input}
            value={seed}
            onChange={(e) => setSeed(e.target.value.slice(0, 128))}
            aria-label="Session seed"
          />
          <p className={styles.hint}>
            The same seed and filters always produce the same question sequence, so a session can be repeated
            exactly or shared with someone else.
          </p>
        </div>
      </div>

      {error === null ? null : (
        <p role="alert" style={{ color: 'var(--incorrect)', fontSize: 'var(--text-callout)' }}>
          {error}
        </p>
      )}

      <Button
        variant="primary"
        disabled={busy || seed.trim().length === 0}
        onClick={() =>
          onStart({
            seed: seed.trim(),
            count,
            subjects,
            topics,
            onlyFlagged,
            mode,
          })
        }
      >
        {busy ? 'Preparing…' : `Start ${mode === 'exam' ? 'exam' : 'practice'}`}
      </Button>
    </div>
  );
}
