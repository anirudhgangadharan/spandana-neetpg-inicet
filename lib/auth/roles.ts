import { auth } from '@/auth';
import { sql } from '@/lib/db/userClient';

export type AppRole = 'student' | 'faculty' | 'super_admin';

export interface Actor {
  readonly userId: string;
  readonly email: string;
  readonly role: AppRole;
  readonly canEditNotes: boolean;
}

interface IdentityRow {
  readonly subject: string | null;
  readonly verified_email: string | null;
  readonly faculty_active: boolean;
  readonly notes_granted: boolean;
}

/** Keep legacy note editors on verified Google sign-in until explicit grants
 * are assigned. An unverified password account can never claim this fallback. */
function legacyNotesEmail(email: string): boolean {
  return (process.env['ADMIN_EMAILS'] ?? '')
    .split(',')
    .some((candidate) => candidate.trim().toLowerCase() === email);
}

export function roleFromIdentity(
  provider: 'google' | 'credentials' | undefined,
  row: IdentityRow,
  superAdminSubject: string | undefined
): AppRole {
  if (provider !== 'google' || row.subject === null || row.verified_email === null) return 'student';
  if (superAdminSubject && row.subject === superAdminSubject) return 'super_admin';
  return row.faculty_active ? 'faculty' : 'student';
}

/** No JWT role cache: grant changes and disablement apply on the next request. */
export async function getCurrentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const rows = (await sql.query(
    `select u.email,
       ai.provider_subject as subject,
       ai.verified_email,
       exists (
         select 1 from faculty_grants fg
         where fg.user_id = u.id and fg.status = 'active'
           and fg.email = ai.verified_email
       ) as faculty_active,
       exists (
         select 1 from editorial_note_grants ng where ng.user_id = u.id
       ) as notes_granted
     from users u
     left join auth_identities ai on ai.user_id = u.id and ai.provider = 'google'
     where u.id = $1`,
    [session.user.id]
  )) as (IdentityRow & { email: string })[];
  const row = rows[0];
  if (!row) return null;

  const provider = session.user.loginProvider;
  const role = roleFromIdentity(provider, row, process.env['SUPER_ADMIN_GOOGLE_SUB']);
  const verifiedGoogle = provider === 'google' && row.subject !== null && row.verified_email !== null;
  return {
    userId: session.user.id,
    email: row.email,
    role,
    canEditNotes: verifiedGoogle &&
      (row.notes_granted || legacyNotesEmail(row.verified_email ?? '')),
  };
}

export async function requireRole(role: AppRole): Promise<Actor | null> {
  const actor = await getCurrentActor();
  return actor?.role === role ? actor : null;
}
