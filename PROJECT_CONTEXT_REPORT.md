# Project technical context report

**Repository:** `medmcqa-practice`
**Inspected:** 16 September 2026
**Commit examined:** `a09088a` on `main`
**Purpose:** durable context for the next development phase. This describes the code and data present in the workspace, distinguishes verified facts from project documentation, and identifies the work required before an Android/Google Play release can be claimed.

## Executive assessment

This is a mature **web application**, not an Android application. It is a Next.js 15 / React 19 TypeScript study tool for four-option AIIMS/NEET-PG and USMLE questions. Its strongest part is the research-data pipeline and answer-integrity model: it produces a read-only SQLite corpus, verifies the answer-key hash on startup, and deliberately exposes known source-data defects instead of silently modifying clinical text.

The current web build is healthy, but this repository is **not ready for Google Play** and cannot yet create an Android App Bundle (`.aab`). There is no Gradle project, Android manifest, signing setup, Capacitor/React Native wrapper, app icon set, Play asset pipeline, device test suite, privacy-policy surface, or account-deletion implementation. The product also needs a production-readiness pass: end-to-end tests are absent, the container is unverified locally, and some deployment documentation no longer reflects the code.

## Product currently implemented

### Student experience

- A required sign-in flow supporting Google OAuth and email/password accounts.
- Study and exam sessions, with deterministic seeded question planning.
- Sources: MedMCQA by default and opt-in MedQA-USMLE (US English four-option subset).
- Filter by source, subject, topic, flags, and session state; full-text search; question navigation; skip/back; bookmarks; notes; confidence tap; keyboard shortcuts.
- Session modes: all, new, incorrect, attempted, and marked.
- Local resilience through IndexedDB, with batched best-effort sync to the user database.
- User insights, streaks, session history, and an admin-only editorial-notes workflow.
- Accessibility foundations: semantic controls, a skip link, focus handling, reduced-motion accommodations, no zoom lockout, and palette tokens. Accessibility has not yet been independently audited.

### Explicitly out of scope or not present

- Native Android/iOS implementation or a web-to-native wrapper.
- Offline delivery of the full corpus. The browser receives question windows, not the database.
- Generative AI, clinical decision support, or inferred/corrected answer keys.
- Live product analytics/telemetry. The server does retain authenticated study history for insights.
- Difficulty estimation based on community performance.

## Repository map

| Area | Role |
|---|---|
| `app/` | Next.js App Router pages, API routes, layout, global CSS. |
| `features/session/` | Client state store and the primary practice-flow shell. |
| `components/` | Question, filter, navigator, account, note, disclaimer, and UI primitives. |
| `lib/core/` | Trusted answer index, answer key, verdict, question, and attempt parsing logic. |
| `lib/parser/` and `scripts/etl/` | Dataset import, sanitization, validation, deduplication, corpus generation. |
| `lib/db/` | Read-only corpus SQLite access plus Neon/Postgres user-data queries. |
| `lib/storage/` | IndexedDB persistence, debounced writes, sync, local preferences. |
| `data/raw/` | Local source datasets (ignored by Git). |
| `data/build/` | Generated SQLite corpus, manifest, facets, and validation report (ignored by Git). |
| `tests/` | Unit and integration tests for trusted core, ETL, corpus, and session planning. |
| `scripts/` | ETL, corpus forensics, database migration, analytics reports, CI invariants, deployment helpers. |
| `Dockerfile`, `Dockerfile.fetch`, `render.yaml`, `fly.toml` | Container deployment configurations. |

There are 139 tracked files. The checked-in working tree was clean before this report was created. The raw dataset and generated corpus are intentionally ignored, so a fresh clone alone is not runnable without obtaining/building the corpus.

## Technical architecture

### Web stack

- Next.js `15.5.22` during the verified build, React `19.1.1`, TypeScript `5.9`, pnpm `9.15.9`.
- Server-rendered application shell with client-side practice state in Zustand.
- CSS Modules plus global design tokens; no component-library dependency.
- `@tanstack/react-virtual` is used where virtualization is needed.
- Auth.js v5 beta supplies JWT sessions, Google OAuth, and credential login. Password verification uses `bcryptjs`.

### Data and correctness boundary

The corpus is built once from local source files and served read-only through `better-sqlite3`:

1. ETL identifies source schemas, strips all markup to plain text, validates four non-empty options, resolves answer encoding, tags anomalies, and writes `data/build/corpus.sqlite`.
2. The MedMCQA `cop` encoding is empirically certified as one-based; conversion to a 0–3 `AnswerIndex` occurs once in ETL.
3. At server startup, `lib/db/integrity.ts` verifies the corpus's row count and answer-key hash against `manifest.json`. A failure returns a maintenance state and refuses question serving.
4. UI code is kept away from raw `answerIndex`; correctness is calculated through the small `lib/core` boundary as index equality.
5. The corpus query layer provides SQLite/FTS5 filtering, ranked search, question windows, and seeded sessions. A maximum window of 200 avoids sending the whole corpus to the browser.

This is a sound design for reproducibility and avoids unsafe runtime answer generation. `DECISIONS.md` is the canonical reasoning record for data-quality decisions; it is unusually detailed and should remain synchronized with future changes.

### Mutable user data

User data is deliberately separated from the read-only corpus:

- **Corpus database:** local SQLite, read-only, integrity checked, approximately 288.5 MB on disk in this workspace.
- **User database:** Neon Postgres, accessed through `@neondatabase/serverless`.
- Stored server-side user data includes email/name/profile image, password hash where credentials are used, bookmarks, attempt events, selected answer index, verdict, timestamps, duration, confidence, session configuration/history, streak state, and admin-created note content.
- Browser-side IndexedDB is the immediate UI source of truth. Writes are batched and mirrored to `/api/sync`; failures leave the app in usable local-only mode.

The schema is in `lib/db/userSchema.sql`; migrations are run through `scripts/db/migrate-users.ts`. Environment configuration is local in `.env.local` and is ignored by Git. Its values were not inspected or included in this report.

### API surface

The app exposes endpoints for corpus health, facets, questions, counts, search, session planning, notes, user sync, sessions, stats, insights, signup, Auth.js, and admin notes. Most mutable user endpoints check `auth()` server-side; admin-note routes additionally check a configured admin email allowlist. Middleware redirects pages without a session to `/login` and applies an in-memory per-IP rate limit to `/api/*` (240 requests/minute generally, 60/minute for search).

Security controls include a CSP, HSTS, no-sniff, frame denial, referrer policy, permissions policy, React's escaped rendering, ETL markup stripping, and a CI invariant banning `dangerouslySetInnerHTML`. The CSP intentionally permits inline script and style because of Next/React streaming requirements; that trade-off is recorded in `DECISIONS.md`.

## Dataset status and research provenance

The generated manifest was built on 8 August 2026 from the locally present source files. It reports:

| Metric | Value |
|---|---:|
| Raw input records | 205,878 |
| Accepted questions | 199,514 |
| Rejected records | 214 (0.1071%; threshold 2%) |
| Random-session eligible | 180,170 |
| MedMCQA accepted | 186,791 |
| MedQA-USMLE accepted | 12,723 |
| MedMCQA duplicate records excluded from randomized sessions | 18,240 |
| Conflicting-answer duplicate groups | 1,104 |
| Answer-key SHA-256 | `beee99db1a560c8f6b2f3f9e5ed0ca237d94aceef6a278807d2bb43631a409bb` |

Known defects are visible to students rather than disguised:

- MedMCQA test rows without upstream labels are excluded.
- Conflicting duplicates are flagged and excluded from randomized sessions.
- Potential text corruption, missing explanations/topics, malformed markup, and low-distinct-option questions are flagged.
- Dataset text is not automatically medically “repaired.”

The project cites MedMCQA under Apache-2.0 and has an attribution file. The local USMLE subset's licence has not been established by a licence file bundled with the dataset; `ATTRIBUTION.md` and `DECISIONS.md` describe this as an unresolved launch concern. This needs legal/provenance resolution before a commercial/public mobile-store release.

## Verification performed for this report

| Check | Result | Evidence / caveat |
|---|---|---|
| TypeScript check | Passed | `tsc --noEmit` via the existing dependency tree. |
| ESLint | Passed | `eslint .` via the existing dependency tree. |
| Test suite | Passed | `vitest run` via the existing dependency tree. Test coverage thresholds are configured at 80/70/80/80 globally and 100% for `lib/core` and `lib/parser`; coverage was not regenerated in this inspection. |
| Integrity/code-policy checks | Passed | `scripts/ci/check-invariants.mjs`. |
| Optimized web build | Passed | `next build`, Next.js 15.5.22; `/` first-load JS reported as 170 kB; all 18 static pages generated. |
| Playwright end-to-end command | Failed | Zero Playwright test files/configuration found; invoking the command also reports Vitest internal-state errors, then `No tests found`. |
| Docker image build/run | Not run | Docker Desktop/engine is not verified locally. |
| Real device/browser accessibility/performance | Not run | No axe sweep, Lighthouse profile, or mobile-device test was found/run. |
| Git diff whitespace | Passed before this report | No pre-existing diff error. |

`pnpm verify` could not run as the scripted command because pnpm tried to purge/reinstall `node_modules` and refused its non-interactive confirmation. This does **not** invalidate the direct checks above, but it means the documented one-command verification is not currently reproducible in this environment without a clean/installable dependency setup.

## Documentation and configuration drift

Treat source code and this report as more current than selected prose documentation until it is updated.

1. `HOSTING.md` repeatedly says the public app has “no sign-in” and no analytics. Current middleware requires account sign-in for page routes, and the current system stores study events, sessions, and user details in Neon. The statements are outdated.
2. `HOSTING.md` calls the corpus 243–255 MB, but the current `corpus.sqlite` is 288,530,432 bytes (about 275 MiB). Deployment sizing should be recalculated from the actual artifact.
3. `render.yaml` uses `Dockerfile.fetch` and declares authentication/database environment variables, while the hosting prose's deployment narrative was written around a public/no-account model.
4. The package contains a `test:e2e` command and Playwright/axe dependencies, but no Playwright test suite or config exists. It must not be represented as tested.
5. No CI workflow configuration was found. Verification, corpus build, migration, deployment, and release gates depend on a developer machine today.

## Android and Google Play gap analysis

### Current Android status

No native Android implementation exists. Repository search found no `android/`, Gradle, Kotlin/Java, Android manifest, Capacitor, React Native, Expo, Trusted Web Activity, `service-worker`, or web-app manifest assets. The responsive web UI may be a good foundation, but it is not installable from Google Play.

The lowest-risk route is to preserve this Next.js service as the backend and introduce a deliberately small native Android client or well-tested Capacitor wrapper only after deciding the desired offline behavior. A Trusted Web Activity would be fastest but makes product quality, connectivity, account deletion, and Play review posture dependent on the hosted site; it does not solve the core mobile-product requirements by itself. A native client is more work but offers reliable offline progress, Android credential integration, notifications, platform accessibility, and testability.

### Google Play requirements checked on 16 September 2026

- New mobile apps and updates submitted from 31 August 2026 must target Android 16 / API 36 or later. [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-AU)
- Play uses Android App Bundles and requires app signing; every update must increase `versionCode`. [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152)
- Because this product creates accounts, Play policy requires an in-app account-deletion path and a Data safety declaration covering deletion. [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- Play technical-quality policy has current and announced thresholds; account restoration requirements are also announced for 2027. [Technical quality requirements](https://support.google.com/googleplay/android-developer/answer/17492799?hl=en)

The existing code has **no account-deletion endpoint, screen, or public web deletion-request URL**, and no privacy-policy page. Those are hard blockers for a Play submission once account creation is exposed in Android. The Data safety form cannot be completed truthfully until data retention, deletion process, third parties (Google OAuth, Neon, hosting), and encrypted transport/storage details are finalized.

## Prioritized implementation roadmap

### P0 — make the existing web product release-verifiable

1. Repair the standard `pnpm verify` path on a clean install and pin the actual toolchain used by CI.
2. Add Playwright flows for signup/login, selecting/submitting/skipping questions, persistence/sync, no-network recovery, account/session expiration, admin authorization, and corpus-integrity failure. Run axe checks in those flows.
3. Add CI that runs install, typecheck, lint, invariants, tests, corpus integrity, build, and e2e against a disposable test database.
4. Build and run the container, exercise `/api/health`, and prove a production image can read the corpus under the non-root user.
5. Reconcile `README.md`, `HOSTING.md`, `render.yaml`, deployment scripts, and the actual authentication/data-storage model.
6. Define retention and deletion policy; implement authenticated account deletion that removes Postgres user data and document the fate of local IndexedDB data and OAuth identity.
7. Resolve the USMLE redistribution licence and establish a release approval record for data provenance.

### P1 — establish the Android product boundary

1. Decide whether v1 is a native client, Capacitor wrapper, or a deliberately limited TWA. Make this decision before building Android features, especially offline content and authentication.
2. For a Google Play Android app, create an API-36 native shell/client with unique application ID, minSdk policy, signing/Play App Signing strategy, app links, adaptive icon, splash screen, release build variants, and an `.aab` release pipeline.
3. Design secure Android authentication around browser/OAuth flows and account restoration; do not embed provider secrets or database credentials in the app.
4. Define an offline contract. At minimum, cache active question windows and encrypted/validated progress; do not casually package the full question database until licensing, binary size, update, and extraction risks are accepted.
5. Add device/emulator testing for Android 16, smaller screens, font scaling, TalkBack, rotation, process death, no network, slow network, and deep links.

### P2 — operational hardening

1. Move rate limiting from process memory to a shared limiter before horizontal scaling; validate proxy-IP handling.
2. Add privacy-preserving, aggregated observability with explicit retention and no question/answer payloads. Instrument integrity failure, sync failure, API latency/error, and app version, subject to policy consent.
3. Replace CSP `unsafe-inline` with nonce/hash-based policy if compatible with the Next.js deployment model.
4. Create backup/restore, migration rollback, incident-response, dependency-update, vulnerability-response, and release-checklist procedures.

## Recommended working assumptions for future development

- Preserve the current answer-integrity boundary: data import owns normalization; UI never derives correctness from text.
- Treat the corpus and its manifest as one immutable release artifact. Any dataset change must rebuild the corpus, update the manifest/hash, rerun source validation, and document outcomes.
- Keep mutable user data outside the corpus database and verify server-side facts instead of accepting them from clients.
- Do not promise medical correctness beyond source attribution. The product should remain explicitly educational and non-clinical.
- Do not claim Google Play readiness until the Android artifact, mandatory policy surfaces, end-to-end/device tests, production deployment, and data-licence review are evidenced.

## Key files to read before changing behavior

- `README.md` — product and local-run overview.
- `DECISIONS.md` — data correctness and intentional design deviations.
- `lib/core/` — correctness-critical code; preserve its small trusted surface.
- `scripts/etl/build.ts`, `lib/parser/` — reproducible corpus import and validation.
- `lib/db/client.ts`, `lib/db/integrity.ts`, `lib/db/queries.ts` — corpus serving and checks.
- `lib/db/userSchema.sql`, `lib/db/userQueries.ts`, `app/api/sync/route.ts` — mutable account/progress model.
- `features/session/store.ts`, `features/session/PracticeShell.tsx` — client session behavior.
- `next.config.ts`, `middleware.ts`, `Dockerfile.fetch`, `render.yaml` — production constraints.
