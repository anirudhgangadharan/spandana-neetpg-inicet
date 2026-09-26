import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { deleteAccount } from '@/lib/db/accountDeletion';
import { JsonBodyError, readBoundedJson } from '@/lib/api/jsonBody';

const noStore = { 'Cache-Control': 'no-store' };

export async function DELETE(request: Request): Promise<NextResponse> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401, headers: noStore });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: noStore });
  }
  let body: unknown;
  try { body = await readBoundedJson(request, 512); }
  catch (error) {
    if (error instanceof JsonBodyError) {
      return NextResponse.json({ message: error.message }, { status: error.status, headers: noStore });
    }
    throw error;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'email') ||
      typeof (body as { email?: unknown }).email !== 'string') {
    return NextResponse.json({ message: 'Enter the account email exactly.' }, { status: 400, headers: noStore });
  }
  try {
    const result = await deleteAccount(actor.userId, (body as { email: string }).email);
    if (!result.deleted) {
      return NextResponse.json({ message: 'The confirmation email did not match.' }, { status: 400, headers: noStore });
    }
    return NextResponse.json({ deleted: true }, { headers: noStore });
  } catch {
    // Do not put account identifiers, emails, database errors, or bind values
    // in logs. The route and status are sufficient for platform correlation.
    console.error('[account-delete] transaction failed');
    return NextResponse.json({ message: 'Account deletion failed. Try again.' }, { status: 500, headers: noStore });
  }
}
