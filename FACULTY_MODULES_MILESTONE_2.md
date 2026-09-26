# Faculty modules — Milestone 2 builder

**Status:** implemented locally for review. No production migration, deployment, push, or public student URL was made.

## Product behavior

- A faculty member can create a draft, edit title/description/instructions, local-time availability, duration, attempt limit, integer +correct/−wrong/blank marking, and post-submission review policy. The defaults remain one attempt, +4/−1/0, and score-only review.
- The owner-scoped module list is paginated (50 per page), so older modules remain reachable as the collection grows.
- The question picker supports source, subject, topic (including uncategorised), data-quality flag, full-text search, and an optional view of corpus records unsuitable for exams. It paginates and scans at most 500 corpus rows per request; the client holds only one page of up to 25 candidates.
- “Only questions not used in any professor’s other modules” is on by default, per the owner's clarification. Global usage includes other drafts, published, unpublished, archived, and faculty-hidden published modules. A deleted draft releases its selection. The picker discloses only a used/not-used bit, never another professor, module, or participant.
- Selection saves an ordered set of 0–200 distinct, session-eligible question IDs. Reordering, removal, and preview are keyboard-operable. Reuse requires an explicit override at selection; publication rechecks for new cross-module use and requires a separate confirmation if necessary.
- Publication validates the window and 1–200 selected questions, re-reads them from the integrity-checked SQLite corpus, and atomically freezes full question text/options, answer position, explanation, order, scoring policy, and corpus answer-key hash in Postgres. Database triggers reject later question, owner, link-token, or policy edits (including moving a published question row to another module). Unpublish/republish preserve the same snapshot and share token; archive prevents republishing.
- A unique random link token is created with each module and shown to the owning faculty member after publication. **The student link is not usable yet**: timed student access is Milestone 3. The UI states this explicitly.
- Draft deletion is permanent and frees its selection. Removing a published module hides/archives it but retains its snapshot, usage history, and future attempt records pending the privacy/retention work in Milestone 5.
- Faculty views show opens, starts, submitted and expired attempts, plus completion among starters. With open links there is no measurable invited/enrolled denominator. These counts remain zero until the student attempt flow exists.

## Boundaries and safety

All builder routes re-check the live faculty role and apply the authenticated owner ID in SQL. Module content endpoints return indistinguishable not-found results for unauthorized and unknown IDs. Mutation routes require the app's Origin; draft revisions reject stale tabs. Global used-question writes serialize through a transaction-scoped advisory lock. Candidate responses and faculty module DTOs do not include answer keys or explanations; the answer is read for snapshot persistence only inside the existing trusted core. Faculty link tokens never appear in super-admin APIs.

The rate limiter now has separate buckets for faculty search and builder routes. Like the existing limiter, it is per-IP and in-memory on each instance, not a distributed abuse-control system. A person with database or deployment credentials can still inspect faculty content; application-level role isolation cannot prevent that. Ordinary practice remains answer-bearing by the owner's decision, so these are timed practice assessments, not proctored or secret exams.

## Migration

`scripts/db/migrations/002_faculty_builder.sql` adds optimistic revisions, faculty-facing soft deletion, a visible-list index, and trigger-enforced published immutability. The existing forward-only runner applies `001` then `002` in one transaction with migration hashes. Running `tsx scripts/db/migrate-modules.ts` is dry-run only and connects to no database. The two migrations were executed in disposable PGlite PostgreSQL tests. They have **not** been rehearsed against a disposable Neon branch or applied to production. A future rollout must migrate a backed-up disposable branch, verify old users and notes, then separately authorize and sequence the production migration before shipping this code.

## Verification and outstanding work

The integration suite exercises full publication snapshots, DB immutability, the 200-question cap, global no-repeat and override, cross-faculty ownership, owner-scoped module pagination, bounded picker pagination, combined corpus filters, status transitions, deletion retention, and DTO answer-key omission. Unit routes test direct unauthorized access, same-origin enforcement, validation, and stale revisions; static UI tests check safety defaults and publication gating. The full Vitest suite passed: **264 tests across 14 files**. Typecheck, ESLint, seven invariant checks, migration dry run, and optimized Next.js production build passed during this milestone.

The builder has not been browser-tested against a live isolated Postgres/Auth.js environment. Google OAuth, reverse-proxy Origin handling, a disposable Neon migration, and multi-process concurrency still need rehearsal. The student link, timer, autosave, scoring, result policy enforcement, participant analytics, account deletion, and Google Play release checks remain future milestones. Do not present this as a live exam service.

## Files changed in Milestone 2

- Corpus/snapshot and builder data paths: `lib/core/question.ts`, `lib/db/queries.ts`, `lib/db/facultyModules.ts`, `lib/db/facultyQuestions.ts`, `lib/db/facultyModuleBuilder.ts`, `lib/faculty/moduleInput.ts`.
- API and abuse controls: `lib/api/facultyModuleRoutes.ts`, `app/api/faculty/modules/route.ts`, `app/api/faculty/modules/[id]/route.ts`, `app/api/faculty/modules/[id]/questions/route.ts`, `app/api/faculty/modules/[id]/status/route.ts`, `app/api/faculty/questions/route.ts`, `middleware.ts`.
- Faculty UI: `app/faculty/modules/page.tsx`, `app/faculty/modules/ModuleListClient.tsx`, `app/faculty/modules/modules.module.css`, `app/faculty/modules/[id]/page.tsx`, `app/faculty/modules/[id]/ModuleBuilder.tsx`.
- Schema and tests: `scripts/db/migrations/002_faculty_builder.sql`, `tests/integration/faculty-foundation.test.ts`, `tests/integration/faculty-builder.test.ts`, `tests/unit/faculty-isolation.test.ts`, `tests/unit/faculty-builder-routes.test.ts`, `tests/unit/faculty-builder-ui.test.tsx`, this report.

The unrelated `PROJECT_CONTEXT_REPORT.md` remains untouched; prior Milestone 0/1 artifacts are preserved.
