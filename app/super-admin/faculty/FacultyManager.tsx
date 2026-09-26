'use client';

import { useState } from 'react';
import type { FacultyGrant } from '@/lib/db/facultyGrants';
import { Button } from '@/components/ui/primitives';
import styles from './faculty.module.css';

export function FacultyManager({ initialFaculty }: { readonly initialFaculty: readonly FacultyGrant[] }): React.JSX.Element {
  const [faculty, setFaculty] = useState<readonly FacultyGrant[]>(initialFaculty);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const result = await response.json() as { message?: string; faculty?: FacultyGrant[] };
      if (!response.ok) throw new Error(result.message ?? 'Could not update faculty access.');
      setFaculty(result.faculty ?? []);
      if (method === 'POST') setEmail('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update faculty access.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`card ${styles.panel}`} aria-label="Faculty accounts">
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void mutate('/api/super-admin/faculty', 'POST', { email }); }}>
        <label htmlFor="faculty-email">Professor’s Google account email</label>
        <div className={styles.formRow}>
          <input id="faculty-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="off" />
          <Button type="submit" variant="primary" disabled={busy}>Add or enable</Button>
        </div>
      </form>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {faculty.length === 0 ? <p>No professor accounts have been added.</p> : (
        <ul className={styles.list}>
          {faculty.map((entry) => (
            <li key={entry.id} className={styles.item}>
              <div className={styles.details}>
                <strong>{entry.email}</strong>
                <span>{entry.status} · {entry.bound ? 'Google account linked' : 'waiting for Google sign-in'} · {entry.moduleCount} modules</span>
              </div>
              {entry.status === 'active' ? (
                <Button disabled={busy} onClick={() => void mutate(`/api/super-admin/faculty/${entry.id}`, 'PATCH')}>Disable</Button>
              ) : entry.status === 'disabled' ? (
                <Button disabled={busy} onClick={() => void mutate('/api/super-admin/faculty', 'POST', { email: entry.email })}>Enable</Button>
              ) : null}
              {entry.status !== 'removed' ? (
                <Button variant="ghost" disabled={busy} onClick={() => void mutate(`/api/super-admin/faculty/${entry.id}`, 'DELETE')}>Remove</Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
