/**
 * Admin gate (authored explanations plan). Deliberately env-var-based, not a
 * database role: there is no admin UI for granting admin-ness, so the list
 * lives where every other deployment secret does — ADMIN_EMAILS in the
 * Render dashboard (render.yaml, sync: false) and .env.local locally.
 */

function adminEmails(): readonly string[] {
  const raw = process.env['ADMIN_EMAILS'];
  if (raw === undefined || raw.length === 0) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (email === null || email === undefined || email.length === 0) return false;
  return adminEmails().includes(email.toLowerCase());
}
