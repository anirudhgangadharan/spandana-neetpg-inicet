# Faculty modules — Milestone 1 foundation

**Status:** implemented locally for review. No production or shared database has been migrated, and no deployment has occurred.

## What is implemented

- Three live application roles: student, faculty, and super admin. Privileged requests re-read role state from Postgres; disabling a faculty grant takes effect on the next request rather than waiting for a JWT to expire.
- The super admin can add/enable, disable, and remove faculty email grants. A partial unique index and transactional slot assignment cap **active** grants at three. The super-admin view exposes only grant email, status, binding state, and module count. It has no route to faculty module content or results.
- Faculty list and point lookup require the faculty role and apply `owner_user_id` in SQL. Super admins and other professors cannot use these endpoints to read a module. The visible faculty page is deliberately only a listing placeholder until Milestone 2.
- Elevated access requires a Google identity with a provider-confirmed email. Password signup alone cannot claim a faculty email. Existing password and Google accounts with the same email are not silently merged. A stable Google provider subject identifies the super admin through `SUPER_ADMIN_GOOGLE_SUB`.
- Editorial-note access is independent of these roles. The legacy `ADMIN_EMAILS` fallback works only with a verified Google sign-in; a password account at the same unverified email no longer receives note-edit permission. Explicit `editorial_note_grants` can replace this fallback later.
- A forward-only schema adds verified identities, grants, owned modules, publication question snapshots, unique link tokens, opens, attempts, responses, and ownership/analytics indexes. The corpus SQLite database is unchanged.

## Safe migration procedure

The migration command is **dry-run by default** and never reads `DATABASE_URL` or `.env.local`. For a local check:

```powershell
.\node_modules\.bin\tsx.cmd scripts/db/migrate-modules.ts
```

This prints the migration filename and SHA-256 without connecting to a database. The SQL is also executed by `tests/integration/faculty-foundation.test.ts` against a new, disposable in-memory PGlite PostgreSQL instance; this tests syntax and constraints but does **not** prove Neon branch compatibility or production data upgrade safety.

Only after creating a **disposable Postgres database or Neon branch**, inspecting its URL and confirming it contains the existing `users` table, use the following with that disposable database's actual host and database name:

```powershell
$env:MIGRATION_DATABASE_URL = 'postgresql://DISPOSABLE_BRANCH_CONNECTION_STRING'
$env:MIGRATION_TARGET = 'disposable-host.example/database_name'
.\node_modules\.bin\tsx.cmd scripts/db/migrate-modules.ts --apply
```

The runner requires both variables, checks the target string against the URL, takes a transaction-scoped advisory lock, applies migrations with a hash ledger, and rolls back on error. It will refuse a changed migration file after that migration has been recorded. Do not point this at production without separate authorization, backup/restore rehearsal, and deployment sequencing. Apply the migration **before** running application code that expects the new tables; otherwise Google login and role lookup will fail. No down migration is supplied: restore a database snapshot if rollback is required, and preserve student records once modules are in use.

After a verified Google sign-in on a migrated environment, an operator with database access can obtain the owner's provider subject from `auth_identities` and configure `SUPER_ADMIN_GOOGLE_SUB` as a server-only secret. Do not use email alone or publish the subject in client configuration. Existing Google-only accounts are linked to the subject on their next successful login. A preexisting password account with the same address requires a deliberate account-linking procedure; it is not elevated automatically.

## Privacy and remaining work

Faculty content isolation is enforced at the application API/query layer, not against a person with database or hosting credentials. The module tables exist but the builder, student attempt flow, analytics, account-deletion flow, and privacy/retention policy are **not yet implemented**. Published question immutability and global no-repeat behavior must be enforced in Milestone 2. This is not a production-ready feature.

The current ordinary practice APIs continue to expose answer-bearing questions by the owner's decision. Faculty modules can avoid leaking answer keys through their own endpoints but cannot guarantee closed-book or proctored secrecy while practice and the public corpus remain available.

## Verification boundary

The integration test uses PostgreSQL-compatible PGlite, with isolated owner lookups, grant-slot limits, verified-identity binding, password/Google collision, and foreign-key deletion behavior. The route tests cover direct forbidden module lookups. A disposable **Neon** migration, real OAuth callback, reverse-proxy origin behavior, and multi-process load/race tests remain to be rehearsed before release.

Local checks at this milestone: `tsc --noEmit`, `eslint .`, all seven invariant checks, all 249 Vitest tests, `git diff --check`, the migration dry run, and a production `next build` passed. The prior invariant failure in the existing practice summary (`Math.random()` outside the seeded session PRNG) was repaired while checking the tree. The corpus suite still reports one known, flagged answer/explanation disagreement in its 1,000-record oracle sample; that content issue is not a faculty authorization failure. PGlite is a dev-only dependency solely for reproducible disposable schema/query testing.

## Files changed in Milestone 1

- Identity and permissions: `auth.ts`, `types/next-auth.d.ts`, `lib/auth/roles.ts`, `lib/db/userQueries.ts`, `lib/db/transactionClient.ts`, `lib/db/facultyGrants.ts`, `lib/db/facultyModules.ts`, `lib/api/sameOrigin.ts`; removed obsolete `lib/auth/admin.ts`.
- Role APIs and pages: `app/api/me/role/route.ts`, `app/api/super-admin/faculty/route.ts`, `app/api/super-admin/faculty/[id]/route.ts`, `app/api/faculty/modules/route.ts`, `app/api/faculty/modules/[id]/route.ts`, `app/super-admin/faculty/page.tsx`, `app/super-admin/faculty/FacultyManager.tsx`, `app/super-admin/faculty/faculty.module.css`, `app/faculty/modules/page.tsx`, `app/faculty/modules/modules.module.css`, `components/auth/AccountMenu.tsx`, `middleware.ts`.
- Editorial-note authorization: `app/admin/notes/page.tsx`, `app/api/admin/notes/route.ts`, `app/api/admin/notes/[id]/route.ts`, `lib/db/userSchema.sql` (comment only).
- Migration and verification: `scripts/db/migrate-modules.ts`, `scripts/db/migrations/001_faculty_foundation.sql`, `tests/unit/faculty-roles.test.ts`, `tests/unit/faculty-isolation.test.ts`, `tests/integration/faculty-foundation.test.ts`, `package.json`, `pnpm-lock.yaml`, this report.
- Existing reproducibility fix discovered by the invariant checker: `features/session/PracticeShell.tsx`.

`PROJECT_CONTEXT_REPORT.md` was already present and was not changed in this milestone. `FACULTY_MODULES_MILESTONE_0.md` is the prior design artifact, unchanged here.
