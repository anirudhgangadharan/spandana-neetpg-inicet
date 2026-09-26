import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/roles';
import { deleteNote, updateNote, type NoteScope, type UpdateNoteInput } from '@/lib/db/notesQueries';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { JsonBodyError, readBoundedJson } from '@/lib/api/jsonBody';

async function requireAdmin(): Promise<boolean> {
  const actor = await getCurrentActor();
  return actor?.canEditNotes === true;
}

interface PatchBody {
  readonly scopeType?: unknown;
  readonly scopeKey?: unknown;
  readonly subject?: unknown;
  readonly topic?: unknown;
  readonly title?: unknown;
  readonly bodyMd?: unknown;
  readonly imageUrls?: unknown;
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!(await requireAdmin())) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await readBoundedJson(request, 128 * 1024)) as PatchBody;
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ message: error.message }, { status: error.status });
    throw error;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ message: 'A JSON object is required.' }, { status: 400 });
  }

  const patch: UpdateNoteInput = {};
  if (body.scopeType === 'question' || body.scopeType === 'concept') patch.scopeType = body.scopeType as NoteScope;
  if (typeof body.scopeKey === 'string' && body.scopeKey.trim().length > 0) patch.scopeKey = body.scopeKey.trim();
  if ('subject' in body) patch.subject = typeof body.subject === 'string' && body.subject.trim().length > 0 ? body.subject.trim() : null;
  if ('topic' in body) patch.topic = typeof body.topic === 'string' && body.topic.trim().length > 0 ? body.topic.trim() : null;
  if ('title' in body) patch.title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null;
  if (typeof body.bodyMd === 'string' && body.bodyMd.trim().length > 0) patch.bodyMd = body.bodyMd.trim();
  if ('imageUrls' in body) {
    const urls = imageUrlList(body.imageUrls);
    if (urls === null) return NextResponse.json({ message: 'imageUrls must be https:// URLs.' }, { status: 400 });
    patch.imageUrls = urls;
  }

  const note = await updateNote(id, patch);
  if (note === null) return NextResponse.json({ message: 'Note not found.' }, { status: 404 });
  return NextResponse.json({ note });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!(await requireAdmin())) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const { id } = await params;
  await deleteNote(id);
  return NextResponse.json({ ok: true });
}
