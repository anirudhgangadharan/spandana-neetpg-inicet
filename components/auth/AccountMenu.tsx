'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import styles from './accountMenu.module.css';

export function AccountMenu(): React.JSX.Element | null {
  const { data: session } = useSession();
  if (!session?.user) return null;

  const email = session.user.email ?? '';
  const initial = (session.user.name ?? email).charAt(0).toUpperCase();

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
        <Link href="/insights" className={styles.link}>
          Insights
        </Link>
        <button type="button" className={styles.link} onClick={() => void signOut({ callbackUrl: '/login' })}>
          Sign out
        </button>
      </div>
    </div>
  );
}
