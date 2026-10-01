# Shareable module analytics

The module creator opens **Share analytics** on their module dashboard, reviews the identity-sharing disclosure, and generates a link. Anyone with that link can read the complete existing analytics dashboard without signing in. The link contains a separate 256-bit random secret; the database stores only its SHA-256 hash. Existing student test tokens remain separate.

Generate/replace returns a relative URL once. Copy it while the sharing panel is open. After leaving the page, replace the link to obtain a new URL. Replacement immediately invalidates the old token; disable sharing is idempotent. One parent-row lock serializes creation, replacement, and revocation even when no sharing record exists yet. Draft/published/unpublished/archived modules are supported; deleted modules and inactive creator grants cannot be shared publicly. Account deletion cascades the record through module deletion.

Shared access resolves module and owner exclusively from the hash, validates the creator's active verified Google faculty grant, reuses owner-scoped analytics queries, and revalidates the token after aggregation. Participant attempt identifiers are replaced with page-local rendering keys and guest participant identifiers are omitted as null. No open, attempt, response, or score mutation occurs. Owner-only API authorization and same-origin mutation checks remain independent of UI capabilities.

## Scientific definitions

Finalized means submitted or server-expired. Active attempts appear in participation only. Finalization rate is finalized/started attempts; accuracy is correct/answered observations; skip rate is skipped/finalized observations. Empty denominators display unavailable values. Repeat attempts are separate observations. Samples below 10 retain the warning. Timing is the existing bounded server-observed estimate, not proctoring telemetry. These descriptive statistics are not validated clinical competence or intrinsic-difficulty measures.

The deterministic parity fixture uses two questions, four opens, three starts, two submitted attempts scoring 3 and -1, and one active attempt. Expected mean/median are 1, finalization is 66.7%, first-question accuracy is 50%, and second-question skip rate is 50%. Shared and owner output must match except for sanitized internal participant IDs. The larger fixture uses 200 synthetic questions, 200 submitted attempts, and 40,000 correct responses; expected score is 800, accuracy 100%, skip rate 0%, and four pages of 50 attempts.

## Reproduction and release limits

Run `pnpm typecheck`, `pnpm lint`, `pnpm lint:invariants`, `pnpm test`, `pnpm build`, `pnpm data:modules:rehearse`, and `pnpm test:e2e`. The representative benchmark is included in `tests/integration/faculty-analytics.test.ts` and reports CPU/RAM, fixture size, concurrency, and latency without secret values. It uses embedded PGlite and cannot establish Neon/network or multi-instance capacity. Browser tests use the existing gated synthetic harness for owner/shared UI, plus actual public routes for anonymous invalid-link and token-substitution checks. A hosted valid-link end-to-end test across account roles remains a deployment gate.

Privacy authorization, provider log redaction/canary inspection, final HTTPS headers, global rate limiting when scaling, and hosted capacity testing remain operator prerequisites. Android packaging and Google Play readiness are outside this feature. Existing Google Play/privacy documentation must be revisited before any Android release.

## Verification evidence — 1 October 2026

- TypeScript, ESLint, seven source invariants, and production Next.js build passed.
- Full Vitest regression: 325 tests across 32 files passed.
- Full Playwright regression: 23 tests passed, including three sharing checks and axe/mobile checks.
- Disposable migration rehearsal: six ordered migrations, matching ledger replay, and sharing-table smoke check passed. No deployment database was migrated.
- Representative fixture: Intel Core i5-1235U, 12 logical CPUs, 16 GiB RAM; PGlite 0.5.8; 200 questions, 200 submitted attempts, 40,000 responses; 16 warmed reads in four batches of four concurrent application calls. Feature-file run: p50 577 ms, p95 738 ms. Full regression alongside a production build: p50 2,881 ms, p95 2,989 ms. CPU contention changes these local measurements substantially; neither run is a hosted HTTP capacity benchmark or a performance guarantee. Both verified complete aggregation and 50-row pagination without errors. PGlite serializes underlying transactions, so competing link tests verify logical outcomes rather than native multi-connection lock contention.
- Hosting/provider log sinks, real Neon pool behavior, and a valid-link browser journey backed by deployed data were not exercised. Synthetic browser fixtures validate presentation and owner controls; database integration tests validate actual authorization, grant changes, lifecycle, account deletion, parity, and competing sharing operations.
