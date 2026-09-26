import Link from 'next/link';
import styles from '../legal.module.css';

export default function DeleteAccountPage(): React.JSX.Element {
  return (
    <main id="main" className={styles.page}>
      <article className={`card ${styles.panel}`}>
        <h1>Delete your MedMCQA Practice account</h1>
        <p>
          Sign in to the account you want to delete, open <strong>Delete account</strong> from the account menu,
          type the account email exactly, and confirm permanent deletion.
        </p>
        <p>
          This deletes the account, ordinary practice progress and bookmarks, authentication identities,
          assessment opens, attempts, responses, and access grants. Faculty deletion also deletes every module
          owned by that faculty account and all participant data attached to those modules. This cannot be undone.
        </p>
        <p>
          <Link href="/login?callbackUrl=%2Faccount%2Fdelete">Sign in and continue to account deletion</Link>
        </p>
        <p><Link href="/privacy">Read the privacy notice</Link></p>
      </article>
    </main>
  );
}
