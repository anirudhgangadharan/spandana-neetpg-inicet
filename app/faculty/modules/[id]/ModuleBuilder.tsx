'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Button } from '@/components/ui/primitives';
import type { Facets } from '@/lib/db/queries';
import type { FacultyCandidate } from '@/lib/db/facultyQuestions';
import type { FacultyModuleDetail } from '@/lib/db/facultyModules';
import styles from '../modules.module.css';

interface DraftForm {
  title: string;
  description: string;
  instructions: string;
  opensLocal: string;
  closesLocal: string;
  durationMinutes: string;
  maxAttempts: string;
  correctPoints: string;
  wrongPoints: string;
  blankPoints: string;
  allowReview: boolean;
}

interface PickerFilter {
  source: string;
  subject: string;
  topic: string;
  flag: string;
  search: string;
  onlyUnused: boolean;
  includeExcluded: boolean;
}

function localDateTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formFromDetail(detail: FacultyModuleDetail): DraftForm {
  return {
    title: detail.title,
    description: detail.description ?? '',
    instructions: detail.instructions ?? '',
    opensLocal: localDateTime(detail.opensAt),
    closesLocal: localDateTime(detail.closesAt),
    durationMinutes: detail.durationSeconds === null ? '' : String(detail.durationSeconds / 60),
    maxAttempts: String(detail.maxAttempts),
    correctPoints: String(detail.correctPoints),
    wrongPoints: String(detail.wrongPoints),
    blankPoints: String(detail.blankPoints),
    allowReview: detail.allowReview,
  };
}

function queryString(filter: PickerFilter, moduleId: string, cursor: number | null): string {
  const params = new URLSearchParams({ moduleId, limit: '25' });
  if (filter.source) params.set('source', filter.source);
  if (filter.subject) params.set('subject', filter.subject);
  if (filter.topic) params.set('topic', filter.topic);
  if (filter.flag) params.set('flag', filter.flag);
  if (filter.search) params.set('q', filter.search);
  if (!filter.onlyUnused) params.set('onlyUnused', '0');
  if (filter.includeExcluded) params.set('includeExcluded', '1');
  if (cursor !== null) params.set('cursor', String(cursor));
  return `/api/faculty/questions?${params.toString()}`;
}

async function jsonRequest(url: string, method: 'PATCH' | 'PUT' | 'POST' | 'DELETE', body: object): Promise<{
  module?: FacultyModuleDetail; deleted?: boolean; message?: string;
}> {
  const response = await fetch(url, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  const result = await response.json() as { module?: FacultyModuleDetail; deleted?: boolean; message?: string };
  if (!response.ok) throw new Error(result.message ?? 'The request could not be completed.');
  return result;
}

export function ModuleBuilder({ initialModule, facets }: {
  readonly initialModule: FacultyModuleDetail;
  readonly facets: Facets;
}): React.JSX.Element {
  const router = useRouter();
  const [detail, setDetail] = useState(initialModule);
  const [form, setForm] = useState<DraftForm>(() => formFromDetail(initialModule));
  const [filter, setFilter] = useState<PickerFilter>({
    source: '', subject: '', topic: '', flag: '', search: '', onlyUnused: true, includeExcluded: false,
  });
  const [searchText, setSearchText] = useState('');
  const [candidates, setCandidates] = useState<readonly FacultyCandidate[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [pageCursor, setPageCursor] = useState<number | null>(null);
  const [cursorHistory, setCursorHistory] = useState<readonly (number | null)[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [acceptReuse, setAcceptReuse] = useState(false);

  const isDraft = detail.status === 'draft';
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromDetail(detail));
  const canPublish = !dirty && detail.questionCount > 0 && detail.opensAt !== null
    && detail.closesAt !== null && detail.durationSeconds !== null;
  const selectedIds = new Set(detail.selectedQuestions.map((question) => question.id));
  const topicChoices = filter.subject ? facets.topicsBySubject[filter.subject] ?? [] : [];
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    if (!isDraft) return;
    const controller = new AbortController();
    setPickerLoading(true);
    setPickerError(null);
    setCandidates([]);
    setNextCursor(null);
    void fetch(queryString(filter, detail.id, pageCursor), { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { candidates?: FacultyCandidate[]; nextCursor?: number | null; message?: string };
        if (!response.ok) throw new Error(result.message ?? 'Could not load questions.');
        return result;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setCandidates(result.candidates ?? []);
        setNextCursor(result.nextCursor ?? null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setPickerError(cause instanceof Error ? cause.message : 'Could not load questions.');
      })
      .finally(() => { if (!controller.signal.aborted) setPickerLoading(false); });
    return () => controller.abort();
    // filterKey intentionally captures all picker filters as one stable value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, pageCursor, detail.id, isDraft]);

  function changeFilter(update: (previous: PickerFilter) => PickerFilter): void {
    setFilter(update);
    setPageCursor(null);
    setCursorHistory([]);
  }

  function nextPage(): void {
    if (nextCursor === null || pickerLoading) return;
    setCursorHistory((previous) => [...previous, pageCursor]);
    setPageCursor(nextCursor);
  }

  function previousPage(): void {
    if (cursorHistory.length === 0 || pickerLoading) return;
    setPageCursor(cursorHistory[cursorHistory.length - 1] ?? null);
    setCursorHistory((previous) => previous.slice(0, -1));
  }

  function edit<K extends keyof DraftForm>(field: K, value: DraftForm[K]): void {
    setForm((previous) => ({ ...previous, [field]: value }));
    setNotice(null);
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('settings'); setError(null); setNotice(null);
    try {
      const response = await jsonRequest(`/api/faculty/modules/${detail.id}`, 'PATCH', {
        revision: detail.revision,
        title: form.title,
        description: form.description,
        instructions: form.instructions,
        opensAt: form.opensLocal ? new Date(form.opensLocal).toISOString() : null,
        closesAt: form.closesLocal ? new Date(form.closesLocal).toISOString() : null,
        durationSeconds: form.durationMinutes ? Number(form.durationMinutes) * 60 : null,
        maxAttempts: Number(form.maxAttempts),
        correctPoints: Number(form.correctPoints),
        wrongPoints: Number(form.wrongPoints),
        blankPoints: Number(form.blankPoints),
        allowReview: form.allowReview,
      });
      if (!response.module) throw new Error('Saved, but the updated module could not be loaded. Refresh this page.');
      setDetail(response.module);
      setForm(formFromDetail(response.module));
      setNotice('Settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings.');
    } finally { setBusy(null); }
  }

  async function saveQuestions(ids: readonly string[], allowReuse: boolean): Promise<void> {
    setBusy('questions'); setError(null); setNotice(null);
    try {
      const response = await jsonRequest(`/api/faculty/modules/${detail.id}/questions`, 'PUT', {
        revision: detail.revision, ids, allowReuse,
      });
      if (!response.module) throw new Error('Saved, but the updated module could not be loaded. Refresh this page.');
      setDetail(response.module);
      setNotice('Question set saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the question set.');
    } finally { setBusy(null); }
  }

  async function act(action: 'publish' | 'unpublish' | 'republish' | 'archive'): Promise<void> {
    setBusy(action); setError(null); setNotice(null);
    try {
      const response = await jsonRequest(`/api/faculty/modules/${detail.id}/status`, 'POST', {
        revision: detail.revision, action, acceptReuse: action === 'publish' && acceptReuse,
      });
      if (!response.module) throw new Error('Updated, but the module could not be loaded. Refresh this page.');
      setDetail(response.module);
      const messages = {
        publish: 'Module published. Its question set and scoring policy are now frozen.',
        unpublish: 'Module unpublished. New students cannot start it.',
        republish: 'Module republished with the original frozen question set.',
        archive: 'Module archived. Its question-use history is retained.',
      };
      setNotice(messages[action]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change module status.');
    } finally { setBusy(null); }
  }

  async function remove(): Promise<void> {
    const message = isDraft
      ? 'Permanently delete this draft and release its selected questions?'
      : 'Hide this module from your dashboard? Its published questions and student history will be retained.';
    if (!window.confirm(message)) return;
    setBusy('delete'); setError(null);
    try {
      await jsonRequest(`/api/faculty/modules/${detail.id}`, 'DELETE', { revision: detail.revision });
      router.push('/faculty/modules');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the module.');
      setBusy(null);
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/modules/${detail.shareToken}`);
      setNotice('Share link copied.');
    } catch {
      setError('Could not copy automatically. Select and copy the path shown below.');
    }
  }

  return (
    <>
      <header className={styles.editorHeader}>
        <div className={styles.cardHeading}><h1>{detail.title}</h1><Badge tone={detail.status === 'published' ? 'accent' : 'neutral'}>{detail.status}</Badge></div>
        <p className={styles.muted}>Module questions and participant data are private to your faculty account.</p>
        <div className={styles.stats} aria-label="Module participation">
          <span>{detail.questionCount} questions</span><span>{detail.openedCount} opens</span>
          <span>{detail.startedCount} starts</span><span>{detail.submittedCount} submitted</span>
          <span>{detail.expiredCount} expired</span>
          <span>{detail.startedCount > 0 ? Math.round(detail.submittedCount / detail.startedCount * 100) : 0}% completion among starters</span>
        </div>
        <Link href={`/faculty/modules/${detail.id}/analytics`}>View module analytics →</Link>
      </header>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}

      <section className={`card ${styles.panel}`} aria-labelledby="settings-heading">
        <h2 id="settings-heading">Exam settings</h2>
        {!isDraft ? <p className={styles.muted}>Published settings are frozen. Make a new draft for a different question set or policy.</p> : null}
        <form onSubmit={(event) => void saveSettings(event)} className={styles.field}>
          <div className={styles.field}><label htmlFor="module-title">Title</label><input id="module-title" value={form.title} onChange={(event) => edit('title', event.target.value)} required maxLength={180} disabled={!isDraft || busy !== null} /></div>
          <div className={styles.field}><label htmlFor="module-description">Description</label><textarea id="module-description" value={form.description} onChange={(event) => edit('description', event.target.value)} maxLength={4000} disabled={!isDraft || busy !== null} /></div>
          <div className={styles.field}><label htmlFor="module-instructions">Student instructions</label><textarea id="module-instructions" value={form.instructions} onChange={(event) => edit('instructions', event.target.value)} maxLength={10000} disabled={!isDraft || busy !== null} /></div>
          <div className={styles.fieldGrid}>
            <div className={styles.field}><label htmlFor="opens-at">Opens at (your local time)</label><input id="opens-at" type="datetime-local" value={form.opensLocal} onChange={(event) => edit('opensLocal', event.target.value)} disabled={!isDraft || busy !== null} /></div>
            <div className={styles.field}><label htmlFor="closes-at">Closes at (your local time)</label><input id="closes-at" type="datetime-local" value={form.closesLocal} onChange={(event) => edit('closesLocal', event.target.value)} disabled={!isDraft || busy !== null} /></div>
            <div className={styles.field}><label htmlFor="duration">Time limit (minutes)</label><input id="duration" type="number" min={1} max={720} step={1} value={form.durationMinutes} onChange={(event) => edit('durationMinutes', event.target.value)} disabled={!isDraft || busy !== null} /></div>
            <div className={styles.field}><label htmlFor="max-attempts">Maximum attempts per student</label><input id="max-attempts" type="number" min={1} max={10} step={1} value={form.maxAttempts} onChange={(event) => edit('maxAttempts', event.target.value)} required disabled={!isDraft || busy !== null} /></div>
            <div className={styles.field}><label htmlFor="correct-points">Points for correct</label><input id="correct-points" type="number" min={0} max={20} step={1} value={form.correctPoints} onChange={(event) => edit('correctPoints', event.target.value)} required disabled={!isDraft || busy !== null} /></div>
            <div className={styles.field}><label htmlFor="wrong-points">Points for wrong</label><input id="wrong-points" type="number" min={-20} max={0} step={1} value={form.wrongPoints} onChange={(event) => edit('wrongPoints', event.target.value)} required disabled={!isDraft || busy !== null} /></div>
            <div className={styles.field}><label htmlFor="blank-points">Points for unanswered</label><input id="blank-points" type="number" min={-20} max={20} step={1} value={form.blankPoints} onChange={(event) => edit('blankPoints', event.target.value)} required disabled={!isDraft || busy !== null} /></div>
          </div>
          <label className={styles.checkbox}><input type="checkbox" checked={form.allowReview} onChange={(event) => edit('allowReview', event.target.checked)} disabled={!isDraft || busy !== null} /> Let students review answers and explanations after submission. Default is score only.</label>
          {isDraft ? <div className={styles.buttonRow}><Button type="submit" variant="primary" disabled={busy !== null || !dirty}>{busy === 'settings' ? 'Saving…' : 'Save settings'}</Button>{dirty ? <span className={styles.muted}>Unsaved settings. Save before publishing.</span> : null}</div> : null}
        </form>
      </section>

      {isDraft ? <div className={styles.builderGrid}>
        <section className={`card ${styles.panel}`} aria-labelledby="picker-heading">
          <h2 id="picker-heading">Find questions</h2>
          <p className={styles.muted}>Global no-repeat is on by default. Only a “used elsewhere” indicator is shared between professors.</p>
          <div className={styles.pickerFilters}>
            <div className={styles.fieldGrid}>
              <div className={styles.field}><label htmlFor="source-filter">Source</label><select id="source-filter" value={filter.source} onChange={(event) => changeFilter((previous) => ({ ...previous, source: event.target.value }))}><option value="">All sources</option>{facets.sources.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.count})</option>)}</select></div>
              <div className={styles.field}><label htmlFor="subject-filter">Subject</label><select id="subject-filter" value={filter.subject} onChange={(event) => changeFilter((previous) => ({ ...previous, subject: event.target.value, topic: '' }))}><option value="">All subjects</option>{facets.subjects.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.count})</option>)}</select></div>
              <div className={styles.field}><label htmlFor="topic-filter">Topic</label><select id="topic-filter" value={filter.topic} onChange={(event) => changeFilter((previous) => ({ ...previous, topic: event.target.value }))} disabled={!filter.subject}><option value="">All topics</option>{topicChoices.map((entry) => <option key={entry.name} value={entry.name}>{entry.name === '__uncategorised__' ? 'Uncategorised' : entry.name} ({entry.count})</option>)}</select></div>
              <div className={styles.field}><label htmlFor="flag-filter">Data-quality flag</label><select id="flag-filter" value={filter.flag} onChange={(event) => changeFilter((previous) => ({ ...previous, flag: event.target.value }))}><option value="">Any flag</option>{facets.flags.map((entry) => <option key={entry.name} value={entry.name}>{entry.name.replaceAll('_', ' ')} ({entry.count})</option>)}</select></div>
            </div>
            <form className={styles.searchRow} onSubmit={(event) => { event.preventDefault(); changeFilter((previous) => ({ ...previous, search: searchText.trim() })); }}>
              <label className="sr-only" htmlFor="question-search">Search question text</label>
              <input id="question-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={120} placeholder="Search stems, options, explanations" />
              <Button type="submit">Search</Button>
            </form>
            <label className={styles.checkbox}><input type="checkbox" checked={filter.onlyUnused} onChange={(event) => changeFilter((previous) => ({ ...previous, onlyUnused: event.target.checked }))} /> Only questions not used in any professor’s other modules</label>
            <label className={styles.checkbox}><input type="checkbox" checked={filter.includeExcluded} onChange={(event) => changeFilter((previous) => ({ ...previous, includeExcluded: event.target.checked }))} /> Show unsuitable corpus records (cannot add)</label>
          </div>
          {pickerError ? <p role="alert" className={styles.error}>{pickerError}</p> : null}
          {pickerLoading && candidates.length === 0 ? <p role="status">Loading questions…</p> : null}
          {!pickerLoading && candidates.length === 0 && !pickerError ? <p className={styles.muted}>No questions in this page. Adjust filters or continue scanning.</p> : null}
          <ul className={styles.candidateList}>
            {candidates.map((question) => (
              <li key={question.id} className={styles.candidate}>
                <div className={styles.candidateHead}><strong className={styles.stem}>{question.stem}</strong><Button disabled={busy !== null || !question.eligible || selectedIds.has(question.id) || detail.questionCount >= 200} onClick={() => void saveQuestions([...detail.selectedQuestions.map((entry) => entry.id), question.id], !filter.onlyUnused || detail.selectedQuestions.some((entry) => entry.usedElsewhere))}>{selectedIds.has(question.id) ? 'Selected' : 'Add'}</Button></div>
                <p className={styles.meta}>{question.source} · {question.subject}{question.topic ? ` · ${question.topic}` : ''}{question.flags.length > 0 ? ` · ${question.flags.join(', ')}` : ''}</p>
                {question.usedElsewhere ? <p className={styles.meta}>Previously selected in another module. Disable the unused-only filter to include intentionally.</p> : null}
                {!question.eligible ? <p className={styles.meta}>Unavailable for exams: duplicate or conflicting answer record.</p> : null}
                <details><summary>Preview options</summary><ol type="A" className={styles.options}>{question.options.map((option, index) => <li key={index}>{option}</li>)}</ol></details>
              </li>
            ))}
          </ul>
          <div className={styles.buttonRow}>
            {cursorHistory.length > 0 ? <Button disabled={pickerLoading} onClick={previousPage}>Previous page</Button> : null}
            {nextCursor !== null ? <Button disabled={pickerLoading} onClick={nextPage}>{pickerLoading ? 'Loading…' : 'Next page'}</Button> : null}
          </div>
        </section>

        <section className={`card ${styles.panel}`} aria-labelledby="selected-heading">
          <h2 id="selected-heading">Selected questions ({detail.questionCount}/200)</h2>
          <p className={styles.muted}>Add, remove, and reorder. Every change is saved to your draft. Publication freezes this exact order.</p>
          {detail.selectedQuestions.length === 0 ? <p className={styles.muted}>No questions selected yet.</p> : (
            <ol className={styles.selectedList}>
              {detail.selectedQuestions.map((question, index) => (
                <li key={question.id} className={styles.selected}>
                  <div className={styles.selectedHead}><strong className={styles.stem}>{index + 1}. {question.stem}</strong><span className={styles.meta}>{question.subject}</span></div>
                  {question.usedElsewhere ? <p className={styles.meta}>Used in another module; publication requires explicit reuse confirmation.</p> : null}
                  <div className={styles.buttonRow}>
                    <Button disabled={busy !== null || index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => { const ids = detail.selectedQuestions.map((entry) => entry.id); [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; void saveQuestions(ids, detail.selectedQuestions.some((entry) => entry.usedElsewhere)); }}>↑</Button>
                    <Button disabled={busy !== null || index === detail.selectedQuestions.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => { const ids = detail.selectedQuestions.map((entry) => entry.id); [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!]; void saveQuestions(ids, detail.selectedQuestions.some((entry) => entry.usedElsewhere)); }}>↓</Button>
                    <Button disabled={busy !== null} onClick={() => setPreviewId(previewId === question.id ? null : question.id)} aria-expanded={previewId === question.id}>{previewId === question.id ? 'Hide preview' : 'Preview'}</Button>
                    <Button disabled={busy !== null} variant="ghost" onClick={() => void saveQuestions(detail.selectedQuestions.filter((entry) => entry.id !== question.id).map((entry) => entry.id), detail.selectedQuestions.some((entry) => entry.id !== question.id && entry.usedElsewhere))}>Remove</Button>
                  </div>
                  {previewId === question.id ? <ol type="A" className={styles.options}>{question.options.map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}</ol> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div> : null}

      <section className={`card ${styles.panel}`} aria-labelledby="lifecycle-heading">
        <h2 id="lifecycle-heading">Publication and sharing</h2>
        {isDraft ? <>
          <p className={styles.muted}>Publish only when the window, scoring policy, and question order are final. They cannot be edited afterward.</p>
          <label className={styles.checkbox}><input type="checkbox" checked={acceptReuse} onChange={(event) => setAcceptReuse(event.target.checked)} /> I intentionally allow questions already used in another professor’s module.</label>
          <div className={styles.buttonRow}><Button variant="primary" disabled={busy !== null || !canPublish} onClick={() => void act('publish')}>{busy === 'publish' ? 'Publishing…' : 'Publish module'}</Button>{!canPublish ? <span className={styles.muted}>Save a valid time window and select at least one question first.</span> : null}</div>
        </> : <>
          <div className={styles.shareRow}><code>/modules/{detail.shareToken}</code><Button onClick={() => void copyLink()}>Copy share link</Button></div>
          <p className={styles.muted}>Any signed-in student with this link can open the module while it is published and within its availability window. Existing attempts keep their original deadline if you unpublish.</p>
          <div className={styles.buttonRow}>
            {detail.status === 'published' ? <Button disabled={busy !== null} onClick={() => void act('unpublish')}>Unpublish</Button> : null}
            {detail.status === 'unpublished' ? <Button disabled={busy !== null} variant="primary" onClick={() => void act('republish')}>Republish</Button> : null}
            {detail.status === 'published' || detail.status === 'unpublished' ? <Button disabled={busy !== null} onClick={() => void act('archive')}>Archive</Button> : null}
          </div>
        </>}
        <hr className={styles.divider} />
        <div className={styles.buttonRow}><Button variant="ghost" className={styles.danger} disabled={busy !== null} onClick={() => void remove()}>{isDraft ? 'Delete draft' : 'Remove from dashboard'}</Button><span className={styles.muted}>{isDraft ? 'Draft questions will be released for selection.' : 'Published history and global used-question records are retained.'}</span></div>
      </section>
    </>
  );
}
