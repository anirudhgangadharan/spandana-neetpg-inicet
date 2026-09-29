# Release checklist

The guest-entry and correction implementation has local verification. On 30 September 2026, the user directed a production deployment without staging. Migration 005 was applied to the verified Neon `production` branch, and commit `cbcba34` deployed successfully on Render.

## Production rollout evidence

- [x] Production migration ledger contains 005; all four new tables exist.
- [x] Render reports commit `cbcba34` live. `/api/health` returns 200 with migration 005, corpus integrity, database, and configuration ready.
- [x] An existing open shared test link renders the guest identity fields without Google sign-in. Public metadata returns 200; empty identity returns 400; starting without a guest session returns 401. This smoke test left participant counts unchanged.
- [ ] A production guest submission and faculty correction were not performed against a real module, to avoid altering faculty results and the global question pool. Local browser and disposable-Postgres tests cover these flows.

## Verified in this worktree

- [x] TypeScript typecheck, full ESLint, and all seven repository invariants pass (29 September 2026).
- [x] All 313 unit/integration tests pass, including guest registration, session revocation, owner isolation, final-sheet idempotency, correction versioning, and rollback.
- [x] Optimized Next.js production build passes.
- [x] All 20 Playwright tests pass, including guest form, final-only submission, correction editing, axe WCAG A/AA analysis, and 360px checks. Re-run after any subsequent UI change.
- [x] Disposable PGlite rehearsal applies five ordered migrations and verifies ledger replay/schema evidence.
- [x] PGlite logical concurrency preserves 50 overlapping start/final-sheet submissions and duplicate-start/attempt-limit races.
- [x] `git diff --check` passes on the current diff. Re-run before committing.
- [ ] Production container build/smoke test: blocked because Docker Desktop's Linux engine pipe is unavailable on this machine.
- [ ] Hosted-Postgres concurrency/capacity validation: not run; no 200-student claim is made.

## Required before a production deployment

The staging and backup rehearsal items below were skipped under the user's direct-production instruction. They remain recorded as release risks, not completed checks.

- [ ] Review and commit the complete diff; protect the release branch and require CI.
- [x] Record the upstream dataset licences and required attribution: MedMCQA Apache-2.0; MedQA repository MIT. Retain both notices in the distributed app/image.
- [ ] Create an isolated staging Neon branch and rehearse backup, migrations, rollback/restore, account deletion, OAuth, expiry sweep, and a full exam.
- [ ] Apply migration 005 to staging before deploying the new application build. Rehearse the exact production migration plan and a backup/restore; do not point migration tooling at the runtime connection string.
- [ ] Configure every required environment variable from `.env.example`; use independent secrets of at least 32 characters.
- [ ] Register exact Google OAuth redirect URIs and confirm faculty accounts sign in only through verified Google identities.
- [ ] Supply the operator identity, monitored privacy contact, final privacy terms, provider retention periods, a calendar-based guest/correction retention schedule, and public HTTPS `/privacy` and `/delete-account` URLs.
- [ ] Configure HTTPS, a fixed `AUTH_URL`, log access controls/retention, alerts for health failures/5xx/latency/database saturation, and an every-minute authorized expiry sweep.
- [ ] Replace the in-memory rate limiter before horizontal scaling, or deploy a single instance and monitor it explicitly.
- [ ] Run a hosted Render/Neon load test at the intended class size and question count, including synchronized deadline submissions; measure latency, errors, connection saturation, and record integrity. Set class-size limits from those results. The local PGlite rehearsal is not hosted capacity evidence.
- [ ] Build and smoke-test the exact production image with the exact corpus artifact and production-equivalent configuration.
- [ ] Confirm `/api/health` returns 200 only after the corpus, database, migration ledger, and required configuration are ready.
- [ ] Conduct manual keyboard/screen-reader and real-device/mobile checks; automated axe scans are necessary but not sufficient.
- [ ] Complete incident response, support, data-subject request, backup/restore, secret rotation, and faculty-offboarding procedures.

## Android / Google Play (not implemented)

- [ ] Choose and implement a supported Android delivery architecture; do not submit the web repository as if it were an Android app.
- [ ] Produce an Android App Bundle, configure Play App Signing, package/application ID, icons, adaptive UI, deep links, secure auth handoff, network security, and Android lifecycle/offline behavior.
- [ ] Target Android 16 / API 36 for a new submission or update after 31 August 2026.
- [ ] Complete current developer verification and app registration requirements for the release regions.
- [ ] Provide an in-app deletion path and a prominent external deletion URL in Play Console.
- [ ] Publish the final privacy policy and complete Data safety accurately.
- [ ] Complete the Health apps declaration and include the required non-medical-device/medical-advice disclaimer in the store listing where applicable.
- [ ] Complete content rating, store listing, screenshots, accessibility/device testing, pre-launch report, internal testing, and closed testing. If the personal developer account was created after 13 November 2023, satisfy the current 12-testers-for-14-continuous-days production-access rule.
