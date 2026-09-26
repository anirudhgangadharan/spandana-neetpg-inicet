import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getFacultyOverview } from '@/lib/db/facultyAnalytics';
import { facultyNoStore } from '@/lib/api/facultyModuleRoutes';

export async function GET(): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Forbidden.' }, { status: 403, headers: facultyNoStore });
  return NextResponse.json({ analytics: await getFacultyOverview(actor.userId) }, { headers: facultyNoStore });
}
