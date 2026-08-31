# Browser Speech MMI Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Repository-specific execution override:** Reuse the one persistent `quality_engineer` already assigned to this branch for implementation; do not dispatch additional task agents. The primary agent owns impact checks, review checkpoints, and final verification.

**Goal:** Complete the 11-minute candidate MMI station with free browser speech-to-text, editable and deadline-safe transcript persistence, typed fallback, and transcript-only feedback, without recording, uploading, or storing audio.

**Architecture:** A browser-only speech adapter converts Web Speech API events into final and interim text while a pure transcript reducer keeps manual edits authoritative. The candidate UI checkpoints only text to authenticated, owner-scoped Supabase RPCs; PostgreSQL remains authoritative for phase deadlines and atomically finalizes the last pre-deadline draft. A separate candidate scoring Edge Function evaluates immutable finalized transcripts against clinician-approved rubric snapshots and exposes only validated student feedback at station completion.

**Tech Stack:** Expo Router, React Native Web, TypeScript, Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), Vitest, Node test runner, Playwright, Supabase Postgres/RLS/security-definer RPCs, Supabase Edge Functions/Deno, existing MMI scoring contracts, GitNexus.

**Spec:** `docs/superpowers/specs/2026-08-31-browser-speech-mmi-station-design.md`

## Global Constraints

- Work only in `/Users/sanje/code/mmi/.worktrees/cofounder-ui-reliability` on `feat/cofounder-ui-reliability`; preserve all pre-existing tracked and untracked changes.
- Before changing every indexed function, class, or method, run GitNexus upstream impact analysis for that symbol. Warn the user and stop before any HIGH or CRITICAL edit. Run branch-scoped `gitnexus detect-changes` before each task commit and before final handoff.
- Use `apply_patch` for manual edits. Stage only the explicit task files; never stage the existing `AGENTS.md`, `CLAUDE.md`, `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md`, `.DS_Store`, `.claude/skills`, `.impeccable`, or `supabase/.branches` changes.
- Keep `normalized_mmi_station_enabled` disabled by default and enforce it in both the client and every candidate RPC. Do not deploy, alter hosted Supabase, push, publish, or modify third-party state without a separate explicit approval.
- Keep the schedule fixed at 60 seconds of preparation followed by five 120-second responses. `serverNow`, `phaseStartedAt`, and `phaseEndsAt` remain authoritative; `performance.now()` is display-only.
- Do not access the microphone during preparation. For a new session, run microphone preflight before starting the server timer. For a restored session, require an explicit **Resume microphone** user gesture and leave the editable text fallback immediately available.
- Use only `SpeechRecognition` or `webkitSpeechRecognition`, with `lang = 'en-GB'`, `interimResults = true`, and no app-owned paid transcription service. Browser vendors may process audio remotely; disclose that before microphone preflight.
- Never instantiate `MediaRecorder`, request camera/video, create audio blobs, upload audio, create a storage bucket, persist audio URLs, or log transcript content. Only transcript text and minimal idempotency metadata may be persisted.
- Limit transcript text to 12,000 Unicode code points per response. The client validates before RPC submission and the database enforces `char_length(transcript) <= 12000`.
- Checkpoint only the current response, only before its server deadline, and only when text changed. A deadline freezes the editor and speech adapter. Finalization copies the last server-accepted draft; it never accepts transcript text as an argument.
- Generate one UUID finalization key per session/prompt and retain only that small key in `sessionStorage`. A refresh restores transcript content from the server, never from browser storage.
- Finalized response state is immutable: non-empty text becomes `response`; empty/whitespace-only text becomes `no_response`. Drafts are deleted on finalization or abandonment.
- Snapshot the active `mmi_privacy_notices` version on session creation. Final transcript retention follows that notice. Add a service-role purge RPC for candidate free text; never invent a second retention duration.
- Snapshot a clinician-approved active rubric and the pinned scoring contract per prompt when available. A missing approved rubric must not block the timed station; it produces `feedback_unavailable`, never a generic or invented rubric.
- Score only finalized transcripts. Do not score pronunciation, accent, vocal confidence, pace, tone, hesitation, or any other delivery property. Preserve the existing `score-answer` function unchanged.
- Use only synthetic prompt and transcript fixtures in tests, docs, logs, and snapshots. Never expose future prompts, rubric content, model answers, assessor criteria, provider payloads, or private server errors to the candidate.
- Follow strict TDD for every task: create or update the focused test first, run it and record the expected RED failure, make the smallest implementation, rerun GREEN, then refactor without changing behavior.

---

## File Structure and Ownership

| File | Responsibility |
| --- | --- |
| `src/features/candidateMmi/types.ts` | Shared prompt, speech status, finalization, and feedback types; remove the obsolete opaque media-artifact contract. |
| `src/features/candidateMmi/transcript.ts` | Pure immutable reducer for restored drafts, final recognition fragments, interim display, and manual edits. |
| `src/features/candidateMmi/speechPort.ts` | Injected Web Speech API adapter, capability detection, preflight, restart, stop, and stale-callback rejection. |
| `src/features/candidateMmi/api.ts` | Exact-key parsing and authenticated RPC calls for projection, checkpoint, finalization, abandonment, and feedback. |
| `src/features/candidateMmi/runner.ts` | Idempotent server workflow for checkpoint, deadline finalization, trusted refresh, and leave. It does not own speech state. |
| `src/features/candidateMmi/mediaPort.ts` | Delete after callers and tests move to the speech port; no recording abstraction remains. |
| `src/features/candidateMmi/scoringApi.ts` | Safe client wrapper for the candidate-specific scoring Edge Function. |
| `app/practice/mmi-station.tsx` | Preflight, disclosure, timer, editable transcript, microphone status/recovery, checkpoint loop, freeze/finalize, and completion feedback. |
| `supabase/migrations/20260831000000_candidate_mmi_browser_speech.sql` | Forward-only transcript, rubric snapshot, scoring claim, privacy retention, RLS, RPC, and postcondition boundary. |
| `supabase/functions/score-candidate-mmi-response/index.ts` | Authenticated transcript-only candidate scorer using server-owned prompt/rubric snapshots. |
| `tests/candidateMmiSpeech.test.ts` | Speech adapter and transcript reducer unit tests with injected browser fakes. |
| `tests/candidateMmiApi.test.ts` | Exact response parsing and runner ordering/idempotency tests. |
| `tests/candidateMmiUiContract.test.ts` | Static UI contract: editable response input and speech disclosure exist; camera/audio persistence remain absent. |
| `tests/candidateMmiScoring.test.ts` | Candidate scoring request, claim, validation, failure, and privacy tests. |
| `tests/integration/candidateMmiStation.integration.test.ts` | Disposable local PostgreSQL proof for deadline, ownership, RLS, finalization, scoring claims, and retention. |
| `e2e/cofounder-preview.spec.ts` | Browser evidence for speech success, manual fallback, deadline transition, refresh restore, completion, and flag-disabled behavior. |
| `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md` | Cofounder release checklist and manual browser matrix; edit only the relevant candidate-station section. |

## Shared TypeScript Contracts

Use these contracts exactly; implementation may add private helpers but not widen candidate-visible data:

```ts
export type CandidateMmiSpeechStatus =
  | 'idle'
  | 'listening'
  | 'restarting'
  | 'unsupported'
  | 'permission_denied'
  | 'unavailable';

export type CandidateMmiSpeechCapability = Readonly<{
  supported: boolean;
  implementation: 'speech_recognition' | 'webkit_speech_recognition' | 'none';
}>;

export interface CandidateMmiSpeechPort {
  getCapability(): CandidateMmiSpeechCapability;
  preflight(input: Readonly<{
    onStatus: (status: CandidateMmiSpeechStatus) => void;
  }>): Promise<CandidateMmiSpeechStatus>;
  start(input: Readonly<{
    responseIdentity: string;
    onFinalFragment: (text: string) => void;
    onInterimText: (text: string) => void;
    onStatus: (status: CandidateMmiSpeechStatus) => void;
  }>): Promise<void>;
  stop(input: Readonly<{ responseIdentity: string }>): Promise<void>;
  abort(): Promise<void>;
}

export type CandidateMmiTranscriptState = Readonly<{
  committedText: string;
  interimText: string;
  revision: number;
  dirty: boolean;
  frozen: boolean;
}>;
```

The response projection gains exactly `draftTranscript`, `draftRevision`, and
`responseStatus: 'open'`. The API never accepts unknown response keys. Transcript
composition uses one rule: manual edits replace `committedText`; a final speech
fragment appends with one normalized space; interim text is display-only and is
never checkpointed until the browser marks it final.

## Database Contracts

The forward-only migration creates these private tables with RLS enabled and no
`anon` or `authenticated` table privileges:

```sql
candidate_mmi_station_prompt_snapshots(
  session_id uuid,
  prompt_order smallint,
  sub_question_id text,
  prompt_text text,
  rubric_snapshot jsonb null,
  scoring_contract_snapshot jsonb null,
  primary key (session_id, prompt_order)
)

candidate_mmi_station_response_drafts(
  session_id uuid,
  prompt_order smallint,
  transcript text,
  client_revision bigint,
  accepted_at timestamptz,
  primary key (session_id, prompt_order)
)

candidate_mmi_station_responses(
  id uuid primary key,
  session_id uuid,
  prompt_order smallint,
  response_state text check (response_state in ('response', 'no_response')),
  finalized_transcript text null,
  finalized_at timestamptz,
  finalization_key uuid,
  scoring_status text check (scoring_status in
    ('pending', 'in_progress', 'scored', 'no_response', 'feedback_unavailable', 'failed')),
  public_assessment jsonb null,
  transcript_purged_at timestamptz null,
  unique (session_id, prompt_order)
)

candidate_mmi_response_scoring_claims(
  id uuid primary key,
  response_id uuid unique,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer,
  last_error_code text null,
  created_at timestamptz,
  updated_at timestamptz
)
```

Add `privacy_notice_version text references mmi_privacy_notices(version)` to
`candidate_mmi_station_sessions`. Session creation selects the current active
published notice and snapshots each prompt. For each prompt it snapshots only an
active clinician-reviewed rubric; otherwise both scoring snapshots are null.

Authenticated browser RPCs:

```sql
checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint) -> jsonb
finalize_candidate_mmi_station_response(uuid, smallint, uuid) -> jsonb
get_candidate_mmi_station_feedback(uuid) -> jsonb
```

Service-role-only RPCs:

```sql
claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid) -> jsonb
complete_candidate_mmi_response_scoring(uuid, uuid, uuid, jsonb) -> jsonb
fail_candidate_mmi_response_scoring(uuid, uuid, uuid, text) -> void
purge_expired_candidate_mmi_free_text(timestamptz) -> jsonb
```

All functions are `SECURITY DEFINER SET search_path = public, pg_temp`, validate
`auth.uid()` or an explicit service-role identity, and return fixed JSON objects.
`get_candidate_mmi_station_session` invokes a private catch-up helper that
finalizes every elapsed response before projecting the current phase. This makes
refresh/re-entry correct even if a tab was closed at a deadline.

---

### Task 1: Add the Pure Transcript Reducer and Browser Speech Adapter

**Files:**

- Create: `src/features/candidateMmi/transcript.ts`
- Create: `src/features/candidateMmi/speechPort.ts`
- Modify: `src/features/candidateMmi/types.ts`
- Create: `tests/candidateMmiSpeech.test.ts`
- Modify: `vitest.config.mts`

**Indexed symbols to check before editing:** `CandidateMmiMediaPort`, `createNoCaptureMediaPort`.

- [ ] **Step 1: Record blast radius before changing the media boundary**

  Run branch-scoped GitNexus context and upstream impact for `CandidateMmiMediaPort` and `createNoCaptureMediaPort`. Record direct callers in `runner.ts`, `mmi-station.tsx`, and candidate tests. Stop if risk is HIGH or CRITICAL.

- [ ] **Step 2: Write reducer tests first**

  Test immutable transitions for restored draft, manual replacement, final fragment append, whitespace normalization, interim replacement, interim clear, accepted checkpoint, and freeze. Assert final fragments are ignored after freeze or for a stale response identity. Assert Unicode code-point length, not UTF-16 `.length`, enforces the 12,000-character ceiling.

  Representative reducer expectation:

  ```ts
  expect(reduceTranscript(restored, {
    type: 'finalFragment',
    responseIdentity: currentIdentity,
    text: 'and checked understanding',
  })).toMatchObject({
    committedText: 'I would listen first and checked understanding',
    interimText: '',
    dirty: true,
  });
  ```

- [ ] **Step 3: Write speech adapter tests with an injected fake constructor**

  Cover standard and WebKit constructors, `en-GB`, interim/final result routing, explicit preflight start/stop, current-response restart after `onend`, no restart after `stop`, and stale callbacks after response change. Map `not-allowed` and `service-not-allowed` to `permission_denied`; map `audio-capture` and `network` to `unavailable`; treat `no-speech` as restartable. Assert unsupported environments never request media and all failure paths retain manual editing.

- [ ] **Step 4: Run focused tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiSpeech.test.ts`

  Expected: FAIL because the reducer and speech adapter do not exist.

- [ ] **Step 5: Implement the minimal immutable reducer and adapter**

  Inject a `SpeechRecognition` constructor instead of reading `window` inside testable logic. Guard every callback with a monotonically increasing generation and the active response identity. Use a fresh recognition instance after recoverable `onend`; do not retry permission, capture, or network errors. `abort()` invalidates the generation before stopping the native instance so late events cannot append text.

- [ ] **Step 6: Verify GREEN and refactor**

  Run: `npx vitest run tests/candidateMmiSpeech.test.ts`

  Expected: PASS. Keep each adapter method under 50 lines by extracting event decoding and error mapping helpers.

- [ ] **Step 7: Commit the isolated task**

  Run branch-scoped `gitnexus detect-changes`; confirm only the expected speech/type/test symbols are affected. Stage only the five task files and commit: `feat: add browser speech transcript port`.

### Task 2: Add Deadline-Safe Transcript and Scoring Persistence

**Files:**

- Create: `supabase/migrations/20260831000000_candidate_mmi_browser_speech.sql`
- Modify: `tests/integration/candidateMmiStation.integration.test.ts`
- Modify: `tests/candidateMmiUiContract.test.ts`

**Existing SQL boundary:** Build forward from `20260826000000_normalized_mmi_station_orchestration.sql`; never edit the old migration.

- [ ] **Step 1: Write static migration policy assertions**

  Assert the new migration creates exactly the four private tables and seven RPCs listed above; enables RLS; revokes base-table access; grants only the three browser RPCs to `authenticated`; reserves scoring/purge RPCs for `service_role`; fixes every function search path; reasserts normalized-content table denial; and contains no audio/blob/bucket/storage/recorder schema.

- [ ] **Step 2: Write disposable-local integration tests**

  Extend the synthetic candidate fixture to prove:

  - only the owner can checkpoint, finalize, read feedback, or abandon;
  - a checkpoint is accepted only for the currently timed prompt and before its deadline;
  - stale/equal client revisions cannot overwrite a newer accepted draft;
  - 12,001 Unicode code points are rejected;
  - finalization before the deadline is rejected;
  - finalization after the deadline copies the last accepted draft and deletes the draft row;
  - post-deadline checkpoint/finalize retries cannot change finalized text;
  - an empty draft becomes `no_response` and never creates a scoring claim;
  - `get_candidate_mmi_station_session` catches up elapsed responses after a simulated tab closure;
  - only the current response projection contains its draft; no prior transcript, future prompt, rubric, or assessment leaks;
  - abandoned sessions delete drafts and cannot be reopened;
  - a missing rubric yields `feedback_unavailable`; one approved snapshot permits exactly one lease-backed claim;
  - lease conflicts return `in_progress`, expired leases can be reclaimed, and stale lease tokens cannot complete/fail a claim;
  - fixed-day privacy notices purge finalized transcript text while retaining public assessment and audit status.

- [ ] **Step 3: Run tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiUiContract.test.ts`

  With the repository's approved disposable-local mutation environment exported, run: `npm run test:integration:mutating`

  Expected: static and integration tests fail because the forward migration and RPCs are absent. If the local-only guard rejects the environment, stop without printing credentials and repair only the disposable local test setup.

- [ ] **Step 4: Implement tables, constraints, and private helpers**

  Add table constraints for orders `1..5`, immutable final state, transcript/state consistency, assessment/status consistency, attempts greater than zero, and the 12,000-code-point limit. Add private helpers for current prompt calculation, deadline calculation, and catch-up finalization. Lock a session row `FOR UPDATE` during checkpoint/finalize/catch-up to serialize deadline transitions.

- [ ] **Step 5: Implement authenticated RPCs**

  `checkpoint_candidate_mmi_station_response` compares `clock_timestamp()` to the authoritative response window and performs a revision-guarded upsert. It returns only `{sessionId,promptOrder,draftRevision,acceptedAt}`.

  `finalize_candidate_mmi_station_response` rejects early calls, returns an existing immutable row on retry, copies the stored draft without accepting text, deletes the draft, and returns only `{sessionId,promptOrder,responseState,finalizedAt,scoringStatus}`.

  `get_candidate_mmi_station_feedback` returns five ordered entries only after the session is completed. Each entry is exactly `{promptOrder,status,assessment}`; `assessment` is non-null only for `scored`.

- [ ] **Step 6: Implement rubric/privacy snapshots and service claims**

  Extend session creation to require the active published privacy notice and snapshot prompts. For each prompt, copy an active clinician-reviewed rubric plus the pinned contract when both exist; otherwise leave both null. Implement a five-minute scoring lease, idempotent completion, allowlisted error codes, and retention based only on the session's notice snapshot.

- [ ] **Step 7: Add SQL postconditions**

  At migration end, raise an exception if ownership, `prosecdef`, `proconfig`, grants, RLS, table ACLs, response constraints, or RPC signatures differ from the contract. Include checks that authenticated users cannot select private prompt snapshots, drafts, responses, or claims directly.

- [ ] **Step 8: Verify GREEN**

  Run: `npx vitest run tests/candidateMmiUiContract.test.ts`

  Run: `npm run test:integration:mutating`

  Expected: PASS with synthetic data only.

- [ ] **Step 9: Commit the isolated task**

  Run branch-scoped `gitnexus detect-changes`. Stage only the migration and two tests; commit: `feat: persist deadline-safe candidate transcripts`.

### Task 3: Extend the Candidate API and Runner

**Files:**

- Modify: `src/features/candidateMmi/api.ts`
- Modify: `src/features/candidateMmi/runner.ts`
- Delete: `src/features/candidateMmi/mediaPort.ts`
- Modify: `tests/candidateMmiApi.test.ts`
- Modify: `tests/mmiCandidateSchedule.test.ts`

**Indexed symbols to check before editing:** `createCandidateMmiApi`, `createCandidateMmiRunner`, `createNoCaptureMediaPort`.

- [ ] **Step 1: Run GitNexus impact analysis**

  Record all d=1 callers for the three indexed symbols. The expected production caller is `CandidateMmiStationScreen`; the expected test callers are the candidate API/schedule suites. Stop if GitNexus reports HIGH or CRITICAL risk.

- [ ] **Step 2: Rewrite API tests before implementation**

  Extend the valid response projection fixture with `draftTranscript: ''`, `draftRevision: 0`, and `responseStatus: 'open'`. Assert any missing/unknown draft key, over-limit transcript, invalid revision, prior transcript array, rubric, criteria, score, model answer, or future prompt is rejected.

  Test exact RPC calls:

  ```ts
  checkpoint(sessionId, 1, 'Synthetic answer.', 3)
  // checkpoint_candidate_mmi_station_response with p_session_id,
  // p_prompt_order, p_transcript, p_client_revision

  finalize(sessionId, 1, finalizationKey)
  // finalize_candidate_mmi_station_response with no transcript argument
  ```

  Test exact-key parsing for checkpoint acknowledgement, finalization result, and five-entry completion feedback. Extend the safe error allowlist with `response_closed`, `response_not_closed`, and `in_progress`, without echoing database messages.

- [ ] **Step 3: Rewrite runner tests before implementation**

  Replace media ordering tests with server workflow tests:

  - `start` and `restore` accept the trusted projection;
  - checkpoint deduplicates identical revision/text and shares concurrent requests;
  - a checkpoint acknowledgement marks only the matching response revision accepted;
  - deadline finalization is called once before trusted refresh;
  - concurrent/retried finalization shares the same key and result;
  - finalize failure leaves the response frozen and retryable, never refreshes into a later prompt speculatively;
  - scenario expiry refreshes without finalization;
  - cross-response refresh first server-finalizes elapsed prompts through the getter, then accepts only the returned current projection;
  - leave calls server abandonment once logically and exposes no transcript.

- [ ] **Step 4: Run focused tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiApi.test.ts tests/mmiCandidateSchedule.test.ts`

  Expected: FAIL because current code still uses the no-capture media port and lacks transcript RPCs.

- [ ] **Step 5: Implement exact parsers and RPC methods**

  Preserve `hasExactKeys`, UUID/order/timestamp validation, and safe error mapping. Add pure parsers for the three new response types. Validate transcript code points before invoking Supabase. Never log the transcript or the raw RPC error.

- [ ] **Step 6: Refactor runner to server persistence**

  Remove the media dependency and obsolete `CompletedResponseArtifactRef`. Track the current response identity, last accepted revision, in-flight checkpoint, and in-flight finalization immutably. `expireCurrentPhase(finalizationKey)` finalizes only a response projection, then refreshes; it does not advance on finalization failure. Delete `mediaPort.ts` only after all imports are gone.

- [ ] **Step 7: Verify GREEN**

  Run: `npx vitest run tests/candidateMmiApi.test.ts tests/mmiCandidateSchedule.test.ts`

  Run: `npm run typecheck`

  Expected: PASS with no imports of `mediaPort` or `CompletedResponseArtifactRef`.

- [ ] **Step 8: Commit the isolated task**

  Run branch-scoped `gitnexus detect-changes`; confirm every d=1 caller was updated. Stage only the five task paths and commit: `feat: finalize timed candidate transcripts`.

### Task 4: Add Candidate-Specific Transcript Scoring

**Files:**

- Create: `supabase/functions/score-candidate-mmi-response/index.ts`
- Create: `src/features/candidateMmi/scoringApi.ts`
- Create: `tests/candidateMmiScoring.test.ts`
- Modify: `vitest.config.mts`

**Existing modules to reuse unchanged where possible:** `supabase/functions/_shared/http.ts`, `aiProvider.ts`, `mmiContracts.ts`, and `mmiScoringContract.ts`.

- [ ] **Step 1: Write scorer contract tests**

  Test bounded 4 KiB JSON input `{sessionId,promptOrder}`, bearer authentication, UUID/order validation, CORS allowlist, service claim arguments, and status mapping. Assert `no_response` and `feedback_unavailable` return without a provider call; `in_progress` returns 409 with `Retry-After`; an existing score returns the stored public assessment.

  Test that the provider receives only the immutable finalized transcript, prompt snapshot, rubric snapshot, and scoring contract from the service claim. Assert the system instructions explicitly prohibit delivery/accent/tone scoring. Assert provider output passes `validateJsonSchema`, `parseProviderAssessmentForContract`, `createMmiPublicOutputContext`, and `toPublicMmiAssessment` before persistence.

  Test lease-safe completion/failure and verify logs/errors contain only request ID, provider name, HTTP status, and allowlisted code—not transcript, prompt, rubric, provider body, API key, or private DB error.

- [ ] **Step 2: Run focused tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiScoring.test.ts`

  Expected: FAIL because the candidate scorer and client do not exist.

- [ ] **Step 3: Implement the Edge Function**

  Follow the authentication/config/claim structure of `score-answer`, but call only the new candidate scoring RPCs. Do not import or invoke legacy scoring parsers. Build provider content from the server claim; never trust browser transcript, prompt, rubric, contract, user ID, or scoring status. Persist only the validated public `MmiAssessment` and the claim lease token.

- [ ] **Step 4: Implement the browser scoring wrapper**

  `scoreCandidateResponse(sessionId, promptOrder)` invokes the exact Edge Function and maps only `in_progress`, `feedback_unavailable`, `provider_not_configured`, `provider_failed`, `invalid_provider_response`, `unauthorized`, and `unavailable`. It must not accept transcript text.

- [ ] **Step 5: Verify GREEN and regression safety**

  Run: `npx vitest run tests/candidateMmiScoring.test.ts tests/mmiScoringContract.test.ts tests/mmiContracts.test.ts tests/legacyScoringApi.test.ts`

  Expected: PASS; `supabase/functions/score-answer/index.ts` remains byte-for-byte unchanged.

- [ ] **Step 6: Commit the isolated task**

  Run branch-scoped `gitnexus detect-changes`. Stage only the four task paths and commit: `feat: score finalized candidate transcripts`.

### Task 5: Build the Candidate Preflight, Editable Response, and Feedback UI

**Files:**

- Modify: `app/practice/mmi-station.tsx`
- Modify: `tests/candidateMmiUiContract.test.ts`
- Modify: `e2e/cofounder-preview.spec.ts`

**Indexed symbol to check before editing:** `CandidateMmiStationScreen`.

- [ ] **Step 1: Run GitNexus impact analysis**

  Record the route/importer blast radius for `CandidateMmiStationScreen`. Stop and warn on HIGH or CRITICAL risk.

- [ ] **Step 2: Invert the old UI contract tests**

  Remove assertions that forbid `TextInput` and transcription. Require:

  - preflight disclosure that the browser vendor may remotely process microphone audio;
  - explicit statements that the app does not record/store audio and that transcript text is saved;
  - a `TextInput` only during response phases, with 12,000-code-point enforcement;
  - visible microphone states and **Resume microphone** recovery;
  - manual typing in unsupported/denied/unavailable states;
  - no `MediaRecorder`, camera/video, blob, upload, storage bucket, audio URL, or delivery-quality scoring language;
  - no microphone start in the scenario branch;
  - editor freeze before finalization at zero seconds.

- [ ] **Step 3: Extend Playwright controller fakes and write failing flows**

  Add a deterministic fake `SpeechRecognition` installed with `page.addInitScript`. It must emit `onstart`, interim/final results, `onend`, and named errors without accessing a real microphone.

  Add flows for:

  1. New-session preflight: no session RPC/timer until **Start station**; disclosure remains visible; successful preflight marks speech ready.
  2. Scenario: no recognition start and no transcript editor during all 60 seconds.
  3. Response: final speech fragment appears in the editable transcript; interim text is visibly distinct and not checkpointed; a manual edit is preserved by the next final fragment.
  4. Unsupported and permission-denied browsers: manual typing completes the response without blocking the station.
  5. Recognition `onend`: only the same active response restarts; response transition invalidates stale callbacks.
  6. Deadline: input and mic freeze at zero; finalize uses no transcript payload; a transient finalize error shows retry and does not reveal the next prompt; retry advances from the trusted server projection.
  7. Refresh: the current server draft and revision restore; microphone remains paused until a user clicks **Resume microphone**.
  8. Completion: scoring launches asynchronously per finalized non-empty response; the end screen polls and renders ordered feedback/no-response/unavailable states.
  9. Leave and flag disable: speech aborts, drafts are abandoned server-side, and the route returns safely.

- [ ] **Step 4: Run UI tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiUiContract.test.ts`

  Run: `npx playwright test e2e/cofounder-preview.spec.ts --grep "candidate"`

  Expected: FAIL because the route still renders prompt-only UI and constructs `createNoCaptureMediaPort`.

- [ ] **Step 5: Implement preflight without starting the timer**

  After the feature flag resolves, a route without `sessionId` renders disclosure and capability status. **Test microphone** calls speech preflight from that click. **Start with microphone** or **Start with typing** calls `runner.start()` only after the choice, then replaces the route with the server session ID. A restored route calls `runner.restore()` immediately but never auto-starts the microphone.

- [ ] **Step 6: Implement response transcript state and checkpointing**

  Create one reducer state per response identity from the projection's server draft/revision. Render committed text in `TextInput` and interim text in a separate live region. Dispatch manual and speech actions through the reducer.

  Checkpoint dirty committed text after a 2-second debounce and on input blur. Increment from the last server-accepted revision, keep one request in flight, and send a newer dirty revision after acknowledgement. On recoverable checkpoint failure, keep the local dirty marker and show a compact “Saving transcript…”/“Could not save yet” status without stopping speech or exposing raw errors.

- [ ] **Step 7: Implement deadline freeze and retry**

  When the monotonic countdown reaches zero, synchronously freeze the reducer and call `speech.stop({responseIdentity})` before starting finalization. Use the session/prompt UUID key from `sessionStorage`. Do not send a last transcript from the deadline handler. Keep the panel frozen with **Retry finalization** on failure; accept the next trusted projection only after success.

- [ ] **Step 8: Add async scoring and completion feedback**

  After successful finalization, fire the scorer only when `responseState === 'response'` and `scoringStatus === 'pending'`; never block prompt advance on its result. At `completed`, request feedback immediately and every three seconds while any status is `pending` or `in_progress`, stopping after 60 seconds or when all five entries become terminal. Render transcript-only feedback and label unavailable/no-response states plainly.

- [ ] **Step 9: Verify focused GREEN**

  Run: `npx vitest run tests/candidateMmiSpeech.test.ts tests/candidateMmiApi.test.ts tests/candidateMmiUiContract.test.ts`

  Run: `npx playwright test e2e/cofounder-preview.spec.ts --grep "candidate"`

  Run: `npm run typecheck`

  Expected: PASS. Playwright must use synthetic recognition only and request no real microphone/camera permission.

- [ ] **Step 10: Commit the isolated task**

  Run branch-scoped `gitnexus detect-changes`; confirm the route and expected test controller are the only affected flow. Stage only the three task files and commit: `feat: add browser speech candidate station UI`.

### Task 6: Align the Cofounder Release Gate and Run Full Verification

**Files:**

- Modify: `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md` only within the candidate MMI section
- Verify: all files changed by Tasks 1–5

- [ ] **Step 1: Update the existing release checklist**

  Add a browser matrix with current stable Chrome desktop, Edge desktop, Safari desktop, Chrome Android, and Safari iOS. Mark Web Speech as enhanced support only where the runtime capability probe succeeds; manual typing is the required compatibility baseline everywhere. Record that Chrome/Edge may use a vendor-hosted speech service, the app stores transcript text but no audio, camera is excluded, and feature enablement remains a deliberate release action.

  Add manual evidence items for permission allow/deny, unsupported API, OS/browser dictation fallback, recognition restart, refresh restore, five deadline transitions, finalize retry, end feedback, keyboard-only editing, screen-reader labels, mobile viewport, and reduced-motion behavior.

- [ ] **Step 2: Run formatting and static checks**

  Run: `git diff --check`

  Run: `npm run typecheck`

  Run: `npm run build`

  Expected: all PASS with no warnings introduced by this feature.

- [ ] **Step 3: Run the full automated suites**

  Run: `npm test`

  Run: `npm run test:e2e`

  Run: `npm run test:coverage`

  With the approved disposable-local environment exported, run: `npm run test:integration:mutating`

  Expected: all PASS and repository coverage remains at least 80% for statements, branches, functions, and lines.

- [ ] **Step 4: Run dependency and privacy scans**

  Run: `npm audit --omit=dev`

  Run focused searches proving there is no candidate-path `MediaRecorder`, `getUserMedia({ video`, audio blob/upload/storage field, transcript logging, or legacy `score-answer` invocation. Confirm no private prompt/transcript fixture was added outside synthetic tests.

  Expected: no high/critical production dependency finding and no forbidden candidate media path. Do not run `npm audit fix --force`.

- [ ] **Step 5: Perform final GitNexus scope verification**

  Run branch-scoped `gitnexus detect-changes` against `origin/feat/cofounder-ui-reliability`. Confirm all d=1 dependents of modified symbols were updated, affected processes are limited to candidate station start/response/completion, and no HIGH/CRITICAL warning was ignored.

- [ ] **Step 6: Review the complete diff without staging user work**

  Run: `git status --short --branch`, `git diff --stat`, and targeted diffs for every feature file. Confirm pre-existing unrelated changes remain unstaged. Verify the old `score-answer` function and the old normalized orchestration migration are unchanged.

- [ ] **Step 7: Commit only the release-checklist update**

  Stage only the candidate-section hunk in `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md`; because the file already contains user edits, use an explicit patch/index review and do not stage unrelated hunks. Commit: `docs: align cofounder speech station release gate`.

- [ ] **Step 8: Cofounder handoff**

  Report exact commit SHAs, test commands/results, coverage, supported/fallback browser behavior, privacy/storage behavior, and remaining external actions. State explicitly that hosted migration, Edge deployment, feature-flag enablement, and push were not performed and each requires separate approval.

---

## Acceptance Checklist

- [ ] A new user sees disclosure and chooses microphone or typing before the 11-minute timer begins.
- [ ] No microphone runs during the 60-second preparation phase.
- [ ] Each of five 120-second responses supports free browser speech recognition plus editable typing.
- [ ] Unsupported/denied/unavailable speech never blocks the station.
- [ ] Audio is never recorded, uploaded, stored, or referenced; camera remains out of scope.
- [ ] Only final speech fragments and manual edits enter the checkpointed transcript.
- [ ] Refresh restores the current server draft without resetting time or auto-starting the microphone.
- [ ] At every deadline the UI freezes and the server finalizes only the last pre-deadline accepted draft.
- [ ] Finalization is idempotent and empty drafts become `no_response`.
- [ ] Only owner-scoped, exact-shape projections are browser-readable; future/private content remains hidden.
- [ ] Scoring uses immutable transcript/prompt/rubric/contract snapshots and never evaluates delivery qualities.
- [ ] Missing rubric/provider or scoring failure cannot corrupt or block the timed station.
- [ ] End feedback shows five ordered terminal/pending states without leaking transcripts or assessor material.
- [ ] Feature flag remains fail-closed and hosted systems remain untouched until separately approved.
- [ ] Unit, integration, E2E, build, typecheck, coverage, audit, privacy scan, and GitNexus scope gates pass.
