/**
 * Session lifecycle, for drop-off analysis (accounts plan). The client mints
 * its own sessionId (crypto.randomUUID()) in store.ts, so starting a session
 * is a fire-and-forget POST — nothing blocks on a round-trip before the user
 * can see the first question.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { closeSession, createSession } from '@/lib/db/userQueries';
import { saveLastSessionConfig } from '@/lib/db/statsQueries';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { JsonBodyError, readBoundedJson } from '@/lib/api/jsonBody';

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
  /** Full config, saved as "last used" for the one-tap Continue path
   *  (frictionless-re-entry plan) — separate from the fields above, which
   *  are what actually creates the `sessions` row for drop-off analysis. */
  readonly rememberConfig?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });

  let body: StartBody;
  try {
    body = (await readBoundedJson(request, 64 * 1024)) as StartBody;
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ message: error.message }, { status: error.status });
    throw error;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ message: 'A JSON object is required.' }, { status: 400 });
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

  if (body.rememberConfig !== undefined && body.rememberConfig !== null) {
    await saveLastSessionConfig(session.user.id, body.rememberConfig);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

interface EndBody {
  readonly sessionId?: unknown;
  readonly submittedPaper?: unknown;
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });

  let body: EndBody;
  try {
    body = (await readBoundedJson(request, 4 * 1024)) as EndBody;
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ message: error.message }, { status: error.status });
    throw error;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ message: 'A JSON object is required.' }, { status: 400 });
  }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return NextResponse.json({ message: 'sessionId is required.' }, { status: 400 });
  }

  await closeSession(session.user.id, body.sessionId, body.submittedPaper === true);
  return NextResponse.json({ ok: true });
}
