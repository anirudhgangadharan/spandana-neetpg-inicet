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
 * There is no authentication by design — anyone with the link can practise. That
 * makes the API endpoints, and full-text search in particular, the obvious way to
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
/** Stop the map growing without bound on a long-lived process. */
const MAX_TRACKED_CLIENTS = 20_000;

const windows = new Map<string, Window>();

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first !== undefined) return first.trim();
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

  if (pathname.startsWith('/api/')) {
    const isSearch = pathname.startsWith('/api/search');
    const limit = isSearch ? LIMIT_SEARCH : LIMIT_DEFAULT;
    const { allowed, retryAfter } = rateLimit(`${clientKey(request)}:${isSearch ? 's' : 'a'}`, limit, Date.now());

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
  // /api/auth/signup), /login, and static assets. /api/health and every
  // other /api/* route stay in scope for the rate limiter above, matching
  // the original D-018 behaviour.
  matcher: ['/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)'],
};
