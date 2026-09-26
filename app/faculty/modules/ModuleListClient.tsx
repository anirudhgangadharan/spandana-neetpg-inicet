'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button } from '@/components/ui/primitives';
import type { FacultyModuleSummary } from '@/lib/db/facultyModules';
import styles from './modules.module.css';

export function ModuleListClient({ initialModules, page, hasNext }: {
  readonly initialModules: readonly FacultyModuleSummary[];
  readonly page: number;
  readonly hasNext: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/faculty/modules', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }),
      });
      const result = await response.json() as { id?: string; message?: string };
      if (!response.ok || !result.id) throw new Error(result.message ?? 'Could not create the draft.');
      router.push(`/faculty/modules/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the draft. Check your connection.');
      setBusy(false);
    }
  }

  return (
    <>
      <form className={`card ${styles.create}`} onSubmit={(event) => void create(event)}>
        <label htmlFor="new-module-title">New module title</label>
        <div className={styles.formRow}>
          <input id="new-module-title" value={title} onChange={(event) => setTitle(event.target.value)}
            maxLength={180} required placeholder="e.g. Cardiology mock exam" />
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</Button>
        </div>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </form>
      <section aria-label="Your modules">
        <div className={styles.cardHeading}><h2>Modules</h2><Link href="/faculty/analytics">View overall analytics →</Link></div>
        {initialModules.length === 0 ? <p className={styles.muted}>No modules yet. Create a draft to begin.</p> : (
          <ul className={styles.list}>
            {initialModules.map((entry) => (
              <li key={entry.id} className={`card ${styles.moduleCard}`}>
                <div className={styles.cardHeading}>
                  <Link href={`/faculty/modules/${entry.id}`}>{entry.title}</Link>
                  <Badge tone={entry.status === 'published' ? 'accent' : 'neutral'}>{entry.status}</Badge>
                </div>
                <p className={styles.muted}>{entry.questionCount} questions · {entry.openedCount} opens · {entry.startedCount} starts · {entry.submittedCount} submissions</p>
                <p className={styles.muted}>Completion among starters: {entry.startedCount > 0 ? Math.round(entry.submittedCount / entry.startedCount * 100) : 0}%</p>
                <Link href={`/faculty/modules/${entry.id}/analytics`}>View analytics</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <nav className={styles.formRow} aria-label="Module pages">
        {page > 1 ? <Link href={`/faculty/modules?page=${page - 1}`}>← Previous page</Link> : null}
        <span>Page {page}</span>
        {hasNext ? <Link href={`/faculty/modules?page=${page + 1}`}>Next page →</Link> : null}
      </nav>
    </>
  );
}
