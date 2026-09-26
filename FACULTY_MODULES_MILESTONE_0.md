# Faculty exam modules — Milestone 0 design

**Prepared:** 16 September 2026
**Status:** design for review; no feature implementation or database migration has run.

## Decisions and open choices

Confirmed by the owner:

- “Unused questions” covers **all professors’** modules. The filter reveals only whether a question has been used; it must not reveal the other professor, module, question list, or participants.
- Ordinary practice stays available while faculty modules run. Module attempts therefore provide structured timed practice and server-scored results, **not proctored exam secrecy**.
- Faculty may use Google sign-in. Elevated roles must be bound to a verified Google identity, not just an unverified email string.
- Marking is configurable per module, defaulting to +4 correct, −1 incorrect, and 0 unanswered.
- A student’s score is visible immediately after submission.

Working defaults awaiting the owner’s answers:

- Any signed-in student may open a shared link; no roster in v1. This means “invited” has no measurable denominator. Show unique signed-in opens, starts, completions, and completion among starters instead.
- One attempt per student per module.
- Question review is disabled by default and faculty-configurable.
- No CSV export in v1.
- Editorial note permission remains separate from the three application roles and is explicitly assigned during migration.
- Store scoring values as exact integers and show raw and maximum possible points.
- A configured verified Google identity bootstraps the sole super admin.

Any unanswered choice that changes authorization, scoring, or result visibility must be resolved before its implementation milestone. The owner will review this design before Milestone 1 begins.

## Findings that drive the design

1. `types/index.ts` defines `Question` with an answer index. `lib/db/queries.ts` materializes it, and `/api/questions`, `/api/questions/[id]`, and `/api/search` serialize it. `/api/notes` and ordinary practice can also disclose explanations; the corpus itself is distributed from a public dataset host. Hiding answers only in new module APIs cannot make this bank secret. The module APIs must nevertheless never serialize answer keys or explanations before allowed review. Students can still obtain answers through ordinary practice or the source dataset, by the owner’s decision. Do not describe these modules as secure/proctored exams.
2. `auth.ts` currently upserts Google sign-ins by email. `/api/auth/signup` creates email/password accounts without email verification. A role grant based solely on email could be claimed by someone other than the professor. Elevated grants require verified Google provider identity; automatic linking between a credential account and Google account of the same email must be audited and made safe before activation.
3. Existing `ADMIN_EMAILS` controls editorial notes only. It must not become the implicit faculty or super-admin role. Current auth uses JWT sessions, so disable/removal must be checked against the database on every privileged request, rather than copied once into a long-lived JWT.
4. The app has two databases: a read-only SQLite corpus and mutable Neon Postgres user data. The HTTP Neon wrapper currently issues independent statements and cannot support an interactive, multi-step transaction as written. Neon documents WebSocket `Pool`/`Client` for interactive transactions; use that existing driver capability for the transactional module paths, adding only the Node WebSocket constructor if required. [Neon serverless-driver documentation](https://neon.com/docs/serverless/serverless-driver)
5. The current study/exam session store scores in the browser and already has answer-bearing `Question` objects. Faculty modules need a separate server-authoritative attempt flow and a public question DTO with only stem, options, and safe metadata. Reusing the current client exam mode would violate the module requirements.

## Authorization and identity

Use a small permission service with three exclusive application roles: `student`, `faculty`, and `super_admin`. Role reads come from the database at every protected route/page request. A role in a JWT may be displayed optimistically but never authorizes a write/read. Faculty disablement takes effect on the next request; outstanding Auth.js sessions are not sufficient for access.

Bootstrap one super admin with a configured, verified Google provider identity. A `faculty_grants` table stores at most three active faculty entries, their normalized email, status, grantor, and audit timestamps. The super admin can add, disable, or remove grants. An invite/grant attaches to a user only after Google has confirmed control of that email. The exact account-linking migration will be designed and tested against existing users before roles are enabled.

Every faculty query includes `owner_user_id = current_user_id` in SQL. A student-only route rejects both faculty and super admin as participants. Super-admin APIs expose faculty grant state and coarse counts only. There is no super-admin route to module content, configuration, answers, student records, or analytics. Tests must exercise direct URL/API calls and guessed IDs, not just hidden navigation.

This is **application-level** separation. Whoever controls the Neon database or deployment credentials can inspect database rows and the public source corpus. The web app cannot prevent an infrastructure operator from using those credentials; this limitation should be stated to the professor.

## Data model

Proposed new Postgres tables and key constraints:

| Table | Important columns and constraints |
|---|---|
| `auth_identities` | `(provider, provider_subject)` unique, `user_id`, verified email/verification time; prevents privilege assignment from an unverified credential email. |
| `faculty_grants` | normalized email unique, bound user ID nullable until verified sign-in, status, grantor, timestamps. The maximum of three active grants must be enforced transactionally, not only in UI. |
| `modules` | UUID primary key, unique random share slug, `owner_user_id`, status, title/instructions, availability times, duration, attempt/review/scoring policy, corpus fingerprint, created/published/archived timestamps. Index by owner/status/date. |
| `module_questions` | `(module_id, position)` and `(module_id, question_id)` unique. Ordered, immutable published snapshot of source ID, stem, option text, subject/topic, safe flags, explanation, correct index, and corpus fingerprint. Index `question_id` for global used checks. |
| `module_opens` | `(module_id, student_user_id)` unique with first-open time, to count actual signed-in link opens. No invented “invited” metric without invitations. |
| `module_attempts` | module/student/attempt number unique; status, server start/deadline/submission times, score and counts, optimistic revision, audit timestamps. Index by module/status and student/module. |
| `module_responses` | `(attempt_id, position)` unique, chosen option or null, server save time, revision, optional bounded activity timing. Foreign keys to the attempt and module snapshot. |

Use a full **publication snapshot**, not IDs alone. IDs/order alone cannot preserve identical questions if a later ETL changes a stem, options, or answer. Correct indices and explanations live only on the server. A published question set and scoring policy cannot be edited in place; changing them requires a new module/version and a new link. Drafts can be edited freely. Published and archived modules are soft-retained for history and global used-question checks. “Delete” on a published module means archive/withdraw with explicit retention rules, not silent deletion of students’ attempts.

For the global “unused” filter, query corpus candidates in bounded pages and test those candidate IDs against indexed `module_questions.question_id` in Postgres. Repeat until a display page is filled or exhausted. Return a used/not-used bit only for candidates this professor can already browse. Include questions in other professors’ drafts as used once selected, plus published and archived modules; a deleted draft releases its selection. The override allows deliberate reuse, so no global uniqueness constraint on question IDs. Publication rechecks all selected IDs and warns if another professor selected them since the draft was opened. Avoid transferring a growing global ID exclusion list into SQLite or exposing other professors’ module IDs.

## Module and attempt lifecycle

`draft → published → unpublished/archived`. Publication validates 1–200 distinct, session-eligible questions and atomically freezes question text, options, answer key, order, scoring, and corpus hash. The share URL uses an unpredictable slug and requires sign-in. Unpublishing blocks new starts. An already-started attempt may finish until its recorded deadline; this rule should be stated on the faculty action. Archiving preserves completed results and global use history.

`not started → active → submitted / expired`. The student sees title, instructions, count, window, duration, attempts allowed, scoring, and result policy before starting. Starting is a server transaction that checks student role, publication/window, attempt limit, and any existing active attempt, then writes the server start/deadline. `deadline_at = min(started_at + duration, closes_at)` unless the owner chooses a different close-window policy. Identical concurrent start requests return the same active attempt or one deterministic conflict; they never allocate two attempt slots.

The exam fetch returns only the selected question text/options and safe metadata, in frozen order. Autosave writes the chosen option with an optimistic revision; the server rejects stale writes and all writes after submission/deadline. The UI shows last confirmed save, retries on reconnect, and stores only unsent selections locally under a user/attempt namespace. On refresh it reloads the authoritative attempt and responses. A local countdown is for display; the server timestamp is authoritative. Submission locks the attempt, scores against the publication snapshot using the existing index-equality rule in the trusted core, persists the score once, and returns only the configured result. Expired attempts are finalized on access and by a bounded server sweep so the faculty dashboard remains accurate even if a student never returns.

Offline work can be queued, but the server cannot accept a response after the deadline solely because a client claims it was entered earlier. The UI must show this limitation and offer a clear connection warning. Client clock changes, retries, duplicate requests, and app refreshes cannot extend an attempt.

## API and page boundary

The precise route names can change during implementation; the permission boundaries cannot.

| Surface | Allowed role | Response |
|---|---|---|
| `/super-admin/faculty` and `/api/super-admin/faculty` | super admin | grant emails/status and coarse counts only |
| `/faculty/modules` and `/api/faculty/modules` | faculty | own module list and own draft editor |
| `/api/faculty/questions` | faculty | corpus candidate page with an aggregate used bit; no other owner details |
| `/api/faculty/modules/:id/publish` | owning faculty | validates/freezes one draft atomically |
| `/api/faculty/modules/:id/analytics` | owning faculty | own cohort and question analysis |
| `/modules/:slug` and `/api/modules/:slug` | student | published pre-exam information only |
| `/api/modules/:slug/attempts` | student | start/resume own attempt only |
| `/api/module-attempts/:id` and `/responses` | owning student | public question DTO, save status, deadline; no answer key |
| `/api/module-attempts/:id/submit` | owning student | server-scored result according to review policy |

Return `Cache-Control: no-store` on all role-specific, attempt, and analytics responses. All IDs and slugs are looked up with ownership/role predicates. Unknown and unauthorized modules should have indistinguishable not-found behavior where it helps prevent enumeration. CSRF protections follow the existing Auth.js same-origin cookie posture and will be tested for new mutation routes. Rate-limit start, autosave, submit, and faculty search without preventing 200 legitimate concurrent participants.

## Analytics definitions and limitations

- Unique opens are authenticated users who fetched the pre-exam page. Starts are distinct attempt starters; submissions and expiries are server states. With open links there is no valid “invited” count.
- Mean, median, distribution, best and lowest results are calculated from **finalized** attempts only and clearly state whether score or percentage is used. If multiple attempts are allowed, the chosen counting rule must be shown.
- Per-question accuracy denominator is students who submitted a choice on that question; skip rate denominator is finalized attempts that included it. Subject/topic analysis uses the **snapshot** labels, not later corpus values.
- Per-question time is an **estimate** derived from bounded activity events; tab idleness, offline time, and switching devices prevent a precise measurement. It must be labelled accordingly.
- Small sample groups show `n` prominently. Do not label differences between groups as meaningful without enough data or a stated statistical method.
- Faculty summary aggregates only that professor’s modules. Student names/emails and scores are available only to that faculty member, with pagination. A participant notice explains this disclosure before the first attempt.

## Privacy, deletion, and migration

Student module attempts and responses are personal educational data. A student account deletion flow must delete those records, the `module_opens` entry, and existing study progress, then invalidate the account session. Faculty aggregates should be recomputed after deletion rather than retain a hidden identifiable row. Faculty deletion requires an explicit treatment of owned modules and student results; the safe initial rule is to archive/withdraw and erase linked personal records according to a published retention period. Add a privacy page explaining purpose, visibility to faculty, storage, retention, deletion, and providers. Avoid answer content and student choices in logs or general observability.

Add **versioned, forward-only** Postgres migrations and a migration ledger, rather than appending complex SQL to the current semicolon-splitting `userSchema.sql` runner. Run them first on a disposable/local Neon branch or test Postgres database, inspect schema/constraints, and rehearse rollback or restore. No production migration runs until separately authorized. Preserve existing users and notes; grant elevated roles only after identity proof. Keep the corpus SQLite artifact read-only and unchanged.

## Milestone gates

1. **Milestone 1 — identity, roles, and schema:** migration rehearsal, live role checks, verified faculty binding, faculty cap, cross-faculty and super-admin denial tests.
2. **Milestone 2 — builder:** draft/publish lifecycle, global used filter, immutable snapshot, share link; tests for validation, race/recheck, ownership, and stable question set.
3. **Milestone 3 — student exam:** server deadline, autosave/resume, expiry, idempotent submission, review policy; browser and API tests including answer-payload inspection and concurrent starts.
4. **Milestone 4 — analytics:** indexed aggregation, cohort and question reports, cross-faculty denial, sample-size labels, timing caveats; query tests with fixed fixtures.
5. **Milestone 5 — release hardening:** Playwright/axe, load test near 200 concurrent students, production build/container, docs and privacy/deletion, release checklist. No deployment without a separate review of the concrete artifact.

Milestone 0 changed only this design document. It did not exercise a live database, verify production capacity, or modify application code.
