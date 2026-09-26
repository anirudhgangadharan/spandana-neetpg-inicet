# Faculty modules — Milestone 4 analytics

**Status:** implemented and verified locally for review. No production migration, production-data access, deployment, push, scheduler change, or public URL was performed.

## Delivered behavior

- Each faculty account has an owner-scoped overall dashboard at `/faculty/analytics` and an owner-scoped module dashboard at `/faculty/modules/[id]/analytics`. Faculty navigation now links to both surfaces.
- Module analytics report unique opens, unique starters, all attempts, submitted, server-expired, active/incomplete, opened-but-not-started, and the finalization rate. Because the selected product model is “any signed-in student with the link,” there is no roster and therefore no meaningful “invited” count; unique opens are the measurable top of the funnel.
- Finalized attempts (submitted plus server-expired) drive mean, median, high, low, score distribution, completion-time distribution, named high/low observations, question accuracy, skip rate, and subject/topic breakdowns. Every result exposes its denominator. Samples below 10 are explicitly labelled descriptive and inconclusive.
- Student-level attempt results are searchable by name/email, newest-first, and server-paginated at 50 rows. No CSV or bulk export was added.
- Overall analytics include every non-deleted module owned by the current professor, participation/completion by module, modules needing attention, aggregate subject/topic performance, and the ten lowest-observed-accuracy questions. Multiple allowed attempts are intentionally separate observations; the dashboard also distinguishes unique starters so repeat attempts are visible rather than silently treated as unique students.
- Analytics use responsive cards, native tables with captions and header scopes, horizontal overflow on narrow screens, keyboard-native forms/links, explicit empty states, and concise methodology notes. No chart dependency was introduced; distributions use accessible text plus CSS bars.

## Authorization and query design

- Every analytics entry point requires the live `faculty` role. A super admin, student, disabled professor, or unauthenticated account is rejected before an analytics query runs.
- The module-detail query first proves `faculty_modules.owner_user_id = authenticated user`. Every subsequent module analytics query repeats that ownership join. A foreign module is returned as not found, not permission-inspected.
- Overall queries carry the owner predicate directly and cannot aggregate another professor’s modules, participants, answers, or question text. No super-admin bypass exists.
- Query count is fixed rather than per student/question: one owned module aggregate, one finalized-score set, one grouped question query, and one paginated participant query. Existing module/status and response indexes are used; migration 004 adds final-attempt and attempt/position indexes for the new access paths.
- Analytics APIs are `no-store` and inherit the existing faculty/default middleware rate limits. Search is bounded to 120 characters and page numbers to 1–10,000.

## Timing method and scientific limitations

Question time is an estimate derived only from server timestamps. The browser reports a question position, never a timestamp or duration. Postgres serializes each transition on the owned attempt; elapsed database time is credited to the previous question and each observed segment is capped at two minutes. This limits abandoned/background-tab inflation and prevents a client from posting fabricated durations. Database constraints bind an observed position to the frozen module snapshot.

The estimate can undercount backgrounding, network loss, refresh gaps, or the last interval when an expiry is finalized after its deadline. Navigation can also be automated, so this is engagement context—not attention measurement or proctoring evidence. The UI says this directly. Completion time is stronger: it is server start to server submission, capped at the immutable deadline.

Accuracy is reported among answered observations; skip rate is reported among all finalized observations. Subject/topic values pool question observations and are descriptive, not causal or inferential. Repeated attempts can weight one student more heavily. No confidence intervals, rankings of student ability, or claims of question validity are fabricated.

## Schema and reliability

`004_faculty_analytics.sql` adds nullable current-position/server-observation fields, a composite foreign key to the frozen question position, and analytics indexes. Active-time writes continue to pass through the Milestone 3 database trigger, so the timing feature cannot weaken the deadline/finalization write boundary. Late finalization deliberately drops the last timing segment instead of bypassing that guard.

The migration runner discovered migration 004 and completed in dry-run mode only. The migration was exercised repeatedly against disposable PGlite databases; it was not applied to Neon or production.

## Verification evidence

- Targeted PGlite integration tests validate exact open/start/finalized counts, mean/median/high/low, per-question accuracy and skip rates, participant search, cross-professor module denial, and aggregate isolation.
- A server-time test validates the two-minute per-segment cap, null-answer preservation, and cross-student denial. Route tests validate role rejection, owner-ID propagation, bounded pagination/search, no-store responses, strict activity input, and rejection of forged client timing fields.
- Static React tests validate small-sample language, timing limitations, semantic table structure, and absence of answer-key fields.
- Final Vitest run: **292 tests passed across 23 files**.
- TypeScript typecheck passed. ESLint passed after resolving all findings. All seven repository invariant checks passed over 168 source files.
- The optimized Next.js production build passed without warnings and includes both analytics pages/APIs and the activity endpoint.
- Migration and expiry commands passed dry-run checks without opening a database connection.
- Existing Playwright exam coverage passed **4/4**, including refresh recovery, score-only answer-key protection, expiry finalization, and an axe WCAG A/AA scan. Milestone 4 analytics UI was component-tested but does not yet have an authenticated real-browser/real-database E2E test.
- `git diff --check` passed. The read-only question corpus remains unchanged.

## Remaining risks and release blockers

- No disposable Neon branch, real Google OAuth faculty session, multi-process race/load test, or 200-concurrent-student test has run. PGlite validates PostgreSQL behavior used here but is not a substitute for the hosted database and network path.
- “Opened” is recorded on the authenticated landing lookup, not proof that a student read the page. Active attempts may remain active until a student request or configured expiry sweep finalizes them; the dashboard therefore flags active attempts rather than silently counting them complete.
- The in-memory rate limiter is per application instance. A horizontally scaled deployment needs a shared limiter.
- Browser accessibility verification currently covers the timed exam, while analytics accessibility is verified structurally at component level. An authenticated analytics E2E/axe path remains Milestone 5 work.
- Account deletion, privacy documentation, container validation, deployment configuration, Google Play requirements, and release evidence remain Milestone 5. No production-readiness claim is made.

## Files changed in Milestone 4

- Analytics data and timing: `lib/db/facultyAnalytics.ts`, `lib/db/moduleAttempts.ts`, `lib/student/moduleInput.ts`, `scripts/db/migrations/004_faculty_analytics.sql`.
- APIs: `app/api/faculty/analytics/route.ts`, `app/api/faculty/modules/[id]/analytics/route.ts`, `app/api/module-attempts/[id]/activity/route.ts`.
- Faculty UI: `app/faculty/analytics/page.tsx`, `app/faculty/analytics/AnalyticsViews.tsx`, `app/faculty/analytics/analytics.module.css`, `app/faculty/modules/[id]/analytics/page.tsx`, plus analytics links in the module list and builder.
- Student activity integration: `app/module-attempts/[id]/AttemptClient.tsx`.
- Tests: `tests/integration/faculty-analytics.test.ts`, `tests/integration/student-attempts.test.ts`, `tests/unit/faculty-analytics-routes.test.ts`, `tests/unit/faculty-analytics-ui.test.tsx`, `tests/unit/student-attempt-routes.test.ts`, plus migration-list updates in the existing faculty integration suites.
