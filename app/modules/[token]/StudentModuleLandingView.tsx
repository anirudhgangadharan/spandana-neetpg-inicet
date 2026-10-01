import Link from 'next/link';
import type { StudentModuleLanding } from '@/lib/db/studentModules';
import { StartModuleButton } from './StartModuleButton';
import { GuestRegistration } from './GuestRegistration';
import styles from '@/app/module-exam.module.css';

export function StudentModuleLandingView({ landing, token, registered = true }: {
  readonly landing: Exclude<StudentModuleLanding, { state: 'unavailable' }>;
  readonly token: string;
  readonly registered?: boolean;
}): React.JSX.Element {
  return <main id="main" className={styles.page}>
    {registered ? <Link href="/">← Back to practice</Link> : <Link href="/privacy">Privacy notice</Link>}
    {landing.state === 'resume' ? <section className={`card ${styles.panel}`}>
      <h1>Continue your attempt</h1>
      <p>Your existing attempt is still available. Its original server deadline has not changed.</p>
      <Link href={`/module-attempts/${landing.attemptId}`}>Open attempt</Link>
    </section> : landing.state === 'finished' ? <section className={`card ${styles.panel}`}>
      <h1>Module no longer available</h1>
      <p>You can still view your completed attempt and its permitted result.</p>
      <Link href={`/module-attempts/${landing.attemptId}`}>View result</Link>
    </section> : landing.state === 'upcoming' ? <section className={`card ${styles.panel}`}>
      <h1>Module not open yet</h1>
      <p>This module opens on <time dateTime={landing.opensAt}>{new Date(landing.opensAt).toUTCString()}</time>.</p>
    </section> : landing.state === 'closed' ? <section className={`card ${styles.panel}`}>
      <h1>Module closed</h1>
      <p>The availability window has ended.</p>
      {landing.lastAttemptId ? <Link href={`/module-attempts/${landing.lastAttemptId}`}>View your latest result</Link> : null}
    </section> : <>
      <header className={styles.header}>
        <h1>{landing.title}</h1>
        {landing.description ? <p>{landing.description}</p> : null}
      </header>
      <section className={`card ${styles.panel}`} aria-labelledby="before-start-heading">
        <h2 id="before-start-heading">Before you start</h2>
        <dl className={styles.facts}>
          <div><dt>Questions</dt><dd>{landing.questionCount}</dd></div>
          <div><dt>Time limit</dt><dd>{Math.ceil(landing.durationSeconds / 60)} minutes, ending no later than the module close time</dd></div>
          <div><dt>Attempts</dt><dd>{landing.attemptsUsed} of {landing.maxAttempts} used</dd></div>
          <div><dt>Marking</dt><dd>+{landing.correctPoints} correct / {landing.wrongPoints} incorrect / {landing.blankPoints} unanswered</dd></div>
          <div><dt>Results</dt><dd>Score immediately after submission. {landing.allowReview ? 'Answers and explanations available afterward.' : 'Answers and explanations remain hidden.'}</dd></div>
          <div><dt>Closes</dt><dd><time dateTime={landing.closesAt}>{new Date(landing.closesAt).toUTCString()}</time></dd></div>
        </dl>
        {landing.instructions ? <div className={styles.instructions}><h3>Instructions</h3><p>{landing.instructions}</p></div> : null}
        <p className={styles.notice}>Your professor can see your identity, submitted answers, and score. They may share a read-only analytics link that lets anyone with the link view your identity and attempt results. Answers remain only in this browser until final submission. Closing the browser or losing connectivity before submission may lose them.</p>
        {!registered ? <GuestRegistration token={token} /> : landing.activeAttemptId ? <Link href={`/module-attempts/${landing.activeAttemptId}`}>Resume current attempt</Link>
          : landing.attemptsUsed < landing.maxAttempts ? <StartModuleButton token={token} />
            : <p>You have used all permitted attempts.</p>}
        {landing.lastAttemptId && landing.lastAttemptId !== landing.activeAttemptId ? <p><Link href={`/module-attempts/${landing.lastAttemptId}`}>View your latest result</Link></p> : null}
      </section>
    </>}
  </main>;
}
