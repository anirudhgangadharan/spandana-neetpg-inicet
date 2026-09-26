import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { expireDueStudentAttempts } from '@/lib/db/moduleAttempts';
import { studentNoStore } from '@/lib/api/studentModuleRoutes';

export const runtime = 'nodejs';

function authorized(request: Request): boolean {
  const secret = process.env['ATTEMPT_SWEEP_SECRET'];
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || !supplied) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Invoke every minute from the deployment scheduler. Lazy finalization on
 * student access remains the correctness backstop; this keeps faculty counts
 * current when an expired student never reconnects. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  }
  let finalized = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const count = await expireDueStudentAttempts(25);
    finalized += count;
    if (count < 25) break;
  }
  return NextResponse.json({ finalized }, { headers: studentNoStore });
}
