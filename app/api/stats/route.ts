import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getUserStats } from '@/lib/db/statsQueries';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const stats = await getUserStats(session.user.id);
  return NextResponse.json(stats);
}
