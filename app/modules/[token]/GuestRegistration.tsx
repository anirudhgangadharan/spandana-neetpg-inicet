'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives';
import styles from '@/app/module-exam.module.css';

export function GuestRegistration({ token }: { readonly token: string }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [recoveryCode, setRecoveryCode] = useState('');

  function clearFieldError(field: string): void {
    setFieldErrors((previous) => previous[field] ? { ...previous, [field]: '' } : previous);
  }

  async function register(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const details = {
      name: String(form.get('name') ?? '').trim().replace(/\s+/g, ' '),
      registrationNumber: String(form.get('registrationNumber') ?? '').trim().replace(/\s+/g, ' '),
      rollNumber: String(form.get('rollNumber') ?? '').trim().replace(/\s+/g, ' '),
    };
    const errors: Record<string, string> = {};
    if (!details.name) errors.name = 'Enter your name.';
    if (!details.registrationNumber) errors.registrationNumber = 'Enter your registration number.';
    if (!details.rollNumber) errors.rollNumber = 'Enter your roll number.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/modules/${token}/guest`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(details),
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message ?? 'Could not register for this test.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect. Try again.');
      setBusy(false);
    }
  }

  async function recover(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/modules/${token}/recover`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ code: recoveryCode }),
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message ?? 'Could not restore test access.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect. Try again.');
      setBusy(false);
    }
  }

  return <><form noValidate onSubmit={(event) => void register(event)}>
    <h3>Student details</h3>
    <p>Required to identify your result in your faculty member’s dashboard. No Google sign-in is needed.</p>
    <p><label htmlFor="guest-name">Name</label><br /><input id="guest-name" name="name" required maxLength={120} autoComplete="name" onChange={() => clearFieldError('name')}
      aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'guest-name-error' : undefined} />
      {fieldErrors.name ? <span id="guest-name-error" role="alert" className={styles.error}>{fieldErrors.name}</span> : null}</p>
    <p><label htmlFor="guest-registration">Registration number</label><br /><input id="guest-registration" name="registrationNumber" required maxLength={80} autoComplete="off" onChange={() => clearFieldError('registrationNumber')}
      aria-invalid={!!fieldErrors.registrationNumber} aria-describedby={fieldErrors.registrationNumber ? 'guest-registration-error' : undefined} />
      {fieldErrors.registrationNumber ? <span id="guest-registration-error" role="alert" className={styles.error}>{fieldErrors.registrationNumber}</span> : null}</p>
    <p><label htmlFor="guest-roll">Roll number</label><br /><input id="guest-roll" name="rollNumber" required maxLength={80} autoComplete="off" onChange={() => clearFieldError('rollNumber')}
      aria-invalid={!!fieldErrors.rollNumber} aria-describedby={fieldErrors.rollNumber ? 'guest-roll-error' : undefined} />
      {fieldErrors.rollNumber ? <span id="guest-roll-error" role="alert" className={styles.error}>{fieldErrors.rollNumber}</span> : null}</p>
    <p className={styles.notice}>Your faculty member can see these details, your submitted answers, and your score. Read the <a href="/privacy">privacy policy</a> for retention and deletion information.</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Continuing…' : 'Continue to test'}</Button>
  </form>
    <form onSubmit={(event) => void recover(event)}>
      <h3>Returning without this browser session?</h3>
      <p>Ask your faculty member to verify your identity and give you a one-time recovery code.</p>
      <label htmlFor="guest-recovery">Recovery code</label><br />
      <input id="guest-recovery" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} required autoComplete="off" />
      <Button type="submit" disabled={busy || !recoveryCode.trim()}>Restore access</Button>
    </form></>;
}
