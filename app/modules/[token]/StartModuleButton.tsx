'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives';
import styles from '@/app/module-exam.module.css';

export function StartModuleButton({ token }: { readonly token: string }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/modules/${token}/attempts`, { method: 'POST', cache: 'no-store' });
      const data = await response.json() as { id?: string; message?: string };
      if (!response.ok || !data.id) throw new Error(data.message ?? 'Could not start this attempt.');
      router.push(`/module-attempts/${data.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect. Try again.');
      setBusy(false);
    }
  }

  return <div className={styles.startAction}>
    <Button type="button" variant="primary" disabled={busy} onClick={() => void start()}>
      {busy ? 'Starting…' : 'Start timed attempt'}
    </Button>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </div>;
}
