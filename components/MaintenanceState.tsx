/**
 * The maintenance state (§3.2).
 *
 * Shown when `corpus.sqlite` is absent, or when the answer-key checksum
 * recomputed from the database does not match the manifest. In that situation the
 * app refuses to serve questions at all: displaying an answer we cannot vouch for
 * is worse than displaying nothing (I4, T6).
 *
 * A Server Component — no interactivity, no client JS.
 */

export interface MaintenanceStateProps {
  readonly reason: string | null;
  readonly problems: readonly string[];
}

export function MaintenanceState({ reason, problems }: MaintenanceStateProps): React.JSX.Element {
  const missingCorpus = reason !== null && reason.includes('not found');

  return (
    <main
      id="main"
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: 'var(--space-12) var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-title)', lineHeight: 'var(--leading-title)' }}>
          {missingCorpus ? 'The question corpus has not been built' : 'Questions are unavailable'}
        </h1>

        <p
          style={{
            marginTop: 'var(--space-4)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-callout)',
            lineHeight: '22px',
          }}
        >
          {missingCorpus ? (
            <>
              Run the extract-transform-load pipeline to build it from the dataset in <code>data/raw/</code>:
            </>
          ) : (
            <>
              The integrity check on the answer key did not pass, so this application will not serve any
              questions. This is deliberate: an answer that cannot be verified against the build checksum must
              not be shown to anyone revising for an exam.
            </>
          )}
        </p>

        {missingCorpus ? (
          <pre
            style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-sunken)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              overflowX: 'auto',
            }}
          >
            pnpm data:build
          </pre>
        ) : null}

        {reason === null ? null : (
          <p
            style={{
              marginTop: 'var(--space-4)',
              fontSize: 'var(--text-caption)',
              color: 'var(--text-tertiary)',
            }}
          >
            {reason}
          </p>
        )}

        {problems.length === 0 ? null : (
          <ul
            style={{
              marginTop: 'var(--space-3)',
              paddingInlineStart: 'var(--space-4)',
              fontSize: 'var(--text-caption)',
              color: 'var(--text-tertiary)',
              display: 'grid',
              gap: 'var(--space-1)',
            }}
          >
            {problems.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
