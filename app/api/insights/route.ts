import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  countUnrevisitedWrongBookmarks,
  getConfidentWrong,
  getSubjectInsights,
  getWeakestTopics,
} from '@/lib/db/insightsQueries';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const [subjects, weakTopics, unrevisitedCount, confidentWrong] = await Promise.all([
    getSubjectInsights(session.user.id),
    getWeakestTopics(session.user.id),
    countUnrevisitedWrongBookmarks(session.user.id),
    getConfidentWrong(session.user.id),
  ]);

  return NextResponse.json({ subjects, weakTopics, unrevisitedCount, confidentWrong });
}
