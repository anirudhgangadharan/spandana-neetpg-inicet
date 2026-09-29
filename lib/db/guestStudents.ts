import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { sql } from './userClient';
import { withUserTransaction } from './transactionClient';
import { StudentAttemptError } from './moduleAttempts';
import { StudentModuleInputError } from '@/lib/student/moduleInput';

const COOKIE_PREFIX = 'faculty_guest_';
const SESSION_DAYS = 30;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function clean(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new StudentModuleInputError(`${label} is required.`);
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < 1 || result.length > max) throw new StudentModuleInputError(`${label} must be 1–${max} characters.`);
  return result;
}

export function parseGuestIdentity(body: unknown): { name: string; registrationNumber: string; rollNumber: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StudentModuleInputError('Enter your student details.');
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !['name', 'registrationNumber', 'rollNumber'].includes(key))) {
    throw new StudentModuleInputError('Unexpected student detail.');
  }
  return {
    name: clean(fields['name'], 120, 'Name'),
    registrationNumber: clean(fields['registrationNumber'], 80, 'Registration number'),
    rollNumber: clean(fields['rollNumber'], 80, 'Roll number'),
  };
}

export async function enrollGuest(moduleToken: string, details: ReturnType<typeof parseGuestIdentity>): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  try {
    await withUserTransaction(async (client) => {
      const moduleRow = await client.query<{ id: string }>(
        `select id from faculty_modules where share_token = $1::uuid and status = 'published'
         and deleted_at is null and opens_at <= clock_timestamp() and closes_at > clock_timestamp()`, [moduleToken]
      );
      const moduleId = moduleRow.rows[0]?.id;
      if (!moduleId) throw new StudentAttemptError('This test is not open.', 404);
      const userId = randomUUID();
      await client.query('insert into users (id, email, name) values ($1, $2, $3)',
        [userId, `guest-${userId}@invalid.local`, details.name]);
      const participant = await client.query<{ id: string }>(
        `insert into guest_module_participants
          (module_id, student_user_id, name, registration_number, roll_number)
         values ($1, $2, $3, $4, $5) returning id`,
        [moduleId, userId, details.name, details.registrationNumber, details.rollNumber]
      );
      await client.query(
        `insert into guest_module_sessions (participant_id, token_hash, expires_at)
         values ($1, $2, clock_timestamp() + interval '30 days')`,
        [participant.rows[0]!.id, hash(token)]
      );
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new StudentAttemptError('This registration and roll number are already registered for this test. Ask your faculty member for help.', 409);
    }
    throw error;
  }
  return token;
}

export async function setGuestCookie(token: string, moduleToken: string): Promise<void> {
  (await cookies()).set(`${COOKIE_PREFIX}${moduleToken}`, token, {
    httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'lax',
    path: '/', maxAge: SESSION_DAYS * 86400,
  });
}

export async function getGuestStudentId(moduleToken?: string, attemptId?: string): Promise<string | null> {
  const jar = await cookies();
  const tokens = moduleToken ? [jar.get(`${COOKIE_PREFIX}${moduleToken}`)?.value].filter((value): value is string => !!value)
    : jar.getAll().filter((cookie) => cookie.name.startsWith(COOKIE_PREFIX)).map((cookie) => cookie.value).slice(0, 50);
  if (tokens.length === 0) return null;
  const rows = await sql.query(
    `select gp.student_user_id from guest_module_sessions gs
     join guest_module_participants gp on gp.id = gs.participant_id
     join faculty_modules fm on fm.id = gp.module_id
     where gs.token_hash = any($1::text[]) and gs.revoked_at is null and gs.expires_at > clock_timestamp()
       and ($2::uuid is null or fm.share_token = $2::uuid)
       and ($3::uuid is null or exists (
         select 1 from faculty_module_attempts a where a.id = $3::uuid
           and a.module_id = gp.module_id and a.student_user_id = gp.student_user_id))`,
    [tokens.map(hash), moduleToken ?? null, attemptId ?? null]
  ) as { student_user_id: string }[];
  return rows[0]?.student_user_id ?? null;
}

/** Faculty shares this one-time code with the student through their own channel. */
export async function issueGuestRecovery(ownerId: string, moduleId: string, participantId: string): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await withUserTransaction(async (client) => {
    const owned = await client.query(
      `select 1 from guest_module_participants gp join faculty_modules fm on fm.id = gp.module_id
       where gp.id = $1 and gp.module_id = $2 and fm.owner_user_id = $3 and fm.deleted_at is null`,
      [participantId, moduleId, ownerId]
    );
    if (!owned.rows[0]) throw new StudentAttemptError('Participant not found.', 404);
    await client.query('delete from guest_module_recovery where participant_id = $1', [participantId]);
    await client.query(
      `insert into guest_module_recovery (participant_id, token_hash, expires_at)
       values ($1, $2, clock_timestamp() + interval '15 minutes')`, [participantId, hash(code)]
    );
  });
  return code;
}

export async function redeemGuestRecovery(moduleToken: string, code: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(code)) throw new StudentModuleInputError('Invalid recovery code.');
  const session = randomBytes(32).toString('base64url');
  await withUserTransaction(async (client) => {
    const recovery = await client.query<{ id: string; participant_id: string }>(
      `select gr.id, gr.participant_id from guest_module_recovery gr
       join guest_module_participants gp on gp.id = gr.participant_id
       join faculty_modules fm on fm.id = gp.module_id
       where gr.token_hash = $1 and fm.share_token = $2::uuid and gr.used_at is null
         and gr.expires_at > clock_timestamp() for update of gr`, [hash(code), moduleToken]
    );
    const row = recovery.rows[0];
    if (!row) throw new StudentAttemptError('Recovery code is invalid or expired.', 409);
    await client.query('update guest_module_recovery set used_at = clock_timestamp() where id = $1', [row.id]);
    await client.query('update guest_module_sessions set revoked_at = clock_timestamp() where participant_id = $1 and revoked_at is null',
      [row.participant_id]);
    await client.query(
      `insert into guest_module_sessions (participant_id, token_hash, expires_at)
       values ($1, $2, clock_timestamp() + interval '30 days')`, [row.participant_id, hash(session)]
    );
  });
  return session;
}

/** Erases one module-scoped guest identity and all dependent attempt data. */
export async function deleteGuestParticipant(ownerId: string, moduleId: string, participantId: string): Promise<void> {
  await withUserTransaction(async (client) => {
    const row = await client.query<{ student_user_id: string }>(
      `select gp.student_user_id from guest_module_participants gp
       join faculty_modules fm on fm.id = gp.module_id
       where gp.id = $1 and gp.module_id = $2 and fm.owner_user_id = $3
         and fm.deleted_at is null for update of gp`, [participantId, moduleId, ownerId]
    );
    if (!row.rows[0]) throw new StudentAttemptError('Participant not found.', 404);
    await client.query('delete from users where id = $1', [row.rows[0].student_user_id]);
  });
}
