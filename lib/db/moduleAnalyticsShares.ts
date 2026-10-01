import { createHash, randomBytes } from 'node:crypto';
import { sql } from './userClient';
import { withUserTransaction } from './transactionClient';
import { getOwnedModuleAnalytics, type ModuleAnalytics } from './facultyAnalytics';

export const analyticsTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export function hashAnalyticsToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export interface AnalyticsShareStatus { enabled: boolean; createdAt: string | null }

export async function getAnalyticsShareStatus(owner: string, moduleId: string): Promise<AnalyticsShareStatus | null> {
  const rows = await sql.query(`select s.created_at, s.revoked_at from faculty_modules m
    left join faculty_module_analytics_shares s on s.module_id = m.id
    where m.id = $1::uuid and m.owner_user_id = $2::uuid and m.deleted_at is null`, [moduleId, owner]) as
    { created_at: string | Date | null; revoked_at: string | Date | null }[];
  const row = rows[0];
  return row ? { enabled: row.created_at !== null && row.revoked_at === null,
    createdAt: row.created_at === null ? null : new Date(row.created_at).toISOString() } : null;
}

// Lock the parent even before a sharing row exists: create/replace/revoke serialize.
export async function changeAnalyticsShare(owner: string, moduleId: string, enable: boolean): Promise<
  { token: string | null; status: AnalyticsShareStatus } | null
> {
  return withUserTransaction(async (client) => {
    const owned = await client.query(`select id from faculty_modules where id = $1::uuid
      and owner_user_id = $2::uuid and deleted_at is null for update`, [moduleId, owner]);
    if (!owned.rows.length) return null;
    if (!enable) {
      await client.query(`update faculty_module_analytics_shares set revoked_at = clock_timestamp()
        where module_id = $1::uuid`, [moduleId]);
      return { token: null, status: { enabled: false, createdAt: null } };
    }
    const token = randomBytes(32).toString('base64url');
    const result = await client.query<{ created_at: Date | string }>(`insert into faculty_module_analytics_shares
      (module_id, token_hash, created_by_user_id) values ($1::uuid, $2, $3::uuid)
      on conflict (module_id) do update set token_hash = excluded.token_hash,
        created_by_user_id = excluded.created_by_user_id, created_at = clock_timestamp(), revoked_at = null
      returning created_at`, [moduleId, hashAnalyticsToken(token), owner]);
    return { token, status: { enabled: true, createdAt: new Date(result.rows[0]!.created_at).toISOString() } };
  });
}

async function resolveShare(token: string): Promise<{ module_id: string; owner_user_id: string } | null> {
  if (!analyticsTokenPattern.test(token)) return null;
  const rows = await sql.query(`select m.id module_id, m.owner_user_id
    from faculty_module_analytics_shares s join faculty_modules m on m.id = s.module_id
    where s.token_hash = $1 and s.revoked_at is null and m.deleted_at is null
      and s.created_by_user_id = m.owner_user_id
      and exists (select 1 from faculty_grants g join auth_identities ai
        on ai.user_id = g.user_id and ai.provider = 'google' and ai.verified_email = g.email
        where g.user_id = m.owner_user_id and g.status = 'active')`, [hashAnalyticsToken(token)]) as
    { module_id: string; owner_user_id: string }[];
  return rows[0] ?? null;
}

export async function getSharedModuleAnalytics(token: string, page = 1, search = ''): Promise<ModuleAnalytics | null> {
  const share = await resolveShare(token);
  if (!share) return null;
  const analytics = await getOwnedModuleAnalytics(share.owner_user_id, share.module_id, page, search);
  // Revalidate after aggregation, so revocations during a read are not served.
  if (!analytics || !await resolveShare(token)) return null;
  return { ...analytics, participants: { ...analytics.participants,
    items: analytics.participants.items.map((item, index) => ({ ...item,
      attemptId: `row-${index}`, guestParticipantId: null })) } };
}
