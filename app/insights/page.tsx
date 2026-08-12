'use client';

/**
 * /insights — your progress (accuracy/speed percentiles, weakest topics)
 * plus a bookmarks review list. Deliberately one page rather than two
 * separate routes: both are "look when you want" surfaces, not part of the
 * practice flow itself.
 *
 * Percentiles are withheld per-subject until enough OTHER users have data
 * there (see lib/db/insightsQueries.ts) — a percentile computed against
 * n=1 is a fabricated-looking number, not a real one.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Question } from '@/types';
import styles from './insights.module.css';

interface SubjectInsight {
  readonly subject: string;
  readonly yourAccuracy: number;
  readonly yourAvgDurationMs: number;
  readonly accuracyPercentile: number;
  readonly speedPercentile: number;
  readonly sampleSizeOk: boolean;
}

interface WeakTopic {
  readonly topic: string;
  readonly accuracy: number;
  readonly attempts: number;
}

interface ConfidentWrong {
  readonly questionId: string;
  readonly subject: string;
  readonly topic: string | null;
  readonly attemptedAt: number;
}

interface InsightsResponse {
  readonly subjects: readonly SubjectInsight[];
  readonly weakTopics: readonly WeakTopic[];
  readonly unrevisitedCount: number;
  readonly confidentWrong: readonly ConfidentWrong[];
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function openReview(id: string): void {
  window.location.href = `/?review=${encodeURIComponent(id)}`;
}

export default function InsightsPage(): React.JSX.Element {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [bookmarks, setBookmarks] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [insightsRes, syncRes] = await Promise.all([fetch('/api/insights'), fetch('/api/sync')]);
        if (insightsRes.ok) setData((await insightsRes.json()) as InsightsResponse);

        if (syncRes.ok) {
          const sync = (await syncRes.json()) as { bookmarks: readonly string[] };
          if (sync.bookmarks.length === 0) {
            setBookmarks([]);
          } else {
            const qRes = await fetch(`/api/questions?ids=${sync.bookmarks.map(encodeURIComponent).join(',')}`);
            if (qRes.ok) {
              const body = (await qRes.json()) as { questions: Question[] };
              setBookmarks(body.questions);
            } else {
              setBookmarks([]);
            }
          }
        }
      } catch {
        setError('Could not load your insights right now.');
      }
    })();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Back to practice
        </Link>
        <h1 className={styles.title}>Your progress</h1>
      </div>

      {error === null ? null : <p className={styles.error}>{error}</p>}

      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>By subject</h2>
        {data === null ? (
          <p className={styles.hint}>Loading…</p>
        ) : data.subjects.length === 0 ? (
          <p className={styles.hint}>Answer a few questions to see your stats here.</p>
        ) : (
          <ul className={styles.subjectList}>
            {data.subjects.map((s) => (
              <li key={s.subject} className={styles.subjectRow}>
                <div className={styles.subjectName}>{s.subject}</div>
                <div className={styles.subjectStats}>
                  <span className="tabular">{Math.round(s.yourAccuracy * 100)}% accuracy</span>
                  <span className="tabular">{formatDuration(s.yourAvgDurationMs)} avg</span>
                </div>
                {s.sampleSizeOk ? (
                  <p className={styles.percentile}>
                    More accurate than {Math.round(s.accuracyPercentile * 100)}% and faster than{' '}
                    {Math.round(s.speedPercentile * 100)}% of people who&rsquo;ve practiced {s.subject}.
                  </p>
                ) : (
                  <p className={styles.hint}>Not enough people have practiced this subject yet to compare.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data !== null && data.confidentWrong.length > 0 ? (
        <section className={`card ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Blind spots — confident but wrong</h2>
          <p className={styles.hint}>
            You tapped &ldquo;Know it&rdquo; on these, but your last attempt was wrong. Worth a second look.
          </p>
          <ul className={styles.bookmarkList}>
            {data.confidentWrong.map((c) => (
              <li key={c.questionId}>
                <button type="button" className={styles.bookmarkRow} onClick={() => openReview(c.questionId)}>
                  {c.subject}
                  {c.topic === null ? '' : ` · ${c.topic}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data !== null && data.weakTopics.length > 0 ? (
        <section className={`card ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Your weakest topics</h2>
          <ul className={styles.topicList}>
            {data.weakTopics.map((t) => (
              <li key={t.topic} className={styles.topicRow}>
                <span>{t.topic}</span>
                <span className="tabular">
                  {Math.round(t.accuracy * 100)}% ({t.attempts} attempts)
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Bookmarked questions</h2>
        {data !== null && data.unrevisitedCount > 0 ? (
          <p className={styles.hint}>
            {data.unrevisitedCount} of these you last got wrong and haven&rsquo;t revisited.
          </p>
        ) : null}
        {bookmarks === null ? (
          <p className={styles.hint}>Loading…</p>
        ) : bookmarks.length === 0 ? (
          <p className={styles.hint}>No bookmarks yet — bookmark a question while practicing to find it here.</p>
        ) : (
          <ul className={styles.bookmarkList}>
            {bookmarks.map((q) => (
              <li key={q.id}>
                <button type="button" className={styles.bookmarkRow} onClick={() => openReview(q.id)}>
                  {q.stem.length > 140 ? `${q.stem.slice(0, 140)}…` : q.stem}
                  <span className={styles.bookmarkMeta}>
                    {q.subject}
                    {q.topic === null ? '' : ` · ${q.topic}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
