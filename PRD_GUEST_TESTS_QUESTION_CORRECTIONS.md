# PRD: Guest test entry and faculty question corrections

**Status:** Implemented; migration 005 applied to production on 30 September 2026; hosted deployment validation and operator privacy decisions remain
**Product:** Existing Next.js NEET MCQ web app and faculty modules
**Goal:** Let students take a shared faculty test without Google sign-in, and let faculty correct question content and answer keys while building tests.

## 1. Guest test entry

- A valid published `/modules/{token}` link opens without login. Before starting, every student must enter **name**, **registration number**, and **roll number**; all three are required. Google sign-in is not shown or required for this flow. Existing account sign-in remains for practice and faculty areas.
- Validate and trim fields on client and server. Keep registration and roll numbers as text (leading zeros matter). Show clear field errors and an accessible privacy notice explaining faculty visibility and retention.
- Create a module-scoped participant record and a server-issued, opaque guest session in a Secure, HttpOnly, SameSite cookie. Never use the three entered values or the share token alone to authorize attempt reads/writes. A refresh in the same browser resumes the active attempt; losing the session requires a faculty-assisted recovery process, not access based only on matching identifiers.
- Apply the existing opening/closing times, server deadline, submission, scoring, review setting, and attempt limit to guests. Enforce attempt limits per module participant; prevent duplicate active attempts and reuse of the same registration/roll-number pair from creating extra attempts. Provide a clear conflict message if that pair is already claimed.
- Show all three fields in the owning faculty member's participant list and search, alongside attempt status and score. Preserve owner-only authorization and keep guest personal data out of URLs, client logs, and unauthenticated API responses.

### Final-only answer submission and capacity

- Answer choices stay in the browser until **final submission**. Do not send answer saves, periodic checkpoints, or per-question activity writes during the test. Keep a local recovery copy without student identity details so a refresh in the same browser can restore choices; show clearly that these answers have **not** been saved to the server.
- On explicit **Submit**, send the complete answer sheet once. At time expiry, the browser freezes choices and sends the same final-submission request automatically. The server validates the guest session, question positions, and server deadline (with a documented, short receipt grace for network transit), then stores responses, finalizes the attempt, and scores it atomically. Retry an uncertain submission idempotently so a lost response cannot create another attempt or score twice.
- Starting a test still creates the minimal server attempt record needed to enforce the deadline and attempt limit. An expired attempt without a successful final submission has no saved answers and is marked expired/unsubmitted in faculty results. If the browser closes, its local storage is cleared, or connectivity fails before final submission reaches the server, answers may be lost; explain this before the test and on connection failure. Never accept a late answer sheet merely because it was held locally.
- Measure simultaneous final submissions against the intended Render/Neon plan before deployment; set class-size and question-count limits from observed latency, errors, and database usage. Final-only writes reduce traffic during a test but can create a burst when the timer ends.

## 2. Faculty question correction

- In the **draft** module builder, an authorized faculty member can edit the stem, four options, correct option, and explanation before publication. Show the source version beside the proposed correction and require a short correction reason. Validate nonempty stem/options and an answer index from 1 to 4 in the UI, mapped to the existing internal 0–3 representation.
- Saving a correction creates an audited, versioned override for that question in the **effective question pool** used by future practice and future module drafts/publications. Record question ID, original corpus hash, previous/new values, faculty ID, reason, and timestamp; support authorized rollback. Warn that a global correction affects future uses beyond the current test.
- Keep the original imported SQLite corpus and source files immutable. They are read-only and hash-verified today; overwriting them at runtime would break reproducibility and integrity checks. Resolve the effective question as base corpus plus the latest approved override, and expose its version/provenance to the builder. The phrase “update the original database pool” means the corrected version becomes the canonical **served** question for future use, while the original source remains auditable.
- A correction updates the current draft preview/selection. Publication freezes the resolved text, options, answer, and correction version in its existing module snapshot. Existing published tests, active attempts, scores, and historical analytics remain unchanged; any retrospective regrading is a separate, explicitly approved workflow. Prevent lost edits with the builder's existing optimistic revision check and reject conflicting correction versions.

## Acceptance and verification

1. An incognito visitor can open a published link, enter all three fields, refresh/resume with locally held answers, submit once, and appear correctly in the owner's dashboard without Google sign-in. Answer clicks and navigation make no answer/activity API writes.
2. Empty/invalid fields, duplicate identity, expired/closed links, cross-participant attempt access, forged cookies, and repeated submissions fail safely. Another faculty member cannot view the participant or edit the owner's draft.
3. A faculty correction appears in the draft and future pool reads; a later published test uses the corrected answer. The source corpus hash still passes, old published snapshots and scores do not change, and audit/rollback work.
4. Test final submission and retry idempotency, timer-end submission, refresh recovery, browser close, expiry during disconnection, and simultaneous class submissions. Add focused migration, authorization, scoring, and browser accessibility tests; update privacy/retention and Google Play Data safety disclosures before release, consistent with [Google Play's User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en).

## Assumptions and limits

- Registration and roll numbers are **self-reported identifiers, not authentication or proof of student identity**. This flow is suitable for ordinary classroom assessment, not a proctored or fraud-resistant exam.
- Corrections are globally effective when saved by an authorized faculty member. If institutional review is required, add an approval step before activation.
- Guest recovery across devices, retroactive regrading, and edits to already published tests are outside this feature. Set a documented retention/deletion path for guest records before production use.
