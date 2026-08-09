/**
 * Edge-safe subset of the Auth.js config, used ONLY by middleware.ts.
 *
 * Middleware runs in a constrained, edge-like runtime even in this
 * self-hosted Docker deployment — Next.js bundles it separately regardless
 * of host. Must not import anything that touches bcryptjs or the database:
 * the Credentials provider's authorize() needs both, and pulling that
 * import graph into middleware's bundle either warns at build time (it did)
 * or breaks at request time, even though middleware never actually calls
 * authorize() itself.
 *
 * auth.ts extends this with the Credentials provider and the DB-backed jwt
 * callback, and is used everywhere else (API routes, server components) —
 * those run in the regular Node.js runtime, where bcryptjs works fine.
 *
 * `trustHost: true` — required for any self-hosted deployment that isn't
 * auto-detected as trusted (Vercel, Netlify). Render proxies and forwards
 * every request, and without this Auth.js refuses the incoming Host header
 * outright, surfacing to the client as a generic "server configuration"
 * error with no further detail.
 */
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [Google],
} satisfies NextAuthConfig;
