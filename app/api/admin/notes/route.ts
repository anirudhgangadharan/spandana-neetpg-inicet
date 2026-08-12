/**
 * Admin CRUD for editorial notes (authored explanations plan).
 *
 *   GET  -> every note, newest first (admin table view)
 *   POST -> create one
 *
 * Both require session.user.email to be in ADMIN_EMAILS (lib/auth/admin.ts).
 * This is a separate, stricter gate than the plain login check middleware.ts
 * already applies to every page/API route — being signed in is necessary
 * but not sufficient here.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/auth/admin';
import { createNote, listNotes, type CreateNoteInput, type NoteScope } from '@/lib/db/notesQueries';

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user || !isAdminEmail(session.user.email)) return null;
  return session.user.id;
}

export async function GET(): Promise<NextResponse> {
  const userId = await requireAdmin();
  if (userId === null) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const notes = await listNotes();
  return NextResponse.json({ notes });
}

interface CreateBody {
  readonly scopeType?: unknown;
  readonly scopeKey?: unknown;
  readonly subject?: unknown;
  readonly topic?: unknown;
  readonly title?: unknown;
  readonly bodyMd?: unknown;
  readonly imageUrls?: unknown;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function imageUrlList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (!v.startsWith('https://')) return null;
    urls.push(v);
  }
  return urls;
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await requireAdmin();
  if (userId === null) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }

  const scopeType: unknown = body.scopeType;
  if (scopeType !== 'question' && scopeType !== 'concept') {
    return NextResponse.json({ message: 'scopeType must be "question" or "concept".' }, { status: 400 });
  }
  const scopeKey = nullableString(body.scopeKey);
  if (scopeKey === null) {
    return NextResponse.json({ message: 'scopeKey is required.' }, { status: 400 });
  }
  const subject = nullableString(body.subject);
  if (scopeType === 'concept' && subject === null) {
    return NextResponse.json({ message: 'subject is required for a concept note.' }, { status: 400 });
  }
  const bodyMd = typeof body.bodyMd === 'string' ? body.bodyMd.trim() : '';
  if (bodyMd.length === 0) {
    return NextResponse.json({ message: 'bodyMd is required.' }, { status: 400 });
  }
  const imageUrls = imageUrlList(body.imageUrls);
  if (imageUrls === null) {
    return NextResponse.json({ message: 'imageUrls must be https:// URLs.' }, { status: 400 });
  }

  const input: CreateNoteInput = {
    scopeType: scopeType as NoteScope,
    scopeKey,
    subject,
    topic: nullableString(body.topic),
    title: nullableString(body.title),
    bodyMd,
    imageUrls,
  };
  const note = await createNote(input);
  return NextResponse.json({ note }, { status: 201 });
}
