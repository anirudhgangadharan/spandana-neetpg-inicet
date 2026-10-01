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
        <p>Last updated 1 October 2026.</p>
        {operator ? <p>This service is operated by {operator}.</p> : null}
        <p>
          MedMCQA Practice stores your account identity, ordinary practice progress and bookmarks, and—when
          you take a faculty assessment—your answers, server-observed timing events, score, and attempt status.
          Faculty can view results for modules they own and can share a read-only analytics link. Anyone with that link can view student names, emails where available, registration and roll numbers, scores, and attempt results, and can forward the link. Disabling or replacing the link stops future access but cannot remove copies already made. Super administrators have no special access to faculty
          questions, answers, participant responses, or detailed analytics.
        </p>
        <p>
          A student opening a faculty test link can participate without an account. Before starting, the student
          provides a name, registration number, and roll number. These self-reported details identify the result
          to the owning faculty member; they do not verify identity. Answer choices stay in the browser until
          final submission. A closed browser or failed connection before submission may lose those choices.
          Submitted answers, scores, attempt status, and the three identity fields are stored on the server.
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
        <p>
          Guest test records remain until the owning faculty member erases the participant, the owning faculty
          account is deleted, or the operator processes a deletion request. Removing a published module from the faculty dashboard does not erase its
          assessment history. Guests can request deletion through the privacy contact below, identifying the
          faculty test and their registration and roll numbers. The operator must verify the request with the
          faculty member before deleting the record. Guest access cookies expire after 30 days.
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
