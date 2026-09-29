import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { facultyNoStore, facultyUuid } from '@/lib/api/facultyModuleRoutes';
import { deleteGuestParticipant } from '@/lib/db/guestStudents';
import { StudentAttemptError } from '@/lib/db/moduleAttempts';

export async function DELETE(request: Request, context: {
  params: Promise<{ id: string; participantId: string }>
}): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id, participantId } = await context.params;
  if (!facultyUuid.test(id) || !facultyUuid.test(participantId)) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: facultyNoStore });
  try {
    await deleteGuestParticipant(actor.userId, id, participantId);
    return NextResponse.json({ deleted: true }, { headers: facultyNoStore });
  } catch (error) {
    if (error instanceof StudentAttemptError) {
      return NextResponse.json({ message: 'Participant not found.' }, { status: 404, headers: facultyNoStore });
    }
    throw error;
  }
}
