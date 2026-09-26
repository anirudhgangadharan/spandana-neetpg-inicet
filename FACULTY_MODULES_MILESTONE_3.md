# Faculty modules — Milestone 3 student exam flow

**Status:** implemented locally for review. No production migration, deployment, push, scheduler, or public URL was created.

## Student behavior

- Any regular signed-in student with the random module link can view a published module's pre-exam screen. Faculty and super-admin identities cannot participate. The screen shows instructions, count, server-configured duration, availability, marking, attempt usage, result policy, and the disclosure that the owning professor can see identity and responses.
- Starting is transactional. It checks the live module status/window, locks the student row to serialize duplicate tabs, resumes one valid active attempt, expires an overdue attempt, enforces the configured attempt count, and assigns `deadline_at = min(server start + duration, module close)`.
- Active-attempt payloads contain the frozen question order, stems, options, and safe metadata only. They contain no correct position or explanation. The score is computed once on the server from the immutable snapshot through the trusted core.
- Answers save individually with optimistic revisions. A duplicate retry is idempotent; a genuinely stale edit pauses the client and asks whether to use the server copy or intentionally retry the local choices. Unsent selections are kept in tab-scoped `sessionStorage`, namespaced by user and attempt, and are cleared after acknowledgement, finalization, or confirmed sign-out. No answer key is stored there.
- Refresh reloads authoritative responses and retries tab-local unsent selections. Network failures and save state are explicit. The browser warns before closing with unsent work. Offline answers are never backdated or accepted after the server deadline.
- The countdown is display-only. Read, save, submit, and the bounded expiry sweep all compare against database time. Reaching zero asks the server to finalize; reconnecting after zero retries finalization. Late writes are blocked both in application transactions and by a database trigger.
- Submission waits for pending saves, requires confirmation, is idempotent, and returns score/counts immediately. Answer and explanation review is returned only after finalization and only when the professor enabled it before publication; score-only is the default.
- Existing attempts retain their original deadline after unpublish/archive/removal, while new starts are blocked. Completed students can still view the result permitted by the frozen policy.
- The exam UI is responsive and keyboard-operable, moves focus to the new question heading, exposes answered/unanswered navigation state, and limits timer announcements to meaningful thresholds rather than every second.

## Server and data integrity

`003_student_attempts.sql` adds an indexed active-deadline scan and a trigger that refuses response inserts/updates once an attempt is finalized or its database deadline passes. Attempt creation, response writes, finalization, scoring, and attempt-count enforcement run in Postgres transactions. Ownership predicates use the authenticated student ID; unknown and foreign attempt IDs are indistinguishable.

The scheduled expiry endpoint requires an exact bearer token from `ATTEMPT_SWEEP_SECRET`, processes at most 250 attempts per call in `FOR UPDATE SKIP LOCKED` batches, and returns only a count. A dry-run-safe CLI is also available. Neither has been scheduled or invoked against a real database. Lazy finalization on every student attempt read/save/submit remains the correctness backstop.

Exam traffic is rate-limited per authenticated student (180 requests/minute), avoiding a shared campus-NAT bucket. The edge Auth configuration now preserves the signed JWT user ID for that purpose. The limiter remains in-memory per app instance and is not a distributed control.

## Threat model and limitations

The implementation prevents simple client-clock extensions, client-computed scores, duplicate-tab attempt allocation, stale silent overwrites, post-deadline saves, cross-student reads, and active-attempt answer-key payloads. It does not make this a proctored or secret exam: ordinary practice remains answer-bearing by the owner's decision; students may already know questions, share credentials or screenshots, consult another device, or obtain the public source corpus. Database/deployment operators can inspect stored snapshots. Client-side time-on-question is deliberately not accepted as truth; Milestone 4 must derive bounded server-observed estimates and label them as estimates.

The application cannot prove when an offline click occurred, so a choice that reaches the server after the deadline is rejected even if the student says it was made earlier. This is the only defensible server-authoritative rule and is disclosed in the UI.

## Verification

- Disposable PostgreSQL/PGlite integration tests cover start, resume, score-only payload inspection, enabled review, database-authoritative expiry, late-write rejection, idempotent submission, stale revisions, foreign-student denial, repeat-attempt numbering/limits, unpublish-with-active-attempt behavior, unique open recording, and bounded abandoned-attempt sweeping.
- Direct route tests cover role denial, invalid tokens, owner identity propagation, same-origin mutations, strict/bounded input, oversized bodies, and the protected scheduler endpoint.
- React/JSDOM tests cover active/result rendering, review gating, unsent-selection recovery after refresh, and deadline finalization.
- Playwright uses the real exam client with synthetic data and mocked attempt APIs. Four browser tests pass: network-failure refresh recovery, score-only submission with no answer key, expiry finalization, and an axe WCAG A/AA scan. The scan found and drove a real light-theme primary-button contrast fix (`4.45:1` to approximately `4.76:1`). The harness returns 404 unless `E2E_TEST_MODE=1`; this was checked against the production build.
- The final local Vitest suite passed (**285 tests across 20 files**). Typecheck, ESLint, seven invariant checks, migration and expiry-command dry runs, the optimized production build, and `git diff --check` also passed. The final Playwright run passed all four tests and exited cleanly with code 0.

Not yet verified: a disposable Neon branch, real Google OAuth/browser sessions, an actually configured scheduler, multi-process races, 200-concurrent-student load, container execution, Android wrapping, or production deployment. Those remain release blockers, primarily for Milestone 5. No production-readiness claim is made.

## Files changed in Milestone 3

- Attempt service and safe DTOs: `lib/core/verdict.ts`, `lib/db/moduleAttempts.ts`, `lib/db/studentModules.ts`, `lib/student/moduleInput.ts`, `lib/api/studentModuleRoutes.ts`.
- Student routes: `app/api/modules/[token]/route.ts`, `app/api/modules/[token]/attempts/route.ts`, `app/api/module-attempts/[id]/route.ts`, `app/api/module-attempts/[id]/responses/route.ts`, `app/api/module-attempts/[id]/submit/route.ts`, `app/api/internal/module-attempts/expire/route.ts`.
- Student UI: `app/modules/[token]/page.tsx`, `app/modules/[token]/StartModuleButton.tsx`, `app/module-attempts/[id]/page.tsx`, `app/module-attempts/[id]/AttemptClient.tsx`, `app/module-exam.module.css`, `components/auth/AccountMenu.tsx`.
- Reliability/configuration: `scripts/db/migrations/003_student_attempts.sql`, `scripts/db/expire-module-attempts.ts`, `auth.config.ts`, `auth.ts`, `middleware.ts`, `render.yaml`, `styles/tokens.css`.
- Browser setup/tests: `playwright.config.ts`, `scripts/e2e/run.mjs`, `app/e2e-harness/module-attempt/page.tsx`, `tests/e2e/module-attempt.spec.ts`, `tests/integration/student-attempts.test.ts`, `tests/unit/auth-config.test.ts`, `tests/unit/student-attempt-routes.test.ts`, `tests/unit/student-expiry-route.test.ts`, `tests/unit/student-attempt-ui.test.tsx`, `tests/unit/student-attempt-interaction.test.tsx`, plus migration-list updates in the earlier faculty integration tests.

The read-only corpus remains unchanged. No database migration was applied outside disposable tests.
