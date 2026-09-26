import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/roles';
import { AccountDeletionClient } from './AccountDeletionClient';
import styles from './account-delete.module.css';

export const dynamic = 'force-dynamic';

export default async function AccountDeletionPage(): Promise<React.JSX.Element> {
  const actor = await getCurrentActor();
  if (!actor) notFound();
  return <main id="main" className={styles.page}>
    <Link href="/">← Cancel and return to practice</Link>
    <AccountDeletionClient email={actor.email} isFaculty={actor.role === 'faculty'} />
  </main>;
}
