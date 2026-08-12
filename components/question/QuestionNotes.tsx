'use client';

/**
 * Editorial notes for the question on screen (authored explanations plan).
 * Fetches its own data from /api/notes rather than being threaded through
 * the store — notes are admin-authored, read-only from here, and unrelated
 * to session/attempt state.
 *
 * `body_md` is rendered through react-markdown, which walks to a React
 * element tree itself — it never builds an HTML string and never touches
 * `dangerouslySetInnerHTML` (banned outright, §13.6/D-006). Raw HTML inside
 * a note's markdown is not parsed as HTML; it prints as literal text. Link
 * and image URLs are passed through react-markdown's default urlTransform,
 * which drops anything not http(s)/mailto/tel (e.g. `javascript:`).
 */

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './question.module.css';

interface Note {
  readonly id: string;
  readonly title: string | null;
  readonly bodyMd: string;
  readonly imageUrls: readonly string[];
}

export interface QuestionNotesProps {
  readonly questionId: string;
}

export function QuestionNotes({ questionId }: QuestionNotesProps): React.JSX.Element | null {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    void (async () => {
      try {
        const res = await fetch(`/api/notes?questionId=${encodeURIComponent(questionId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { notes: Note[] };
        if (!cancelled) setNotes(body.notes);
      } catch {
        // Notes are a bonus surface — a failed fetch just means none show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (notes === null || notes.length === 0) return null;

  return (
    <section className={styles.notes} aria-label="Notes">
      <button
        type="button"
        className={styles.notesToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.notesTitle}>
          Notes <span className={styles.notesCount}>({notes.length})</span>
        </span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open ? (
        <div className={styles.notesBody}>
          {notes.map((note) => (
            <article key={note.id} className={styles.noteItem}>
              {note.title === null ? null : <h4 className={styles.noteItemTitle}>{note.title}</h4>}
              <div className={styles.noteMarkdown}>
                <ReactMarkdown>{note.bodyMd}</ReactMarkdown>
              </div>
              {note.imageUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" loading="lazy" className={styles.noteImage} />
              ))}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
