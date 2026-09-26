'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/primitives';
import { discardAllLocalProgress } from '@/lib/storage/attempts';
import styles from './account-delete.module.css';

export function AccountDeletionClient({ email, isFaculty }: {
  readonly email: string;
  readonly isFaculty: boolean;
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch('/api/me/account', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: confirmation }), cache: 'no-store',
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? 'Account deletion failed.');
      try {
        await discardAllLocalProgress();
        sessionStorage.clear();
        localStorage.clear();
      } catch {
        // The server deletion succeeded. Storage may be unavailable in a
        // private/locked-down browser, so sign out rather than imply rollback.
      }
      await signOut({ callbackUrl: '/login?deleted=1' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account deletion failed.');
      setBusy(false);
    }
  }

  return <form className={`card ${styles.panel}`} onSubmit={(event) => void remove(event)}>
    <h1>Delete your account</h1>
    <p>This permanently removes your profile, practice history, bookmarks, exam attempts, and locally saved progress.</p>
    {isFaculty ? <p className={styles.warning}><strong>Faculty account:</strong> this also permanently deletes every module you own, its frozen questions, all participating students’ attempts and answers, and its analytics. Shared links stop working.</p> : null}
    <p>Editorial notes are shared, non-attributed content and are not linked to your account. Provider and database backups may persist temporarily under their documented retention schedules.</p>
    <label htmlFor="confirm-email">Type <strong>{email}</strong> to confirm</label>
    <input id="confirm-email" type="email" required autoComplete="email" value={confirmation}
      onChange={(event) => setConfirmation(event.target.value)} />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <Button type="submit" variant="primary" disabled={busy || confirmation.trim().toLowerCase() !== email.toLowerCase()}>
      {busy ? 'Deleting account…' : 'Permanently delete account'}
    </Button>
  </form>;
}
