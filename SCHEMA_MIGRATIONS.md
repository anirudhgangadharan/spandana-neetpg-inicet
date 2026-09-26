# Database schema and migrations

The immutable question corpus remains SQLite. All accounts, permissions, modules, snapshots, attempts, answers, and analytics inputs are stored in Postgres.

## Ordering

1. `lib/db/userSchema.sql` creates the base account/practice schema.
2. `scripts/db/migrations/001_faculty_foundation.sql` creates verified Google identities, faculty/editorial grants, owned modules, immutable snapshots, opens, attempts, and responses.
3. `002_faculty_builder.sql` adds optimistic draft revisions, soft faculty-facing deletion, and database triggers that freeze published configurations/questions.
4. `003_student_attempts.sql` adds the due-attempt index and a trigger preventing writes after finalization/deadline.
5. `004_faculty_analytics.sql` adds bounded server-observed question timing and analytics indexes.

Applied versioned migrations are recorded by filename and SHA-256 in `faculty_schema_migrations`. A changed already-applied file is rejected. Ordering is lexical and new files must use the next contiguous three-digit prefix.

## Safe commands

All commands are dry-run by default and never read `DATABASE_URL` for writes:

```powershell
pnpm data:users:migrate
pnpm data:modules:migrate
pnpm data:modules:rehearse
```

The rehearsal applies the complete sequence to an in-memory disposable PGlite database, verifies the ledger replay and analytics schema, then destroys it.

For an explicitly selected disposable Neon branch, set `MIGRATION_DATABASE_URL` and set `MIGRATION_TARGET` to the exact `host/database` printed by the dry-run guard, then run the user schema before the module migrations:

```powershell
pnpm data:users:migrate --apply
pnpm data:modules:migrate --apply
```

Do not point either command at production until a reviewed backup/restore test, maintenance plan, and explicit authorization exist. Take a schema/data backup, apply in staging, run `/api/health`, authorization tests, and an exam smoke test, then schedule production separately.

## Account deletion relationships

Deleting a student cascades their practice and assessment participation. `faculty_modules.owner_user_id` is intentionally restrictive, so the account-deletion transaction deletes owned modules first; module cascades then remove participant data. This makes the cross-user privacy effect explicit and atomic.
