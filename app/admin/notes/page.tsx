/**
 * /admin/notes — write editorial notes for a question or a whole
 * subject/topic concept (authored explanations plan).
 *
 * Gated server-side, on top of middleware.ts's plain login gate: being
 * signed in is not enough here, the account must be in ADMIN_EMAILS
 * (lib/auth/admin.ts). A non-admin never sees the form even flash on
 * screen — the redirect happens before any client JS runs.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/auth/admin';
import { AdminNotesClient } from './AdminNotesClient';

export const dynamic = 'force-dynamic';

export default async function AdminNotesPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) redirect('/');

  return <AdminNotesClient />;
}
