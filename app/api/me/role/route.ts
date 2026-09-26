import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/roles';

export async function GET(): Promise<NextResponse> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ message: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ role: actor.role, canEditNotes: actor.canEditNotes }, { headers: { 'Cache-Control': 'no-store' } });
}
