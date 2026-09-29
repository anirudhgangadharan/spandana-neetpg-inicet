'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

export function RecoveryButton({ moduleId, participantId }: {
  readonly moduleId: string; readonly participantId: string;
}): React.JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function issue(): Promise<void> {
    if (!window.confirm('Issue a recovery code only after verifying this student’s identity. Existing guest sessions will be revoked when the code is used.')) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/faculty/modules/${moduleId}/participants/${participantId}/recovery`,
        { method: 'POST', cache: 'no-store' });
      const data = await response.json() as { code?: string; message?: string };
      if (!response.ok || !data.code) throw new Error(data.message ?? 'Could not issue a code.');
      setCode(data.code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not issue a code.');
    } finally { setBusy(false); }
  }

  async function erase(): Promise<void> {
    if (!window.confirm('Permanently delete this guest identity, its attempts, answers, and scores? This cannot be undone.')) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/faculty/modules/${moduleId}/participants/${participantId}`,
        { method: 'DELETE', cache: 'no-store' });
      if (!response.ok) throw new Error('Could not delete participant data.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete participant data.');
    } finally { setBusy(false); }
  }

  return <div><Button type="button" disabled={busy} onClick={() => void issue()}>
    {busy ? 'Creating…' : 'Issue recovery code'}</Button>
    <Button type="button" variant="ghost" disabled={busy} onClick={() => void erase()}>Erase guest data</Button>
    {code ? <p role="status">Give this one-time code to the verified student within 15 minutes: <code>{code}</code></p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
