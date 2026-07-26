'use client';

/**
 * Server-backed full-text search (§8 P0). Debounced, FTS5-ranked, p95 < 150 ms.
 *
 * The input is debounced at 220 ms and every in-flight request is aborted when a
 * newer keystroke arrives, so a fast typist never sees results for a stale query
 * arrive after results for a newer one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Question } from '@/types';
import styles from './filters.module.css';

const DEBOUNCE_MS = 220;
const MIN_QUERY_LENGTH = 2;

interface SearchResponse {
  readonly query: string;
  readonly hits: readonly { readonly question: Question; readonly score: number }[];
  readonly tookMs: number;
}

export interface SearchFieldProps {
  readonly onOpenQuestion: (question: Question) => void;
}

export function SearchField({ onOpenQuestion }: SearchFieldProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [results, setResults] = useState<readonly { question: Question; score: number }[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (query: string): Promise<void> => {
    abortRef.current?.abort();
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setStatus('');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=25`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SearchResponse;
      setResults(body.hits);
      setStatus(
        body.hits.length === 0
          ? `No questions match “${body.query}”.`
          : `${body.hits.length} result${body.hits.length === 1 ? '' : 's'} in ${body.tookMs} ms`
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults([]);
      setStatus('Search is unavailable right now.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(value), DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [run, value]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className={styles.group}>
      <div className={styles.searchWrapper}>
        <label className={styles.label} htmlFor="search">
          Search all questions
        </label>
        <input
          id="search"
          type="search"
          className={styles.input}
          placeholder="e.g. narcolepsy, LCAT, portal vein"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          style={{ marginTop: 'var(--space-2)' }}
        />
      </div>

      {/* Result count is announced, so a screen-reader user learns the search
          returned something without having to go hunting for it (§10). */}
      <p className={styles.searchStatus} role="status" aria-live="polite">
        {busy ? 'Searching…' : status}
      </p>

      {results.length > 0 ? (
        <div className={styles.results}>
          {results.map(({ question }) => (
            <button
              key={question.id}
              type="button"
              className={styles.resultItem}
              onClick={() => onOpenQuestion(question)}
            >
              {question.stem.length > 160 ? `${question.stem.slice(0, 160)}…` : question.stem}
              <span className={styles.resultMeta}>
                {question.subject}
                {question.topic === null ? '' : ` · ${question.topic}`}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
