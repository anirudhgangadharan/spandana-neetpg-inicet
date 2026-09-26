import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Built from the edge-safe config, not the full one in auth.ts — see
// auth.config.ts for why. JWT verification only needs AUTH_SECRET, which
// both instances read from the environment the same way, so this stays in
// sync with the full instance without sharing its (Node-only) provider code.
const { auth } = NextAuth(authConfig);

/**
 * Abuse protection for a publicly-linkable deployment.
 *
 * The practice and assessment APIs are authenticated, but full-text search and
 * write-heavy exam endpoints remain the obvious way to
 * make the instance expensive for everyone else. This is a fixed-window counter
 * per client IP: crude, but it is the difference between "one script can saturate
 * the box" and "one script gets 429s".
 *
 * In-memory, therefore per-instance. If the deployment is ever scaled to more
 * than one machine this stops being a global limit and should move to a shared
 * store. Recorded in DECISIONS.md D-018.
 */

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
/** Generous for a human working through questions; hostile to a scraper. */
const LIMIT_DEFAULT = 240;
/** Search hits FTS5 and is the most expensive endpoint per request. */
const LIMIT_SEARCH = 60;
/** Faculty grant routes are rare and particularly sensitive. */
const LIMIT_FACULTY_ACCESS = 30;
/** Builder writes and previews are scoped separately from general practice. */
const LIMIT_FACULTY_BUILDER = 90;
/** Destructive self-service operations should never be high-volume. */
const LIMIT_ACCOUNT = 10;
/** Per authenticated student so a classroom behind one NAT can autosave. */
const LIMIT_STUDENT_EXAM = 180;
/** Stop the map growing without bound on a long-lived process. */
const MAX_TRACKED_CLIENTS = 20_000;

const windows = new Map<string, Window>();

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.length > 0) {
    // The nearest trusted proxy appends the actual connecting address. Using
    // the last hop avoids trusting a client-supplied first XFF entry.
    const hops = forwarded.split(',').map((entry) => entry.trim()).filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest !== undefined) return nearest;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function rateLimit(key: string, limit: number, now: number): { allowed: boolean; retryAfter: number } {
  if (windows.size > MAX_TRACKED_CLIENTS) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    if (windows.size > MAX_TRACKED_CLIENTS) windows.clear();
  }

  const existing = windows.get(key);
  if (existing === undefined || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Two independent concerns share this one file because Next.js allows only a
 * single middleware:
 *
 *  - Abuse protection (D-018, above) — unchanged, still per-IP, still scoped
 *    to /api/*.
 *  - The accounts-plan login gate — page routes require a session; API
 *    routes already enforce their own auth server-side (see the `auth()`
 *    check at the top of every app/api/*\/route.ts handler added for the
 *    accounts plan), so they're covered by the rate limiter here instead of
 *    a redirect, which wouldn't make sense for a fetch() caller anyway.
 */
export default auth((request) => {
  const { pathname } = request.nextUrl;

  // The real exam component has a browser-test harness with no account or DB.
  // This path contains synthetic fixture data only. The route independently
  // returns 404 unless the local Playwright process supplies E2E_TEST_MODE.
  if (pathname.startsWith('/e2e-harness/')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    const isSearch = pathname.startsWith('/api/search') || pathname.startsWith('/api/faculty/questions');
    const isFacultyAccess = pathname.startsWith('/api/super-admin/faculty');
    const isFacultyBuilder = pathname.startsWith('/api/faculty/modules');
    const isAccount = pathname === '/api/me/account';
    const isSignup = pathname === '/api/auth/signup';
    const isCredentialSignin = pathname === '/api/auth/callback/credentials';
    const isStudentExam = pathname.startsWith('/api/module-attempts/') || pathname.startsWith('/api/modules/');
    const limit = isAccount || isSignup || isCredentialSignin ? LIMIT_ACCOUNT : isFacultyAccess ? LIMIT_FACULTY_ACCESS
      : isSearch ? LIMIT_SEARCH : isFacultyBuilder ? LIMIT_FACULTY_BUILDER
        : isStudentExam ? LIMIT_STUDENT_EXAM : LIMIT_DEFAULT;
    const bucket = isAccount ? 'account' : isSignup ? 'signup' : isCredentialSignin ? 'credentials'
      : isFacultyAccess ? 'faculty-access' : isSearch ? 's'
      : isFacultyBuilder ? 'faculty-builder' : isStudentExam ? 'student-exam' : 'a';
    const subject = request.auth?.user?.id
      ? `user:${request.auth.user.id}` : `ip:${clientKey(request)}`;
    const { allowed, retryAfter } = rateLimit(`${subject}:${bucket}`, limit, Date.now());

    if (!allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many requests. Slow down and try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.next();
  }

  if (!request.auth?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
});

export const config = {
  // Everything except the auth API itself (or signing in would redirect-
  // loop — this also covers the credentials-signup route, which lives at
  // /api/auth/signup), public legal/account-deletion guidance, /login, and static assets. /api/health and every
  // other /api/* route stay in scope for the rate limiter above, matching
  // the original D-018 behaviour.
  matcher: ['/api/auth/signup', '/api/auth/callback/credentials', '/((?!api/auth|login|privacy|delete-account|_next/static|_next/image|favicon.ico).*)'],
};
