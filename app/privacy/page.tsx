import Link from 'next/link';
import styles from '../legal.module.css';

export const dynamic = 'force-dynamic';

export default function PrivacyPage(): React.JSX.Element {
  const operator = process.env['PRIVACY_OPERATOR_NAME'];
  const contact = process.env['PRIVACY_CONTACT_EMAIL'];
  return (
    <main id="main" className={styles.page}>
      <article className={`card ${styles.panel}`}>
        <h1>Privacy notice</h1>
        <p>Last updated 26 September 2026.</p>
        {operator ? <p>This service is operated by {operator}.</p> : null}
        <p>
          MedMCQA Practice stores your account identity, ordinary practice progress and bookmarks, and—when
          you take a faculty assessment—your answers, server-observed timing events, score, and attempt status.
          Faculty can view results only for modules they own. Super administrators cannot inspect faculty
          questions, answers, participant responses, or detailed analytics.
        </p>
        <h2>Why data is used</h2>
        <ul>
          <li>To authenticate accounts and preserve practice progress.</li>
          <li>To run timed assessments, enforce attempt limits, score submissions, and resume interrupted work.</li>
          <li>To provide the owning faculty member with descriptive cohort and question analytics.</li>
          <li>To protect the service with bounded logs and request-rate controls.</li>
        </ul>
        <h2>Deletion and retention</h2>
        <p>
          You can permanently delete your account in the application. Deletion removes ordinary practice data,
          assessment opens, attempts and responses linked to your account, authentication identities, and access
          grants. If you own faculty modules, those modules and every participant record under them are also
          deleted. The operation cannot be undone. Infrastructure-provider backups and security logs may persist
          for their provider-defined retention periods; those periods must be confirmed before launch.
        </p>
        <p><Link href="/delete-account">How to delete your account</Link></p>
        <h2>Security and contact</h2>
        <p>
          Data is transmitted over HTTPS in production. Access is checked server-side and the question corpus is
          read-only. No system can guarantee absolute security.
        </p>
        {operator && contact ? (
          <p>Privacy questions: <a href={`mailto:${contact}`}>{contact}</a>.</p>
        ) : (
          <p className={styles.notice} role="note">
            Privacy operator identity or contact is not configured. This is a release blocker, not a production privacy policy.
          </p>
        )}
        <p><Link href="/login">Return to sign in</Link></p>
      </article>
    </main>
  );
}
