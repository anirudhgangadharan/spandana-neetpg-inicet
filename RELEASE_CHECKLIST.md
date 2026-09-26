# Release checklist

Milestone 5 provides local evidence, not authorization to release. Check every item against the intended deployment.

## Verified in this worktree

- [x] TypeScript typecheck and full ESLint pass (26 September 2026).
- [x] All seven repository invariants pass over 185 source files.
- [x] All 309 unit/integration tests pass in the final coverage run.
- [x] Critical-logic coverage gates pass: 96.00% statements/lines, 90.24% branches, 98.56% functions; trusted core/parser gates remain 100%.
- [x] Optimized Next.js production build passes.
- [x] All 18 Playwright tests pass, including 16 axe WCAG A/AA analyses and six 360px page checks.
- [x] Disposable PGlite rehearsal applies four ordered migrations and verifies ledger replay/schema evidence.
- [x] PGlite logical concurrency preserves 50 overlapping student start/save/submit sequences and duplicate-start/attempt-limit races.
- [x] `git diff --check` passes after the Milestone 5 report is written.
- [ ] Production container build/smoke test: blocked because Docker Desktop's Linux engine pipe is unavailable on this machine.
- [ ] Hosted-Postgres concurrency/capacity validation: not run; no 200-student claim is made.

## Required before a production deployment

- [ ] Review and commit the complete diff; protect the release branch and require CI.
- [x] Record the upstream dataset licences and required attribution: MedMCQA Apache-2.0; MedQA repository MIT. Retain both notices in the distributed app/image.
- [ ] Create an isolated staging Neon branch and rehearse backup, migrations, rollback/restore, account deletion, OAuth, expiry sweep, and a full exam.
- [ ] Configure every required environment variable from `.env.example`; use independent secrets of at least 32 characters.
- [ ] Register exact Google OAuth redirect URIs and confirm faculty accounts sign in only through verified Google identities.
- [ ] Supply the operator identity, monitored privacy contact, final privacy terms, provider retention periods, and public HTTPS `/privacy` and `/delete-account` URLs.
- [ ] Configure HTTPS, a fixed `AUTH_URL`, log access controls/retention, alerts for health failures/5xx/latency/database saturation, and an every-minute authorized expiry sweep.
- [ ] Replace the in-memory rate limiter before horizontal scaling, or deploy a single instance and monitor it explicitly.
- [ ] Run a hosted-Postgres load test at the intended concurrency and duration. The local PGlite rehearsal is not evidence for 200 simultaneous students.
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
