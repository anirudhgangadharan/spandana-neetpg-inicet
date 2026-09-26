# Hosting and operations

No deployment was performed during Milestone 5. This document describes the intended single-instance Render deployment and the controls that must be completed before it is authorized.

## Runtime architecture

- Next.js 15 runs in a non-root standalone Node 22 container.
- The 199,514-question corpus is an immutable, checksummed SQLite artifact baked into the image and opened read-only.
- Accounts, permissions, modules, frozen question snapshots, attempts, responses, and analytics inputs live in Neon/Postgres.
- Google OAuth is required for faculty eligibility; students may also use credential accounts. The sole super-admin identity is bound to a stable Google provider subject, not an email string.
- `render.yaml` uses `Dockerfile.fetch`, which downloads the three corpus artifacts during the image build. `Dockerfile` instead copies an already-built local corpus and is the deterministic local-image path.

## Required runtime configuration

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | Runtime Neon/Postgres connection; never reused by migration commands |
| `AUTH_SECRET` | Independent random value, at least 32 characters |
| `AUTH_URL` | Exact public HTTPS origin |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth web client |
| `SUPER_ADMIN_GOOGLE_SUB` | Stable Google provider subject for the super admin |
| `ATTEMPT_SWEEP_SECRET` | Independent random bearer value, at least 32 characters |
| `PRIVACY_OPERATOR_NAME` | Public legal/operator identity shown in the privacy notice |
| `PRIVACY_CONTACT_EMAIL` | Monitored public privacy address |
| `ADMIN_EMAILS` | Optional legacy verified-Google editorial-note access only |
| `CORPUS_DIR` | Optional override for local corpus artifact directory |

`/api/health` returns 200 only when corpus integrity passes, the database is reachable, the `004_faculty_analytics.sql` ledger entry exists, and all required configuration above is present. Production errors are deliberately generic. It is readiness, not a complete synthetic exam check.

Migration-only `MIGRATION_DATABASE_URL` and exact `MIGRATION_TARGET=host/database` are documented in `SCHEMA_MIGRATIONS.md`. They must not be configured on the running service.

## Pre-deployment sequence

1. Complete `RELEASE_CHECKLIST.md`, licensing and privacy decisions.
2. Build the corpus reproducibly and retain `manifest.json` plus artifact hashes.
3. Create an isolated staging database/Neon branch. Back it up, apply the base user schema, then migrations 001–004 using the guarded commands.
4. Configure a staging Google OAuth client/redirect URI and every runtime secret. Confirm `/api/health` is 200.
5. Run an authenticated smoke test as student, faculty A, faculty B, and super admin. Verify faculty isolation, frozen publishing, autosave/resume, expiry, attempt limits, analytics isolation, and deletion.
6. Run a hosted-Postgres load test representing the intended class. The PGlite logical-concurrency test does not validate network latency, pool behavior, Neon limits, or 200 simultaneous students.
7. Build and smoke the exact `Dockerfile.fetch` image with the intended corpus URL. Review the non-root user, read-only corpus, health check, image size, and dependency scan.
8. Configure an authorized call to `POST /api/internal/module-attempts/expire` every minute. Lazy expiry on student access remains the correctness backstop.
9. Configure alerts for readiness failures, 5xx rate, response latency, container restarts, expiry-sweep failures, database connection/storage saturation, and backup/restore failures. Logs must not include emails, answers, tokens, SQL bind values, or connection strings.
10. Obtain explicit authorization before applying production migrations or deploying.

## Security and scale boundaries

Browser mutations require an authenticated role as appropriate and same-origin requests; bodies are bounded. The internal expiry endpoint uses constant-time bearer comparison and returns 404 on failure. Security headers include CSP, HSTS, clickjacking, MIME, referrer, opener, and permissions controls.

The fixed-window rate limiter is in application memory. It is acceptable only as coarse abuse resistance on one process; multiple instances need a shared store and a trusted-proxy IP policy. Authenticated exam buckets are per user so one campus NAT does not exhaust the class. Credential sign-in, signup, faculty access, account deletion, search, faculty-builder, and student-exam paths receive tighter buckets.

No capacity claim for 200 concurrent students is made. Establish it on a staging deployment using realistic 1–200-question modules, autosave cadence, expiry/submission races, and analytics traffic while observing p95/p99 latency, error/timeout rate, pool/database saturation, and record-count correctness.

## Corpus and container paths

`Dockerfile` requires `pnpm data:build` first because `data/build/` is git-ignored. `Dockerfile.fetch` requires an HTTPS corpus base URL containing `corpus.sqlite`, `manifest.json`, and `facets.json`; it rejects a non-SQLite or implausibly small download. Runtime checksum verification still decides whether questions may be served.

The public `/privacy` and `/delete-account` pages must have stable HTTPS URLs. Provider backup/log retention must be inserted into the final policy before launch. Android/Google Play work is separate and listed in `GOOGLE_PLAY_RELEASE.md`.
