/**
 * Cross-device sync for bookmarks and attempt history (accounts plan).
 *
 * GET  -> the signed-in user's bookmarks + latest-per-question attempts, in
 *         the shape the client's local store already knows how to merge.
 * POST -> appends attempt events and applies bookmark puts/deletes. Subject/
 *         topic are re-derived from the corpus here, never trusted from the
 *         client — the same "don't trust the caller" posture the rest of
 *         this app already takes with dataset facts.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getQuestionById } from '@/lib/db/queries';
import { parseAttemptRecord } from '@/lib/core/attempt-record';
import {
  deleteBookmarks,
  getBookmarkIds,
  getLatestAttempts,
  insertAttemptEvents,
  upsertBookmarks,
  type BookmarkInput,
  type VerifiedAttemptEvent,
} from '@/lib/db/userQueries';
import { updateStreak } from '@/lib/db/streak';
import type { AttemptRecord, Confidence } from '@/types';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const [latest, bookmarkIds] = await Promise.all([
    getLatestAttempts(session.user.id),
    getBookmarkIds(session.user.id),
  ]);
  const bookmarked = new Set(bookmarkIds);
  const attempts: AttemptRecord[] = latest.map((a) => ({
    questionId: a.questionId,
    selectedIndex: a.selectedIndex as AttemptRecord['selectedIndex'],
    verdict: a.verdict as AttemptRecord['verdict'],
    attemptedAt: a.attemptedAt,
    durationMs: a.durationMs,
    bookmarked: bookmarked.has(a.questionId),
    confidence: a.confidence as Confidence | null,
  }));

  return NextResponse.json({ attempts, bookmarks: bookmarkIds });
}

interface SyncPayload {
  readonly attempts?: unknown[];
  readonly bookmarkPuts?: unknown[];
  readonly bookmarkDeletes?: unknown[];
  readonly sessionId?: unknown;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  let body: SyncPayload;
  try {
    body = (await request.json()) as SyncPayload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : null;

  const rawAttempts = Array.isArray(body.attempts) ? body.attempts : [];
  const verified: VerifiedAttemptEvent[] = [];
  for (const raw of rawAttempts) {
    const record = parseAttemptRecord(raw);
    if (record === null) continue;
    // Unknown question id: dropped rather than stored with fabricated
    // metadata, same posture as the rest of this route.
    const question = getQuestionById(record.questionId);
    if (question === null) continue;
    verified.push({
      questionId: record.questionId,
      subject: question.subject,
      topic: question.topic,
      selectedIndex: record.selectedIndex,
      verdict: record.verdict,
      attemptedAt: record.attemptedAt,
      durationMs: record.durationMs,
      sessionId,
      confidence: record.confidence ?? null,
    });
  }
  let streak = null;
  if (verified.length > 0) {
    await insertAttemptEvents(userId, verified);
    // Streak counts "answered something today," not any lesser sync event —
    // only updated when real attempts landed this call.
    streak = await updateStreak(userId);
  }

  const bookmarkPutIds = stringList(body.bookmarkPuts);
  const bookmarkPuts: BookmarkInput[] = [];
  for (const id of bookmarkPutIds) {
    const question = getQuestionById(id);
    if (question === null) continue;
    bookmarkPuts.push({ questionId: id, subject: question.subject, topic: question.topic });
  }
  const bookmarkDeletes = stringList(body.bookmarkDeletes);
  if (bookmarkPuts.length > 0) await upsertBookmarks(userId, bookmarkPuts);
  if (bookmarkDeletes.length > 0) await deleteBookmarks(userId, bookmarkDeletes);

  return NextResponse.json({ ok: true, streak });
}
