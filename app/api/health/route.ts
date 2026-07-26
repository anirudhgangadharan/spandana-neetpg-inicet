/**
 * GET /api/health — corpus readiness and the §3.2 integrity verdict.
 *
 * Never throws: this is the endpoint the maintenance state consults, so it must
 * be able to report that the corpus is broken.
 *
 * On a public deployment the diagnostic detail is trimmed: the failure reasons
 * and problem strings contain absolute filesystem paths, which are useful in
 * development and are gratuitous disclosure in production. The `answerKeyHash`
 * is a checksum over public data and is safe to publish — and publishing it is
 * arguably the point, since it lets anyone verify the corpus they are being
 * served matches the one that was built.
 */

import { NextResponse } from 'next/server';
import { corpusStatus } from '@/lib/db/client';

const isProduction = process.env.NODE_ENV === 'production';

export function GET(): NextResponse {
  const status = corpusStatus();

  return NextResponse.json(
    {
      ready: status.ready,
      reason: status.ready ? null : isProduction ? 'corpus unavailable' : status.reason,
      problems: isProduction ? [] : status.problems,
      corpus:
        status.manifest === null
          ? null
          : {
              builtAt: status.manifest.builtAt,
              appVersion: status.manifest.appVersion,
              copIndexBase: status.manifest.copIndexBase,
              counts: status.manifest.counts,
              answerKeyHash: status.manifest.answerKeyHash,
            },
      integrity:
        status.integrity === null ? null : { ok: status.integrity.ok, rowCount: status.integrity.rowCount },
    },
    { status: status.ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
