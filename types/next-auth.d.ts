/**
 * Module augmentation: no Auth.js adapter is used (see auth.ts), so the
 * session/JWT don't get a `user.id` by default — it's added in the jwt/
 * session callbacks and declared here so the rest of the app can rely on
 * `session.user.id` being a string, not `string | undefined`.
 */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      loginProvider?: 'google' | 'credentials';
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    loginProvider?: 'google' | 'credentials';
  }
}
