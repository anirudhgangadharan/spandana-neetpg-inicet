import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/auth/admin';
import { deleteNote, updateNote, type NoteScope, type UpdateNoteInput } from '@/lib/db/notesQueries';

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user !== undefined && isAdminEmail(session.user.email);
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
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!(await requireAdmin())) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  await deleteNote(id);
  return NextResponse.json({ ok: true });
}
