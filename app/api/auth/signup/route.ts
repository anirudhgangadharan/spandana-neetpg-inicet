/**
 * Credentials signup. Auth.js has no built-in "create an account with a
 * password" flow — it only verifies credentials on sign-in — so this is a
 * small hand-rolled route. It creates the user and returns; the client then
 * calls `signIn('credentials', ...)` itself with the same email/password.
 */
import { NextResponse } from 'next/server';
import { createUserWithPassword, EmailTakenError } from '@/lib/db/userQueries';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }
  const { email: rawEmail, password, name: rawName } = body as Record<string, unknown>;

  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const name = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ message: 'Enter a valid email address.' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  try {
    const user = await createUserWithPassword(email, password, name);
    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }
    console.error('[signup] unexpected error', err);
    return NextResponse.json({ message: 'Could not create the account. Try again.' }, { status: 500 });
  }
}
