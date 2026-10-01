# Hosting and operations

The guest-entry and correction release is live on the existing single-instance Render service. On 30 September 2026, migration 005 was applied transactionally to the verified Neon `production` branch, then commit `cbcba34` deployed successfully. On 1 October, commit `dfc4a4c` added an active-exam keepalive. Staging was skipped at the user's direction. The live health endpoint confirmed the required migration, corpus integrity, database, and configuration; a production guest completed and submitted a test.

## Runtime architecture

- Next.js 15 runs in a non-root standalone Node 22 container.
- The 199,514-question corpus is an immutable, checksummed SQLite artifact baked into the image and opened read-only.
- Accounts, permissions, guest participants and sessions, correction versions, modules, frozen question snapshots, attempts, final responses, and analytics inputs live in Neon/Postgres.
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

`/api/health` returns 200 only when corpus integrity passes, the database is reachable, the `006_module_analytics_shares.sql` ledger entry exists, and all required configuration above is present. Production errors are deliberately generic. It is readiness, not a complete synthetic exam check.

Migration-only `MIGRATION_DATABASE_URL` and exact `MIGRATION_TARGET=host/database` are documented in `SCHEMA_MIGRATIONS.md`. They must not be configured on the running service.

## Pre-deployment sequence

1. Complete `RELEASE_CHECKLIST.md`, licensing and privacy decisions.
2. Build the corpus reproducibly and retain `manifest.json` plus artifact hashes.
3. Create an isolated staging database/Neon branch. Back it up, apply the base user schema, then migrations 001–006 using the guarded commands.
4. Configure a staging Google OAuth client/redirect URI and every runtime secret. Confirm `/api/health` is 200.
5. Run a smoke test as an incognito guest, signed-in student, faculty A, faculty B, and super admin. Verify guest registration and cookie recovery, final-only submission, expiry, attempt limits, faculty isolation, correction versioning/rollback, frozen publishing, analytics isolation, and deletion.
6. Run a hosted-Postgres load test representing the intended class, including simultaneous final submissions at expiry. The PGlite logical-concurrency test does not validate network latency, pool behavior, Neon limits, or 200 simultaneous students. Set class-size and question-count limits from the measured results.
7. Build and smoke the exact `Dockerfile.fetch` image with the intended corpus URL. Review the non-root user, read-only corpus, health check, image size, and dependency scan.
8. Configure an authorized call to `POST /api/internal/module-attempts/expire` every minute. Lazy expiry on student access remains the correctness backstop.
9. Configure alerts for readiness failures, 5xx rate, response latency, container restarts, expiry-sweep failures, database connection/storage saturation, and backup/restore failures. Logs must not include emails, answers, tokens, SQL bind values, or connection strings.
10. Obtain explicit authorization before applying production migrations or deploying.

## Security and scale boundaries

Browser mutations require an authenticated role or a module-scoped opaque guest session as appropriate, plus same-origin requests; bodies are bounded. The internal expiry endpoint uses constant-time bearer comparison and returns 404 on failure. Security headers include CSP, HSTS, clickjacking, MIME, referrer, opener, and permissions controls.

The fixed-window rate limiter is in application memory. It is acceptable only as coarse abuse resistance on one process; multiple instances need a shared store and a trusted-proxy IP policy. Guest exam requests are bucketed by cookie with an aggregate IP cap so one campus NAT does not exhaust the class. Credential sign-in, signup, faculty access, account deletion, search, faculty-builder, and exam paths receive separate buckets.

No capacity claim for 200 concurrent students is made. Establish it on a staging deployment using realistic 1–200-question modules, registration/start bursts, synchronized final submission, expiry races, and analytics traffic while observing p95/p99 latency, error/timeout rate, pool/database saturation, and record-count correctness. Final-only answers reduce routine writes but concentrate writes at submission.

## Analytics sharing deployment gate

Apply migration `006_module_analytics_shares.sql` using the existing migration ledger before deploying sharing routes. Existing modules remain unshared. Never change previously applied migration files. Reverting application code is safe; retain the sharing table during rollback and do not reopen revoked links.

Shared pages and APIs use a combined 60-request/minute per-IP bucket on a single application process. Configure the trusted ingress to overwrite client IP forwarding headers; multiple instances require a shared or ingress-enforced limiter. Confirm the final response has `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, nofollow`, including error responses. Disable CDN caching and automatic URL tracing for these routes.

Next.js incoming request logging is disabled. At the hosting provider, CDN, load balancer, and error-reporting layer, suppress or redact request paths matching `/shared/module-analytics/*` and `/api/shared/module-analytics/*`, and suppress `q` query values on faculty/shared analytics paths. Record route templates, status, latency, and request IDs instead of URLs, raw tokens, identities, or searches. Verify with a synthetic canary link/search and inspect every log sink before launch. These external controls cannot be configured or verified from this repository alone. Alert on elevated 503/429 rates using sanitized ingress metrics.

Run a hosted valid-link smoke test from an incognito browser, student, other faculty, and super administrator. Verify parity with the owner's dashboard, token replacement, revocation, grant disablement, search/pagination, and module deletion. Establish operator authorization for identifiable result sharing and complete provider retention/privacy details before enabling the feature for real cohorts. See `ANALYTICS_SHARING.md` for reproducible local evidence and limits.

On Render Free, an idle web service sleeps after 15 minutes and can take about a minute to restart. An active exam sends a small, staggered read-only `/api/ping` request every four minutes to keep the service awake; answer choices still reach the server only on final submission. Browser suspension, network loss, Render restarts, or exhausted free-plan limits can still prevent an on-time receipt within the 10-second grace. Use an always-on plan for consequential exams and verify synchronized deadline submissions on the intended capacity before setting class limits.

## Corpus and container paths

`Dockerfile` requires `pnpm data:build` first because `data/build/` is git-ignored. `Dockerfile.fetch` requires an HTTPS corpus base URL containing `corpus.sqlite`, `manifest.json`, and `facets.json`; it rejects a non-SQLite or implausibly small download. Runtime checksum verification still decides whether questions may be served.

The public `/privacy` and `/delete-account` pages must have stable HTTPS URLs. Provider backup/log retention and calendar-based guest/correction retention must be inserted into the final policy before launch. Android/Google Play work is separate and listed in `GOOGLE_PLAY_RELEASE.md`.
