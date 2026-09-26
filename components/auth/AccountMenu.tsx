'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import styles from './accountMenu.module.css';

export function AccountMenu(): React.JSX.Element | null {
  const { data: session } = useSession();
  const [access, setAccess] = useState<{ role: string; canEditNotes: boolean } | null>(null);
  useEffect(() => {
    setAccess(null);
    if (!session?.user?.id) return;
    let active = true;
    void fetch('/api/me/role', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<{ role: string; canEditNotes: boolean }> : null)
      .then((value) => { if (active) setAccess(value); })
      .catch(() => { if (active) setAccess(null); });
    return () => { active = false; };
  }, [session?.user?.id]);
  if (!session?.user) return null;

  const email = session.user.email ?? '';
  const initial = (session.user.name ?? email).charAt(0).toUpperCase();

  function signOutSafely(): void {
    const prefix = `faculty-unsent:${session?.user?.id}:`;
    const pendingKeys: string[] = [];
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) pendingKeys.push(key);
    }
    if (pendingKeys.length > 0 && !window.confirm('Some exam answers have not reached the server. Sign out and discard those unsaved choices?')) return;
    for (const key of pendingKeys) sessionStorage.removeItem(key);
    void signOut({ callbackUrl: '/login' });
  }

  return (
    <div className={styles.wrap}>
      {session.user.image !== null && session.user.image !== undefined ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.avatar} src={session.user.image} alt="" />
      ) : (
        <span className={styles.initial} aria-hidden="true">
          {initial}
        </span>
      )}
      <span className={styles.email}>{email}</span>
      <div className={styles.links}>
        {access?.role === 'faculty' ? <Link href="/faculty/modules" className={styles.link}>Faculty</Link> : null}
        {access?.role === 'super_admin' ? <Link href="/super-admin/faculty" className={styles.link}>Faculty access</Link> : null}
        {access?.canEditNotes ? <Link href="/admin/notes" className={styles.link}>Editorial notes</Link> : null}
        <Link href="/insights" className={styles.link}>
          Insights
        </Link>
        <Link href="/account/delete" className={styles.link}>Delete account</Link>
        <Link href="/privacy" className={styles.link}>Privacy</Link>
        <button type="button" className={styles.link} onClick={signOutSafely}>
          Sign out
        </button>
      </div>
    </div>
  );
}
