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
import { sql } from '@/lib/db/userClient';

const isProduction = process.env.NODE_ENV === 'production';

function configurationReady(): boolean {
  const required = ['DATABASE_URL', 'AUTH_SECRET', 'AUTH_URL', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET',
    'SUPER_ADMIN_GOOGLE_SUB', 'ATTEMPT_SWEEP_SECRET', 'PRIVACY_OPERATOR_NAME', 'PRIVACY_CONTACT_EMAIL'] as const;
  return required.every((key) => {
    const value = process.env[key];
    if (!value) return false;
    return (key === 'AUTH_SECRET' || key === 'ATTEMPT_SWEEP_SECRET') ? value.length >= 32 : true;
  });
}

async function databaseReady(): Promise<boolean> {
  if (!process.env['DATABASE_URL']) return false;
  try {
    const rows = await sql.query(`select
      to_regclass('public.users') is not null users_present,
      to_regclass('public.faculty_schema_migrations') is not null migrations_present`) as {
        users_present: boolean; migrations_present: boolean;
      }[];
    if (!rows[0]?.users_present || !rows[0].migrations_present) return false;
    const migration = await sql.query(
      "select 1 from faculty_schema_migrations where name = '006_module_analytics_shares.sql' limit 1"
    ) as unknown[];
    return migration.length === 1;
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse> {
  const status = corpusStatus();
  const database = await databaseReady();
  const configuration = configurationReady();
  const ready = status.ready && database && configuration;

  return NextResponse.json(
    {
      ready,
      reason: ready ? null : isProduction ? 'service unavailable' :
        !status.ready ? status.reason : !database ? 'user database or migrations unavailable' : 'required configuration unavailable',
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
      database: { ready: database, requiredMigration: '006_module_analytics_shares.sql' },
      configuration: { ready: configuration },
    },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
