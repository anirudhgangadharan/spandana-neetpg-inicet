import Link from 'next/link';
import { Button } from '@/components/ui/primitives';
import type { AnalyticsBreakdown, DistributionBucket, FacultyOverview, ModuleAnalytics } from '@/lib/db/facultyAnalytics';
import { ANALYTICS_SMALL_SAMPLE } from '@/lib/db/facultyAnalytics';
import { RecoveryButton } from './RecoveryButton';
import { AnalyticsShareControl } from './AnalyticsShareControl';
import styles from './analytics.module.css';

function value(value: number | null, suffix = ''): string {
  return value === null ? 'Not enough data' : `${Math.round(value * 10) / 10}${suffix}`;
}
function duration(seconds: number | null): string {
  if (seconds === null) return 'Not enough data';
  const rounded = Math.round(seconds);
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}
function Metric({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <div className={`card ${styles.metric}`}><span className={styles.muted}>{label}</span><strong>{children}</strong></div>;
}
function SampleNotice({ count, unit = 'finalized attempts' }: { count: number; unit?: string }): React.JSX.Element | null {
  if (count >= ANALYTICS_SMALL_SAMPLE) return null;
  return <p className={styles.notice}>Small sample: {count} {unit}. Treat comparisons as descriptive, not conclusive.</p>;
}
function Distribution({ values, empty }: { values: readonly DistributionBucket[]; empty: string }): React.JSX.Element {
  if (values.length === 0) return <p className={styles.muted}>{empty}</p>;
  const maximum = Math.max(...values.map((item) => item.count));
  return <ul className={styles.distribution}>{values.map((item) => <li className={styles.barRow} key={item.label}>
    <span>{item.label}</span><span className={styles.barTrack} aria-hidden="true"><span className={styles.bar} style={{ width: `${item.count / maximum * 100}%` }} /></span>
    <span className={styles.numeric}>{item.count}</span>
  </li>)}</ul>;
}
function BreakdownTable({ caption, rows }: { caption: string; rows: readonly AnalyticsBreakdown[] }): React.JSX.Element {
  return <div className={styles.tableWrap} role="region" aria-label={caption} tabIndex={0}><table className={styles.table}>
    <caption>{caption}</caption><thead><tr><th scope="col">Area</th><th scope="col">Questions</th><th scope="col">Finalized observations</th><th scope="col">Accuracy among answers</th><th scope="col">Skip rate</th></tr></thead>
    <tbody>{rows.length === 0 ? <tr><td colSpan={5}>No finalized attempts yet.</td></tr> : rows.map((row) => <tr key={row.label}>
      <th scope="row">{row.label}</th><td className={styles.numeric}>{row.questionCount}</td><td className={styles.numeric}>{row.observations}</td>
      <td className={styles.numeric}>{value(row.accuracyPercent, '%')} ({row.correct}/{row.answered})</td>
      <td className={styles.numeric}>{value(row.skipPercent, '%')} ({row.skipped}/{row.observations})</td>
    </tr>)}</tbody>
  </table></div>;
}

export function ModuleAnalyticsView({ analytics, shared }: { analytics: ModuleAnalytics; shared?: { baseUrl: string; generatedAt: string } }): React.JSX.Element {
  const moduleSummary = analytics.module;
  const queryPrefix = shared?.baseUrl ?? `/faculty/modules/${moduleSummary.id}/analytics`;
  return <>
    <header className={styles.header}>
      {shared ? <p>Shared analytics · Read-only</p> : <nav className={styles.headerNav} aria-label="Faculty navigation"><Link href="/faculty/modules">← Modules</Link><Link href="/faculty/analytics">Overall analytics</Link><Link href={`/faculty/modules/${moduleSummary.id}`}>Edit module</Link></nav>}
      <h1>{moduleSummary.title}: analytics</h1>
      {shared ? <p>Data generated: <time dateTime={shared.generatedAt}>{shared.generatedAt}</time> · <a href={`${queryPrefix}?page=${analytics.participants.page}&q=${encodeURIComponent(analytics.participants.search)}`}>Refresh analytics</a></p> : <AnalyticsShareControl moduleId={moduleSummary.id} />}
      <p className={styles.muted}>Final score statistics include submitted and server-expired attempts. Active attempts appear only in participation counts.</p>
    </header>
    <section aria-labelledby="participation-heading"><h2 id="participation-heading">Participation</h2><div className={styles.metricGrid}>
      <Metric label="Unique opens">{moduleSummary.openedUsers}</Metric><Metric label="Unique starters">{moduleSummary.uniqueStarters}</Metric>
      <Metric label="All attempts">{moduleSummary.startedAttempts}</Metric><Metric label="Submitted">{moduleSummary.submittedAttempts}</Metric>
      <Metric label="Expired">{moduleSummary.expiredAttempts}</Metric><Metric label="Active / incomplete">{moduleSummary.activeAttempts}</Metric>
      <Metric label="Opened, not started">{moduleSummary.incompleteOpens}</Metric><Metric label="Finalization rate">{value(moduleSummary.completionPercent, '%')}</Metric>
    </div></section>
    <SampleNotice count={analytics.scores.sampleSize} />
    <div className={styles.twoColumn}>
      <section className={`card ${styles.panel}`} aria-labelledby="score-heading"><h2 id="score-heading">Scores</h2>
        <div className={styles.metricGrid}><Metric label="Mean">{value(analytics.scores.mean)}</Metric><Metric label="Median">{value(analytics.scores.median)}</Metric><Metric label="Highest">{value(analytics.scores.highest)}</Metric><Metric label="Lowest">{value(analytics.scores.lowest)}</Metric></div>
        {analytics.scores.highestParticipant ? <p>Highest: {analytics.scores.highestParticipant.name ?? analytics.scores.highestParticipant.email} {analytics.scores.highestParticipant.email ? <span className={styles.muted}>({analytics.scores.highestParticipant.email})</span> : null}</p> : null}
        {analytics.scores.lowestParticipant ? <p>Lowest: {analytics.scores.lowestParticipant.name ?? analytics.scores.lowestParticipant.email} {analytics.scores.lowestParticipant.email ? <span className={styles.muted}>({analytics.scores.lowestParticipant.email})</span> : null}</p> : null}
        <h3>Distribution</h3><Distribution values={analytics.scores.distribution} empty="No final scores yet." />
      </section>
      <section className={`card ${styles.panel}`} aria-labelledby="time-heading"><h2 id="time-heading">Completion time</h2>
        <Metric label="Median">{duration(analytics.completionTimes.medianSeconds)}</Metric>
        <p className={styles.muted}>Measured from the server start time to submission, capped at the deadline.</p>
        <Distribution values={analytics.completionTimes.distribution} empty="No completed timings yet." />
      </section>
    </div>
    <section className={`card ${styles.panel}`}><BreakdownTable caption="Performance by subject (weakest first)" rows={analytics.subjects} /></section>
    <section className={`card ${styles.panel}`}><BreakdownTable caption="Performance by topic (weakest first)" rows={analytics.topics} /></section>
    <section className={`card ${styles.panel}`}><div className={styles.tableWrap} role="region" aria-label="Question analysis" tabIndex={0}><table className={styles.table}>
      <caption>Question analysis</caption><thead><tr><th scope="col">Question</th><th scope="col">Subject / topic</th><th scope="col">Accuracy among answers</th><th scope="col">Skip rate</th><th scope="col">Estimated active time</th></tr></thead>
      <tbody>{analytics.questions.map((question) => <tr key={question.position}><th scope="row">{question.position}. {question.label}</th><td>{question.subject}<br/><span className={styles.muted}>{question.topic ?? 'No topic'}</span></td>
        <td className={styles.numeric}>{value(question.accuracyPercent, '%')} ({question.correct}/{question.answered})</td><td className={styles.numeric}>{value(question.skipPercent, '%')} ({question.skipped}/{question.observations})</td>
        <td className={styles.numeric}>{question.estimatedTimeMs === null ? 'No sample' : duration(question.estimatedTimeMs / 1000)} <span className={styles.muted}>(n={question.timingSamples})</span></td></tr>)}</tbody>
    </table></div><p className={styles.muted}>Active time is a bounded server-observed estimate. Background tabs, refreshes, and the final segment after expiry may be undercounted; it is not proctoring telemetry.</p></section>
    <section className={`card ${styles.panel}`} aria-labelledby="students-heading"><h2 id="students-heading">Student attempts</h2>
      <form className={styles.search} action={queryPrefix} method="get"><label htmlFor="student-search">Search by name, registration number, roll number, or email<input id="student-search" name="q" defaultValue={analytics.participants.search} maxLength={120} /></label><Button type="submit">Search</Button></form>
      <div className={styles.tableWrap} role="region" aria-label="Student attempt results table" tabIndex={0}><table className={styles.table}><caption>Attempts, newest first</caption><thead><tr><th scope="col">Student</th><th scope="col">Attempt</th><th scope="col">Status</th><th scope="col">Score</th><th scope="col">Correct / wrong / blank</th><th scope="col">Elapsed</th></tr></thead><tbody>
        {analytics.participants.items.length === 0 ? <tr><td colSpan={6}>No matching attempts.</td></tr> : analytics.participants.items.map((attempt) => <tr key={attempt.attemptId}><th scope="row">{attempt.studentName ?? 'Unnamed student'}<br/><span className={styles.muted}>{attempt.registrationNumber !== null ? `Registration: ${attempt.registrationNumber} · Roll: ${attempt.rollNumber}` : attempt.studentEmail}</span>{!shared && attempt.guestParticipantId ? <RecoveryButton moduleId={analytics.module.id} participantId={attempt.guestParticipantId} /> : null}</th><td>{attempt.attemptNumber}</td><td>{attempt.status === 'expired' ? 'Expired / unsubmitted' : attempt.status}</td><td>{value(attempt.score)}</td><td>{attempt.correctCount ?? '—'} / {attempt.wrongCount ?? '—'} / {attempt.unansweredCount ?? '—'}</td><td>{duration(attempt.elapsedSeconds)}</td></tr>)}
      </tbody></table></div>
      <nav className={styles.pager} aria-label="Student attempt pages">{analytics.participants.page > 1 ? <Link href={`${queryPrefix}?page=${analytics.participants.page - 1}&q=${encodeURIComponent(analytics.participants.search)}`}>← Previous</Link> : null}<span>Page {analytics.participants.page}</span>{analytics.participants.hasNext ? <Link href={`${queryPrefix}?page=${analytics.participants.page + 1}&q=${encodeURIComponent(analytics.participants.search)}`}>Next →</Link> : null}</nav>
    </section>
  </>;
}

export function FacultyOverviewView({ analytics }: { analytics: FacultyOverview }): React.JSX.Element {
  const finalized = analytics.totals.finalizedAttempts;
  return <>
    <header className={styles.header}><nav className={styles.headerNav}><Link href="/faculty/modules">← Modules</Link><Link href="/">Practice home</Link></nav><h1>Faculty analytics</h1><p className={styles.muted}>Only modules owned by your verified faculty account are included.</p></header>
    <div className={styles.metricGrid}><Metric label="Modules">{analytics.totals.modules}</Metric><Metric label="Unique module opens">{analytics.totals.openedUsers}</Metric><Metric label="Attempts started">{analytics.totals.startedAttempts}</Metric><Metric label="Attempts finalized">{finalized}</Metric></div>
    <SampleNotice count={finalized} />
    <section className={`card ${styles.panel}`}><div className={styles.tableWrap} role="region" aria-label="Participation and completion by module" tabIndex={0}><table className={styles.table}><caption>Participation and completion by module</caption><thead><tr><th scope="col">Module</th><th scope="col">Status</th><th scope="col">Opened</th><th scope="col">Started</th><th scope="col">Finalized</th><th scope="col">Completion</th><th scope="col">Mean score</th></tr></thead><tbody>
      {analytics.modules.length === 0 ? <tr><td colSpan={7}>No modules yet.</td></tr> : analytics.modules.map((item) => <tr key={item.id}><th scope="row"><Link href={`/faculty/modules/${item.id}/analytics`}>{item.title}</Link>{item.needsAttention ? <><br/><span className={styles.attention}>Needs attention</span></> : null}</th><td>{item.status}</td><td>{item.openedUsers}</td><td>{item.startedAttempts}</td><td>{item.finalizedAttempts}</td><td>{value(item.completionPercent, '%')}</td><td>{value(item.meanScore)}</td></tr>)}
    </tbody></table></div></section>
    <section className={`card ${styles.panel}`}><BreakdownTable caption="Aggregate subject performance (weakest first)" rows={analytics.subjects} /></section>
    <section className={`card ${styles.panel}`}><BreakdownTable caption="Aggregate topic performance (weakest first)" rows={analytics.topics} /></section>
    <section className={`card ${styles.panel}`}><div className={styles.tableWrap} role="region" aria-label="Frequently missed questions" tabIndex={0}><table className={styles.table}><caption>Frequently missed questions</caption><thead><tr><th scope="col">Question</th><th scope="col">Subject / topic</th><th scope="col">Accuracy among answers</th><th scope="col">Answered sample</th></tr></thead><tbody>
      {analytics.frequentlyMissed.length === 0 ? <tr><td colSpan={4}>No answered questions yet.</td></tr> : analytics.frequentlyMissed.map((question) => <tr key={`${question.questionId}-${question.position}`}><th scope="row">{question.label}</th><td>{question.subject} / {question.topic ?? 'No topic'}</td><td>{value(question.accuracyPercent, '%')}</td><td>{question.answered}</td></tr>)}
    </tbody></table></div><p className={styles.muted}>Ranked descriptively by observed accuracy. Small samples are not evidence that a concept is intrinsically difficult.</p></section>
  </>;
}
