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

import { useEffect, useMemo, useState } from 'react';
import type { Facets } from '@/lib/db/queries';
import type { StudyMode } from '@/lib/storage/prefs';
import { Button } from '@/components/ui/primitives';
import type { QuestionMode, SessionConfig } from '@/features/session/store';
import { SOURCE_LABEL, USMLE_SUBJECT_LABELS } from '@/lib/constants/sources';
import type { QuestionSource } from '@/types';
import styles from './filters.module.css';

interface QuestionCounts {
  readonly total: number;
  readonly new: number;
  readonly incorrect: number;
  readonly correct: number;
  readonly marked: number;
}

const QUESTION_MODE_LABEL: Record<QuestionMode, string> = {
  new: 'New',
  incorrect: 'Incorrect',
  marked: 'Marked',
  all: 'All',
};

const COUNTS_DEBOUNCE_MS = 220;

const ALL_SOURCES: readonly QuestionSource[] = ['medmcqa', 'usmle'];
const USMLE_SUBJECT_SET = new Set(USMLE_SUBJECT_LABELS);

/** True for a `subject` value that belongs to the USMLE question bank — every
 *  USMLE row's subject is one of `USMLE_SUBJECT_LABELS` by construction (D-023),
 *  so this cleanly partitions the (source-unscoped) subject facet without a
 *  fragile string-prefix guess. */
const isUsmleSubject = (name: string): boolean => USMLE_SUBJECT_SET.has(name);

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
  // Default MedMCQA-only (D-C): a fresh session with no explicit choice must
  // feel exactly like it did before USMLE existed. USMLE is opt-in.
  const [sources, setSources] = useState<QuestionSource[]>(['medmcqa']);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [count, setCount] = useState<number>(20);
  const [mode, setMode] = useState<StudyMode>('study');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [seed, setSeed] = useState<string>(makeSeed);
  const [questionMode, setQuestionMode] = useState<QuestionMode>('new');
  const [counts, setCounts] = useState<QuestionCounts | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // The subject facet is source-unscoped at the query layer by design (every
  // USMLE subject value self-discloses what it is, per D-023) — scoped here,
  // client-side, to whichever question bank(s) are selected.
  const visibleSubjects = useMemo(() => {
    const wantsUsmle = sources.includes('usmle');
    const wantsMedmcqa = sources.includes('medmcqa');
    return facets.subjects.filter((s) => (isUsmleSubject(s.name) ? wantsUsmle : wantsMedmcqa));
  }, [facets.subjects, sources]);

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

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void): void => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const matching = useMemo(() => {
    if (subjects.length === 0) {
      // No subject chosen: "N available" must reflect the source scoping, not
      // the whole corpus — otherwise the hint lies the moment a source filter
      // exists (it previously read `facets.sessionEligible` unconditionally).
      return visibleSubjects.reduce((sum, s) => sum + s.count, 0);
    }
    return subjects.reduce((sum, s) => sum + (facets.subjects.find((f) => f.name === s)?.count ?? 0), 0);
  }, [facets.subjects, subjects, visibleSubjects]);

  // Live New/Incorrect/Marked counts for the current filter selection
  // (session-state-aware planning plan). Debounced the same way SearchField
  // debounces keystrokes — rapid checkbox toggling shouldn't fire a request
  // per click.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const s of sources) params.append('source', s);
    for (const s of subjects) params.append('subject', s);
    for (const t of topics) params.append('topic', t);
    if (onlyFlagged) params.set('flagged', '1');

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/questions/counts?${params.toString()}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<QuestionCounts>) : null))
        .then((body) => {
          if (body !== null) setCounts(body);
        })
        .catch(() => undefined);
    }, COUNTS_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sources, subjects, topics, onlyFlagged]);

  return (
    <div className={`glass ${styles.sidebar}`}>
      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Question bank</h2>
        <div className={styles.checkList}>
          {ALL_SOURCES.map((s) => {
            const facet = facets.sources.find((f) => f.name === s);
            return (
              <label key={s} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={sources.includes(s)}
                  onChange={() => {
                    // At least one source must always be selected — an empty
                    // set would silently mean "every source" at the query
                    // layer, the opposite of what an unchecked box implies.
                    if (sources.length === 1 && sources[0] === s) return;
                    toggle(sources, s, setSources);
                    setSubjects([]);
                    setTopics([]);
                  }}
                />
                <span className={styles.checkLabel}>{SOURCE_LABEL[s]}</span>
                <span className={styles.count}>{(facet?.count ?? 0).toLocaleString('en-IN')}</span>
              </label>
            );
          })}
        </div>
      </div>

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
          {visibleSubjects.map((s) => (
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
        <h2 className={styles.groupTitle}>What to practice</h2>
        <div className={styles.questionModeGrid} role="radiogroup" aria-label="Which questions to draw from">
          {(['new', 'incorrect', 'marked', 'all'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={questionMode === m}
              className={`${styles.questionModeOption} ${questionMode === m ? styles.questionModeOptionActive : ''}`}
              onClick={() => setQuestionMode(m)}
            >
              <span className={styles.questionModeLabel}>{QUESTION_MODE_LABEL[m]}</span>
              <span className={`${styles.questionModeCount} tabular`}>
                {counts === null ? '…' : (m === 'all' ? counts.total : counts[m]).toLocaleString('en-IN')}
              </span>
            </button>
          ))}
        </div>
        {questionMode !== 'all' ? (
          <p className={styles.hint}>Draws only from questions matching this state, within your filters above.</p>
        ) : null}
      </div>

      <details className={styles.advanced} open={showAdvanced} onToggle={(e) => setShowAdvanced(e.currentTarget.open)}>
        <summary className={styles.advancedSummary}>Advanced</summary>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="seed">
            Seed
          </label>
          <input
            id="seed"
            className={styles.input}
            value={seed}
            onChange={(e) => setSeed(e.target.value.slice(0, 128))}
          />
          <p className={styles.hint}>
            {questionMode === 'all'
              ? 'The same seed and filters always produce the same question sequence, so a session can be repeated exactly or shared with someone else.'
              : 'For New/Incorrect/Marked, the pool changes as you answer more questions, so the seed reproduces the ORDER of a draw rather than an identical future one.'}
          </p>
        </div>
      </details>

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
            sources,
            subjects,
            topics,
            onlyFlagged,
            mode,
            questionMode,
          })
        }
      >
        {busy ? 'Preparing…' : `Start ${mode === 'exam' ? 'exam' : 'practice'}`}
      </Button>
    </div>
  );
}
