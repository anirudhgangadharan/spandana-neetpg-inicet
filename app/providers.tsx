'use client';

import { SessionProvider } from 'next-auth/react';

export function Providers({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <SessionProvider>{children}</SessionProvider>;
}
