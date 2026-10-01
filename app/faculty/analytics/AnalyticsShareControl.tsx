'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives';
import type { AnalyticsShareStatus } from '@/lib/db/moduleAnalyticsShares';
import styles from './analytics.module.css';

export function AnalyticsShareControl({ moduleId }: { moduleId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AnalyticsShareStatus | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function request(method: 'GET' | 'POST' | 'DELETE'): Promise<void> {
    setBusy(true); setMessage('');
    setUrl('');
    try {
      const response = await fetch(`/api/faculty/modules/${moduleId}/analytics-share`, { method, cache: 'no-store' });
      const data = await response.json() as { status: AnalyticsShareStatus; path?: string; message?: string };
      if (!response.ok) throw new Error(data.message ?? 'Sharing unavailable.');
      setStatus(data.status);
      if (data.path) setUrl(new URL(data.path, window.location.origin).href);
      setMessage(method === 'GET' ? '' : method === 'DELETE' ? 'Sharing disabled.' : 'New link generated. Previous links no longer work.');
    } catch (error) {
      setStatus(null);
      setMessage(error instanceof Error ? error.message : 'Sharing unavailable. Refresh status before retrying.');
    } finally { setBusy(false); }
  }
  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(url); setMessage('Link copied.'); }
    catch { setMessage('Could not copy. Select and copy the link below.'); }
  }
  return <section aria-label="Share module analytics">
    <Button disabled={busy} aria-expanded={open} aria-controls="analytics-sharing" onClick={() => {
      setOpen(!open); if (!open) void request('GET');
    }}>Share analytics</Button>
    {open ? <div id="analytics-sharing" className={`card ${styles.panel}`} aria-busy={busy}>
      <p>Anyone with this link can view this module’s analytics, including student names, email addresses where available, registration and roll numbers, and attempt results. They can forward the link to others.</p>
      {status ? <>
        <p>Sharing {status.enabled ? 'enabled' : 'disabled'}.{status.createdAt ? ` Link created: ${new Date(status.createdAt).toLocaleString()}.` : ''} Links remain valid until disabled or replaced.</p>
        {status.enabled ? <p>Replacing this link immediately invalidates the previous link. The original link cannot be retrieved after leaving this screen.</p> : null}
        <Button disabled={busy} onClick={() => void request('POST')}>{status.enabled ? 'Replace link' : 'Generate link'}</Button>{' '}
        {status.enabled ? <Button disabled={busy} onClick={() => void request('DELETE')}>Disable sharing</Button> : null}
      </> : <Button disabled={busy} onClick={() => void request('GET')}>Refresh sharing status</Button>}
      {url ? <div className={styles.search}><label>Analytics link <input aria-label="Analytics link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></label><Button onClick={() => void copy()}>Copy link</Button></div> : null}
    </div> : null}
    <p role="status" aria-live="polite">{busy ? 'Loading sharing status…' : message}</p>
  </section>;
}
