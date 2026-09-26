# Privacy and account deletion

This document records the implemented behavior and the facts that still need an operator decision. It is not legal advice. The public, user-facing summary is served at `/privacy`; the public deletion instructions are at `/delete-account`.

## Data inventory and purpose

| Data | Location | Purpose | Access |
|---|---|---|---|
| Name, email, password hash or Google identity | Postgres | Authentication and account identity | The account; operational database administrators |
| Practice attempts, bookmarks, streaks, sessions, saved configuration | Postgres and browser IndexedDB | Progress, resume, and personal insights | The account |
| Faculty grants and editorial-note grants | Postgres | Authorization | Super admin sees grant metadata only |
| Faculty modules and immutable question snapshots | Postgres | Deliver the assessment exactly as published | Owning faculty only |
| Module opens, attempts, responses, server timing observations, scores | Postgres | Resume, scoring, attempt enforcement, and descriptive analytics | Student result policy; owning faculty analytics |
| Read-only question corpus | SQLite in the application image | Practice and frozen-module creation | Authenticated users through filtered APIs |
| Short-lived request counters | Application memory | Abuse control | Application process only |

No advertising SDK, generative-model API, or third-party analytics SDK is present. Production infrastructure providers will still process network, database, build, and operational-log data under their own terms.

## Implemented deletion behavior

`DELETE /api/me/account` requires an authenticated session, a same-origin request, a bounded JSON body, and an exact case-insensitive email confirmation. One database transaction:

1. locks the user row;
2. deletes every module owned by that faculty user, cascading its snapshot, open, attempt, response, and analytics inputs;
3. deletes that user's faculty grant, including an unclaimed grant for the same normalized email;
4. deletes the user, cascading Google identity, editorial permission, practice history, bookmarks, sessions, statistics, and the user's participation in other faculty modules.

Only after the server confirms deletion does the browser discard queued practice writes, IndexedDB progress/bookmarks, session storage, local storage, and sign out. A server failure leaves the account, local data, and session intact and gives a retryable error. Browser-storage cleanup is best effort after the irreversible server transaction; failure to access local storage cannot restore the deleted account.

Shared editorial-note content is deliberately not attributed to an author and therefore is not deleted with an account. This product decision must be reviewed before launch if authorship or audit attribution is later added.

## Retention and launch blockers

Primary application rows are deleted immediately by the transaction. Before launch, the operator must obtain and publish the actual retention windows for:

- Neon backups, point-in-time recovery, and database logs;
- Render build/runtime logs and backups;
- OAuth-provider records outside this application;
- any incident/security logs added later.

The operator must also supply `PRIVACY_OPERATOR_NAME`, a monitored `PRIVACY_CONTACT_EMAIL`, jurisdiction-specific lawful bases and rights language, and a stable public HTTPS URL for `/privacy` and `/delete-account`. These are unresolved release blockers; the repository does not pretend otherwise.

## Privacy boundary

Faculty authorization is ownership-scoped on every query. Super administrators manage at most three faculty grants and see minimal account/module-count metadata; there is no super-admin content bypass. Global question-reuse exclusion reveals only that a question was used elsewhere, not which professor/module used it. Small-sample analytics are labelled descriptive and inconclusive.
