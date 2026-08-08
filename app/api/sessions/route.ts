/**
 * Session lifecycle, for drop-off analysis (accounts plan). The client mints
 * its own sessionId (crypto.randomUUID()) in store.ts, so starting a session
 * is a fire-and-forget POST — nothing blocks on a round-trip before the user
 * can see the first question.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { closeSession, createSession } from '@/lib/db/userQueries';

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface StartBody {
  readonly sessionId?: unknown;
  readonly sources?: unknown;
  readonly subjects?: unknown;
  readonly topics?: unknown;
  readonly mode?: unknown;
  readonly plannedCount?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return NextResponse.json({ message: 'sessionId is required.' }, { status: 400 });
  }

  const plannedCount =
    typeof body.plannedCount === 'number' && Number.isFinite(body.plannedCount) ? body.plannedCount : 0;

  await createSession({
    sessionId: body.sessionId,
    userId: session.user.id,
    sources: stringList(body.sources),
    subjects: stringList(body.subjects),
    topics: stringList(body.topics),
    mode: body.mode === 'exam' ? 'exam' : 'study',
    plannedCount,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

interface EndBody {
  readonly sessionId?: unknown;
  readonly submittedPaper?: unknown;
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  let body: EndBody;
  try {
    body = (await request.json()) as EndBody;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return NextResponse.json({ message: 'sessionId is required.' }, { status: 400 });
  }

  await closeSession(session.user.id, body.sessionId, body.submittedPaper === true);
  return NextResponse.json({ ok: true });
}
