'use client';

/**
 * Admin form + table for the `notes` table. All writes go through
 * /api/admin/notes (403s for anyone the server doesn't consider an admin —
 * this client trusts nothing about its own gating, the server route is the
 * real check).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives';
import styles from './admin-notes.module.css';

type NoteScope = 'question' | 'concept';

interface Note {
  readonly id: string;
  readonly scopeType: NoteScope;
  readonly scopeKey: string;
  readonly subject: string | null;
  readonly topic: string | null;
  readonly title: string | null;
  readonly bodyMd: string;
  readonly imageUrls: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface FormState {
  readonly scopeType: NoteScope;
  readonly questionId: string;
  readonly subject: string;
  readonly topic: string;
  readonly title: string;
  readonly bodyMd: string;
  readonly imageUrls: readonly string[];
}

const EMPTY_FORM: FormState = {
  scopeType: 'question',
  questionId: '',
  subject: '',
  topic: '',
  title: '',
  bodyMd: '',
  imageUrls: [''],
};

function noteToForm(note: Note): FormState {
  return {
    scopeType: note.scopeType,
    questionId: note.scopeType === 'question' ? note.scopeKey : '',
    subject: note.subject ?? '',
    topic: note.topic ?? '',
    title: note.title ?? '',
    bodyMd: note.bodyMd,
    imageUrls: note.imageUrls.length > 0 ? note.imageUrls : [''],
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function AdminNotesClient(): React.JSX.Element {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/notes');
      if (!res.ok) {
        setError('Could not load notes.');
        return;
      }
      const body = (await res.json()) as { notes: Note[] };
      setNotes(body.notes);
    } catch {
      setError('Could not load notes.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }, []);

  const handleEdit = useCallback((note: Note) => {
    setForm(noteToForm(note));
    setEditingId(note.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this note?')) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/notes/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          setError('Could not delete the note.');
          return;
        }
        if (editingId === id) resetForm();
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [editingId, refresh, resetForm]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const scopeKey =
        form.scopeType === 'question' ? form.questionId.trim() : `concept:${slugify(form.subject)}:${slugify(form.topic) || 'all'}`;
      if (form.scopeType === 'question' && scopeKey.length === 0) {
        setError('A question ID is required for a question-scoped note.');
        return;
      }
      if (form.scopeType === 'concept' && form.subject.trim().length === 0) {
        setError('A subject is required for a concept-scoped note.');
        return;
      }
      if (form.bodyMd.trim().length === 0) {
        setError('The note body cannot be empty.');
        return;
      }

      const payload = {
        scopeType: form.scopeType,
        scopeKey,
        subject: form.scopeType === 'concept' ? form.subject.trim() : null,
        topic: form.scopeType === 'concept' && form.topic.trim().length > 0 ? form.topic.trim() : null,
        title: form.title.trim().length > 0 ? form.title.trim() : null,
        bodyMd: form.bodyMd,
        imageUrls: form.imageUrls.map((u) => u.trim()).filter((u) => u.length > 0),
      };

      setBusy(true);
      try {
        const url = editingId === null ? '/api/admin/notes' : `/api/admin/notes/${editingId}`;
        const res = await fetch(url, {
          method: editingId === null ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          setError(body?.message ?? 'Could not save the note.');
          return;
        }
        resetForm();
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [editingId, form, refresh, resetForm]
  );

  const setImageUrl = (index: number, value: string): void => {
    setForm((f) => ({ ...f, imageUrls: f.imageUrls.map((u, i) => (i === index ? value : u)) }));
  };
  const addImageRow = (): void => setForm((f) => ({ ...f, imageUrls: [...f.imageUrls, ''] }));
  const removeImageRow = (index: number): void =>
    setForm((f) => ({ ...f, imageUrls: f.imageUrls.length <= 1 ? [''] : f.imageUrls.filter((_, i) => i !== index) }));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Back to practice
        </Link>
        <h1 className={styles.title}>Notes</h1>
        <p className={styles.hint}>
          Attach an editorial note to one question, or to a whole subject/topic. Image URLs must come from the
          Hugging Face dataset repo (upload there first, then paste the resolve URL below).
        </p>
      </div>

      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form className={`card ${styles.form}`} onSubmit={(e) => void handleSubmit(e)}>
        <div className={styles.tabs} role="tablist" aria-label="Note scope">
          {(['question', 'concept'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={form.scopeType === s}
              className={`${styles.tab} ${form.scopeType === s ? styles.tabActive : ''}`}
              onClick={() => setForm((f) => ({ ...f, scopeType: s }))}
            >
              {s === 'question' ? 'One question' : 'Concept'}
            </button>
          ))}
        </div>

        <div className={styles.row}>
          {form.scopeType === 'question' ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="questionId">
                Question ID
              </label>
              <input
                id="questionId"
                className={styles.input}
                value={form.questionId}
                onChange={(e) => setForm((f) => ({ ...f, questionId: e.target.value }))}
              />
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="subject">
                  Subject
                </label>
                <input
                  id="subject"
                  className={styles.input}
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="topic">
                  Topic (blank = whole subject)
                </label>
                <input
                  id="topic"
                  className={styles.input}
                  value={form.topic}
                  onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="title">
            Title (optional)
          </label>
          <input
            id="title"
            className={styles.input}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="bodyMd">
            Body (Markdown)
          </label>
          <textarea
            id="bodyMd"
            className={styles.textarea}
            value={form.bodyMd}
            onChange={(e) => setForm((f) => ({ ...f, bodyMd: e.target.value }))}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Image URLs</span>
          {form.imageUrls.map((url, i) => (
            <div className={styles.imageRow} key={i}>
              <input
                className={styles.input}
                placeholder="https://huggingface.co/datasets/…/resolve/main/…"
                value={url}
                onChange={(e) => setImageUrl(i, e.target.value)}
              />
              <Button type="button" variant="ghost" onClick={() => removeImageRow(i)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={addImageRow} style={{ width: 'max-content' }}>
            + Add image
          </Button>
        </div>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            {editingId === null ? 'Create note' : 'Save changes'}
          </Button>
          {editingId === null ? null : (
            <Button type="button" variant="ghost" onClick={resetForm} disabled={busy}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <section className={`card ${styles.form}`}>
        <h2>Existing notes</h2>
        {notes === null ? (
          <p className={styles.hint}>Loading…</p>
        ) : notes.length === 0 ? (
          <p className={styles.hint}>No notes yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Title</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => (
                <tr key={note.id}>
                  <td>
                    {note.scopeType === 'question' ? (
                      <code className={styles.scopeBadge}>{note.scopeKey}</code>
                    ) : (
                      <span className={styles.scopeBadge}>
                        {note.subject}
                        {note.topic === null ? ' (all topics)' : ` · ${note.topic}`}
                      </span>
                    )}
                  </td>
                  <td>{note.title ?? <span className={styles.hint}>Untitled</span>}</td>
                  <td>{new Date(note.updatedAt).toLocaleString()}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button type="button" variant="ghost" onClick={() => handleEdit(note)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => void handleDelete(note.id)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
