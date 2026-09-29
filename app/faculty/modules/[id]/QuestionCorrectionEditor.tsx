'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import type { FacultyModuleDetail, FacultySelectedQuestion } from '@/lib/db/facultyModules';
import styles from '../modules.module.css';

type Source = { stem: string; options: readonly string[]; correctOption: number; explanation: string | null };
type History = { version: number; reason: string; created_at: string; reverted_from: number | null };

export function QuestionCorrectionEditor({ moduleId, revision, question, onSaved }: {
  readonly moduleId: string;
  readonly revision: number;
  readonly question: FacultySelectedQuestion;
  readonly onSaved: (detail: FacultyModuleDetail) => void;
}): React.JSX.Element {
  const [stem, setStem] = useState(question.stem);
  const [options, setOptions] = useState<string[]>([...question.options]);
  const [correctOption, setCorrectOption] = useState(question.correctOption ?? 1);
  const [explanation, setExplanation] = useState(question.explanation ?? '');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [poolVersion, setPoolVersion] = useState(question.correctionVersion ?? 0);
  const [history, setHistory] = useState<History[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/faculty/modules/${moduleId}/questions/${encodeURIComponent(question.id)}/correction`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load source version.');
        return response.json() as Promise<{ source: Source; current: (Source & { version: number }) | null; history: History[] }>;
      }).then((data) => { if (!controller.signal.aborted) {
        setSource(data.source); setHistory(data.history);
        if (data.current) {
          setPoolVersion(data.current.version); setStem(data.current.stem); setOptions([...data.current.options]);
          setCorrectOption(data.current.correctOption); setExplanation(data.current.explanation ?? '');
        }
      } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load source.'); });
    return () => controller.abort();
  }, [endpoint]);

  async function save(restoreVersion?: number): Promise<void> {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ revision, expectedVersion: poolVersion,
          reason, ...(restoreVersion === undefined ? { stem, options, correctOption, explanation } : { restoreVersion }) }),
      });
      const data = await response.json() as { module?: FacultyModuleDetail; message?: string };
      if (!response.ok || !data.module) throw new Error(data.message ?? 'Correction could not be saved.');
      onSaved(data.module);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Correction could not be saved.');
    } finally { setBusy(false); }
  }

  return <section aria-label={`Correct question ${question.position}`}>
    <p className={styles.muted}>Global question correction · current version {poolVersion || 'source'}.
      Saving changes this question for future practice and tests. Published tests keep their frozen answers.</p>
    {source ? <aside className={styles.notice} aria-label="Original source version"><h3>Original source version</h3>
      <p>{source.stem}</p><ol type="A">{source.options.map((option, index) => <li key={index}>{option}{index + 1 === source.correctOption ? ' — source answer' : ''}</li>)}</ol>
      {source.explanation ? <p>{source.explanation}</p> : null}
    </aside> : null}
    <p><label>Question text<br /><textarea value={stem} maxLength={12000} required onChange={(event) => setStem(event.target.value)} /></label></p>
    {options.map((option, index) => <p key={index}><label>Option {String.fromCharCode(65 + index)}<br />
      <input value={option} maxLength={4000} required onChange={(event) => setOptions((previous) => previous.map((item, i) => i === index ? event.target.value : item))} />
    </label></p>)}
    <p><label>Correct option<br /><select value={correctOption} onChange={(event) => setCorrectOption(Number(event.target.value))}>
      {[1, 2, 3, 4].map((number) => <option key={number} value={number}>{String.fromCharCode(64 + number)}</option>)}
    </select></label></p>
    <p><label>Explanation<br /><textarea value={explanation} maxLength={12000} onChange={(event) => setExplanation(event.target.value)} /></label></p>
    <p><label>Correction reason (required)<br /><textarea value={reason} minLength={3} maxLength={1000} required onChange={(event) => setReason(event.target.value)} /></label></p>
    {error ? <p role="alert" className={styles.muted}>{error}</p> : null}
    <div className={styles.buttonRow}><Button disabled={busy || reason.trim().length < 3} onClick={() => void save()}>Save global correction</Button>
      {poolVersion > 0 ? <Button disabled={busy || reason.trim().length < 3} variant="ghost" onClick={() => void save(0)}>Restore original source</Button> : null}
    </div>
    {history.length > 0 ? <details><summary>Correction history</summary><ol>{history.map((item) => <li key={item.version}>
      Version {item.version} · {new Date(item.created_at).toLocaleString()} · {item.reason}
      <Button disabled={busy || reason.trim().length < 3} variant="ghost" onClick={() => void save(item.version)}>Restore this version</Button>
    </li>)}</ol></details> : null}
  </section>;
}
