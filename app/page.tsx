/**
 * The practice route. A Server Component shell that reads facets and the build
 * manifest directly from SQLite — no client fetch for the static chrome — and
 * hands them to the client island (§11: server components for the static shell).
 *
 * If the corpus is missing or its answer-key checksum does not verify, this
 * renders a maintenance state instead of the app. There is no degraded mode that
 * serves questions from a suspect corpus (§3.2, I4).
 */

import { corpusStatus } from '@/lib/db/client';
import { getFacets } from '@/lib/db/queries';
import { PracticeShell } from '@/features/session/PracticeShell';
import { MaintenanceState } from '@/components/MaintenanceState';

// The corpus is a local file read synchronously; render on demand rather than
// attempting to statically prerender the shell at build time.
export const dynamic = 'force-dynamic';

export default function PracticePage(): React.JSX.Element {
  const status = corpusStatus();

  if (!status.ready || status.manifest === null) {
    return <MaintenanceState reason={status.reason} problems={status.problems} />;
  }

  return (
    <PracticeShell
      facets={getFacets()}
      copIndexBase={status.manifest.copIndexBase}
      appVersion={status.manifest.appVersion}
    />
  );
}
