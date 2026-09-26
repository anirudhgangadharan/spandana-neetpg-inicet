/**
 * Full Auth.js configuration (§ accounts plan) — Google + email/password,
 * JWT session strategy, NO database adapter. Extends auth.config.ts (the
 * edge-safe subset middleware.ts uses) with the Credentials provider and
 * the DB-backed jwt callback; see that file for why the split exists.
 *
 * No adapter: the standard Accounts/Sessions/VerificationToken tables buy
 * us nothing here — Credentials providers require the JWT strategy anyway,
 * and Google's identity is already verified by the OAuth handshake itself.
 * Instead, the `jwt` callback upserts directly into our own minimal `users`
 * table.
 *
 * The hard login gate itself lives in middleware.ts, not here — that file
 * also carries the pre-existing per-IP rate limiter (D-018), and Next.js
 * only allows one middleware, so the gate is inline there instead of in an
 * `authorized` callback.
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { upsertVerifiedGoogleUser, verifyCredentials } from '@/lib/db/userQueries';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.['email'] === 'string' ? credentials['email'].trim().toLowerCase() : '';
        const password = typeof credentials?.['password'] === 'string' ? credentials['password'] : '';
        if (email.length === 0 || password.length === 0) return null;

        const user = await verifyCredentials(email, password);
        if (user === null) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;
      return profile?.['email_verified'] === true && typeof account.providerAccountId === 'string';
    },
    async jwt({ token, account, user }) {
      // Only runs on the request where sign-in actually happens — `account`
      // is absent on every later token refresh, so this upsert isn't repeated
      // on every request.
      if (account?.provider === 'google' && user?.email && account.providerAccountId) {
        const dbUser = await upsertVerifiedGoogleUser(
          account.providerAccountId, user.email, user.name ?? null, user.image ?? null
        );
        token.id = dbUser.id;
        token.loginProvider = 'google';
      } else if (account?.provider === 'credentials' && user?.id) {
        token.id = user.id;
        token.loginProvider = 'credentials';
      }
      return token;
    },
  },
});
