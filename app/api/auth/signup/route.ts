/**
 * Credentials signup. Auth.js has no built-in "create an account with a
 * password" flow — it only verifies credentials on sign-in — so this is a
 * small hand-rolled route. It creates the user and returns; the client then
 * calls `signIn('credentials', ...)` itself with the same email/password.
 */
import { NextResponse } from 'next/server';
import { createUserWithPassword, EmailTakenError } from '@/lib/db/userQueries';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { JsonBodyError, readBoundedJson } from '@/lib/api/jsonBody';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: Request): Promise<NextResponse> {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers });
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, 4096);
  } catch (error) {
    if (error instanceof JsonBodyError) {
      return NextResponse.json({ message: error.message }, { status: error.status, headers });
    }
    throw error;
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400, headers });
  }
  if (Array.isArray(body) || Object.keys(body).some((key) => !['email', 'password', 'name'].includes(key))) {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400, headers });
  }
  const { email: rawEmail, password, name: rawName } = body as Record<string, unknown>;

  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const name = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ message: 'Enter a valid email address.' }, { status: 400, headers });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400, headers }
    );
  }

  try {
    const user = await createUserWithPassword(email, password, name);
    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201, headers });
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return NextResponse.json({ message: err.message }, { status: 409, headers });
    }
    console.error('[signup] account creation failed');
    return NextResponse.json({ message: 'Could not create the account. Try again.' }, { status: 500, headers });
  }
}
