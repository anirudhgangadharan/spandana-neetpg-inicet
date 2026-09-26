import { sql } from './userClient';
import { withUserTransaction } from './transactionClient';

export interface FacultyGrant {
  readonly id: string;
  readonly email: string;
  readonly status: 'active' | 'disabled' | 'removed';
  readonly moduleCount: number;
  readonly bound: boolean;
}

interface GrantRow {
  id: string;
  email: string;
  status: FacultyGrant['status'];
  module_count: number;
  bound: boolean;
}

export class FacultyLimitError extends Error {
  constructor() {
    super('Only three faculty accounts may be active.');
    this.name = 'FacultyLimitError';
  }
}

export async function listFacultyGrants(): Promise<FacultyGrant[]> {
  const rows = (await sql.query(
    `select fg.id, fg.email, fg.status, (fg.user_id is not null) as bound,
            count(fm.id)::int as module_count
     from faculty_grants fg
     left join faculty_modules fm on fm.owner_user_id = fg.user_id
     group by fg.id
     order by fg.created_at desc`
  )) as GrantRow[];
  return rows.map((row) => ({
    id: row.id, email: row.email, status: row.status,
    moduleCount: row.module_count, bound: row.bound,
  }));
}

/** Assigns one of three DB-enforced slots inside a transaction. */
export async function activateFaculty(email: string, grantorId: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Invalid email address.');
  await withUserTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(784650192)');
    const existing = await client.query<{ slot: number | null }>(
      'select slot from faculty_grants where email = $1 for update', [normalizedEmail]
    );
    let slot = existing.rows[0]?.slot;
    if (!slot) {
      const free = await client.query<{ slot: number }>(
        `select candidate.slot from generate_series(1, 3) as candidate(slot)
         where not exists (
           select 1 from faculty_grants fg
           where fg.status = 'active' and fg.slot = candidate.slot
         )
         order by candidate.slot limit 1`
      );
      slot = free.rows[0]?.slot;
    }
    if (!slot) throw new FacultyLimitError();
    // Only a verified Google identity can bind. An email/password account
    // registered at the same address cannot claim the grant.
    const identity = await client.query<{ user_id: string }>(
      `select user_id from auth_identities
       where provider = 'google' and verified_email = $1`, [normalizedEmail]
    );
    await client.query(
      `insert into faculty_grants (email, user_id, status, slot, granted_by)
       values ($1, $2, 'active', $3, $4)
       on conflict (email) do update set
         user_id = excluded.user_id, status = 'active', slot = excluded.slot,
         granted_by = excluded.granted_by, updated_at = now()`,
      [normalizedEmail, identity.rows[0]?.user_id ?? null, slot, grantorId]
    );
  });
}

export async function changeFacultyStatus(id: string, status: 'disabled' | 'removed'): Promise<boolean> {
  const rows = (await sql.query(
    `update faculty_grants set status = $2, slot = null, updated_at = now()
     where id = $1 and status <> 'removed' returning id`, [id, status]
  )) as { id: string }[];
  return rows.length > 0;
}
