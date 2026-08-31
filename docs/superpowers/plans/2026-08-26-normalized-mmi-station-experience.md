# Normalized MMI Station Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Repository-specific execution override:** Do not dispatch task subagents. The one persistent `quality_engineer` named for this session executes every edit, while the primary agent performs the stated review gates.

**Goal:** Add a disabled-by-default, server-authoritative 11-minute MMI station flow that normalizes the verified workbook data while preserving the existing flat-question practice flow.

**Architecture:** An additive migration creates verified normalized-import and candidate-session boundaries around the existing `mmi_stations` and `mmi_sub_questions` tables. A separate pure TypeScript scheduler and client runner consume fixed-shape server projections through a narrow media port, while a gated Expo route renders only the current phase. The database, not the browser, controls station selection, prompt disclosure, timing, ownership, and feature-flag enforcement.

**Tech Stack:** Expo Router and React Native Web, TypeScript, Node test runner, Vitest, Playwright, Supabase Postgres/RLS/security-definer RPCs, existing local-only workbook converter conventions, GitNexus.

**Spec:** `docs/superpowers/specs/2026-08-26-normalized-mmi-station-experience-design.md`

## Global Constraints

- Work only in `/Users/sanje/code/mmi/.worktrees/cofounder-ui-reliability` on `feat/cofounder-ui-reliability`; preserve all pre-existing tracked and untracked changes.
- One persistent `quality_engineer` owns all edits; the primary agent inspects, tests, integrates, and reviews; one final `quality_auditor` is read-only.
- Use `apply_patch` for edits; do not reset, clean, revert unrelated files, or create interim commits. Create only the final commit `feat: add timed MMI station orchestration` after every gate passes.
- Run GitNexus query/context and upstream impact analysis before editing each indexed symbol; stop and warn the user before a HIGH or CRITICAL impact edit; run `gitnexus detect-changes` before the final commit.
- Use only synthetic fixture text. Never put private workbook scenarios, prompts, criteria, cached answers, panel notes, workbook payloads, or logs in tracked source, documentation, tests, snapshots, or error messages.
- The verified source namespace is `med_interview_question_bank`; workbook SHA-256 is `903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`; candidate counts are 155 stations and 775 ordered sub-questions; exactly 10 panel rows remain outside the candidate flow.
- Do not delete or deactivate existing imported flat `questions` rows. The feature flag key is exactly `normalized_mmi_station_enabled`, defaults to disabled, and is enforced client-side and server-side.
- Candidate timing is exactly 60 seconds of scenario plus five sequential 120-second responses: total 660 seconds. Browser refresh/re-entry derives phase from server timestamps; future prompts are never returned early.
- Preserve and reassert the normalized-table security chain: `20260817000000_capture_mmi_content_schema.sql` initially granted broad access, then `20260817001000_mmi_student_content_api.sql` revoked direct `anon`/`authenticated` access and exposed fixed-shape preview RPCs. `tests/integration/mmiContentSecurity.integration.test.ts` already proves student/admin base-table denial; there are no production direct normalized-table callers.
- Do not add media capture, storage/upload, transcription, AI scoring, admin UX, analytics, CI/CD, Vercel, or hosted Supabase changes. Do not run `npm audit fix --force`.
- Hosted Supabase is read-only. Do not run hosted migration, DDL, DML, RPC, role, storage, secret, Cron, migration-history, deployment, or credential-gated test operations.

---

## File structure and interfaces

| File | Responsibility |
| --- | --- |
| `supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py` | Verified local-only generator for ignored normalized payloads and metadata-only manifest. |
| `supabase/imports/20260825_med_interview_question_bank/normalized-station-manifest.json` | Committed no-prompt-text counts, stable-ID hashes, timing, and artifact hashes. |
| `.gitignore` | Ignores every private normalized CSV/JSON payload while retaining the metadata manifest. |
| `supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql` | Additive import provenance, private ledger, candidate session records, secure RPCs, ACL/RLS changes, and postconditions. |
| `src/features/candidateMmi/types.ts` | Candidate-safe projection/phase types and opaque artifact reference. |
| `src/features/candidateMmi/schedule.ts` | Pure timing projection and exact phase boundary arithmetic. |
| `src/features/candidateMmi/mediaPort.ts` | Narrow capture-independent media interface plus Session 1 no-capture implementation. |
| `src/features/candidateMmi/api.ts` | Validated candidate-session RPC client and safe error mapping. |
| `src/features/candidateMmi/runner.ts` | Projection/media orchestration with refresh, expiry, and abort semantics. |
| `src/features/candidateMmi/featureFlag.ts` | Fail-closed app-config feature flag reader. |
| `app/practice/mmi-station.tsx` | Gated candidate UI with no typed-answer control. |
| `app/(tabs)/practice.tsx` | Existing Practice chooser extended only when the flag enables the new mode. |
| `tests/mmiCandidateSchedule.test.ts` | Node unit tests for exact scheduler and runner behavior. |
| `tests/candidateMmiApi.test.ts` | Vitest tests for fixed response shapes, safe errors, and flag parsing. |
| `tests/candidateMmiImportPolicy.test.ts` | No-private-text converter/manifest/migration policy contract. |
| `tests/integration/candidateMmiStation.integration.test.ts` | Disposable local Supabase import, RLS, session projection, refresh, expiry, and abort proof. |
| `e2e/cofounder-preview.spec.ts` | Synthetic candidate-flow and feature-disabled browser coverage. |
| `vitest.config.mts` | Includes new Vitest tests and coverage targets. |
| `vitest.mutation.config.mts` | Includes the local-only candidate integration test without weakening mutation safeguards. |

### Shared contracts

```ts
export const CANDIDATE_MMI_FEATURE_FLAG = 'normalized_mmi_station_enabled' as const;
export const CANDIDATE_MMI_PREP_SECONDS = 60 as const;
export const CANDIDATE_MMI_RESPONSE_SECONDS = 120 as const;
export const CANDIDATE_MMI_PROMPT_COUNT = 5 as const;
export const CANDIDATE_MMI_TOTAL_SECONDS = 660 as const;

export type CandidateMmiPhase =
  | { kind: 'scenario' }
  | { kind: 'response'; promptOrder: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'completed' }
  | { kind: 'abandoned' };

declare const completedResponseArtifactBrand: unique symbol;
export type CompletedResponseArtifactRef = string & {
  readonly [completedResponseArtifactBrand]: true;
};

export interface CandidateMmiMediaPort {
  prepare(input: { sessionId: string }): Promise<void>;
  beginResponse(input: { sessionId: string; promptOrder: 1 | 2 | 3 | 4 | 5 }): Promise<void>;
  finishResponse(): Promise<CompletedResponseArtifactRef | null>;
  abort(input: { sessionId: string; reason: 'leave' | 'expired' | 'feature_disabled' }): Promise<void>;
}
```

The RPC projection is a fixed object with `sessionId`, `stationId`,
`serverNow`, `phase`, `phaseStartedAt`, `phaseEndsAt`, `scenarioText`,
`promptOrder`, and `promptText`. `scenarioText` is present only in scenario;
`promptOrder` and `promptText` are present only in response; no future prompt,
rubric, cached answer, source payload, or table row is exposed.

### Task 1: Lock the private normalized-import contract

**Files:**

- Create: `supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py`
- Create: `supabase/imports/20260825_med_interview_question_bank/normalized-station-manifest.json`
- Modify: `.gitignore`
- Modify: `tests/medInterviewQuestionBankImport.test.ts`
- Create: `tests/candidateMmiImportPolicy.test.ts`

**Interfaces:**

- Consumes: the committed flat manifest plus exact ignored `questions-part-1.csv` and `questions-part-2.csv` artifacts, each verified by source identity, batch identity, row count, and SHA-256 before content is read. The original workbook is not locally retained.
- Produces: ignored `normalized-stations-part-*.json` payload artifacts and one committed metadata-only normalized manifest with `candidate_station_count: 155`, `candidate_sub_question_count: 775`, `panel_question_count: 10`, fixed 60/120 timing, and source/manifest hashes.

- [ ] **Step 1: Write failing policy tests before generator code**

  Add assertions that the new generator verifies the source filename and source SHA, accepts only source-owned `MMI_###`/`MMI_###_Q#` identities, rejects missing/inconsistent station grouping, produces exactly five orders `1..5`, excludes `PANEL_###`, and never creates fields or strings for criteria/model answers/panel notes. Assert the metadata manifest has no `scenario_text`, `question_text`, `model_answer`, `criteria`, or `panel_note` key and uses only counts, IDs/hashes, and timing.

- [ ] **Step 2: Run the new policy tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiImportPolicy.test.ts tests/medInterviewQuestionBankImport.test.ts`

  Expected: FAIL because the normalized generator and manifest do not exist.

- [ ] **Primary review checkpoint: approve the RED contract**

  Give the primary agent the failing command output and the exact no-private-text assertions. Do not create the generator until the primary confirms the failure represents the missing contract rather than an environment issue.

- [ ] **Step 3: Implement only the verified local converter and metadata manifest**

  Add a separate standard-library Python converter. It must verify the committed flat manifest and both private flat CSV artifact hashes before reading either payload, group only by source-owned `MMI_###/MMI_###_Q#` identity, and exclude source-owned `PANEL_###` records. It may split the legacy combined text only after grouping by provenance, at the deterministic `"\n\n"` delimiter, and must reject any group without five ordered rows or one identical scenario prefix. It writes private ignored JSON payloads and verifies a tracked metadata manifest that contains no prompt payload. Add exact ignore rules for every private normalized payload path; retain existing flat artifact rules unchanged.

- [ ] **Step 4: Run policy tests to verify GREEN**

  Run: `npx vitest run tests/candidateMmiImportPolicy.test.ts tests/medInterviewQuestionBankImport.test.ts`

  Expected: PASS, with no generated private payload added to Git.

- [ ] **Step 5: Inspect tracked payload boundaries**

  Run: `git status --short && git ls-files supabase/imports/20260825_med_interview_question_bank`

  Expected: only the generator and metadata manifest are tracked; all private normalized payload artifacts remain ignored/untracked.

### Task 2: Add pure candidate timing and media contracts

**Files:**

- Create: `src/features/candidateMmi/types.ts`
- Create: `src/features/candidateMmi/schedule.ts`
- Create: `src/features/candidateMmi/mediaPort.ts`
- Create: `tests/mmiCandidateSchedule.test.ts`

**Interfaces:**

- Consumes: shared constants and types in this plan.
- Produces: `projectCandidateMmiPhase(startedAt: Date, serverNow: Date): CandidateMmiPhaseProjection`, `secondsRemaining(projection, serverNow): number`, and `createNoCaptureMediaPort(): CandidateMmiMediaPort`.

- [ ] **Step 1: Write failing Node unit tests**

  Test elapsed times `0`, `59`, `60`, `179`, `180`, `299`, `300`, `419`, `420`, `539`, `540`, `659`, and `660`. Assert the exact scenario/response/completed phase, orders `1..5`, phase end, and total 660 seconds. Test that the no-capture port returns `null` from `finishResponse`, does not expose a recorder implementation, and that the opaque reference type cannot be created from arbitrary UI state.

- [ ] **Step 2: Run the focused Node test and record RED evidence**

  Run: `node --test tests/mmiCandidateSchedule.test.ts`

  Expected: FAIL because the candidate feature modules are absent.

- [ ] **Primary review checkpoint: approve timing boundaries**

  Provide the primary the boundary table and failing result. Confirm that `[60, 180)` is response 1 and `[660, infinity)` is completed before implementing.

- [ ] **Step 3: Implement minimal immutable pure contracts**

  Implement the constants, discriminated phase projection, countdown helper, branded opaque artifact type, and no-capture media port. Do not import `src/features/mmi`, `MediaRecorder`, camera APIs, storage, upload, transcription, or scoring packages.

- [ ] **Step 4: Run the focused Node test to verify GREEN**

  Run: `node --test tests/mmiCandidateSchedule.test.ts`

  Expected: PASS.

### Task 3: Build the additive normalized-import and session security boundary

**Files:**

- Create: `supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql`
- Create: `tests/candidateMmiImportPolicy.test.ts` (extend)
- Create: `tests/integration/candidateMmiStation.integration.test.ts`
- Modify: `vitest.mutation.config.mts`

**Interfaces:**

- Consumes: normalized private import payload objects with station provenance, five ordered synthetic sub-question records, existing flat source identities, the SHA-256 of the tracked metadata-only normalized manifest, and the reviewed SHA-256 for each private payload artifact.
- Produces: private `mmi_normalized_station_import_batches`, service-role-only `import_normalized_mmi_station_batch(...)` and `finalize_normalized_mmi_station_import(...)`, user-owned `candidate_mmi_station_sessions`, and authenticated `start_candidate_mmi_station_session()`, `get_candidate_mmi_station_session(uuid)`, and `abandon_candidate_mmi_station_session(uuid)` RPCs. Finalization returns only a fixed metadata proof (counts/orders/panel exclusion/flat preservation), never station or prompt payloads.

- [ ] **Step 1: Write failing static policy and disposable integration tests**

  Add static assertions for additive table changes, fixed search paths, `SECURITY DEFINER`, RLS, preservation/reassertion of the established `20260817001000` browser direct-table revocation, exact RPC grants, feature flag default `false`, and no migration top-level workbook payload. Extend the existing base-table-denial proof with candidate current-phase-only RPC assertions. Add a local integration fixture with synthetic scenario/prompt markers that proves 155 stations, 775 candidates, five ordered prompts per station, 10 panel rows excluded, and all pre-existing 785 flat provenance rows remain active. Add rejection tests for missing manifest, inconsistent batch identity, invalid order/count/timing, a candidate panel ID, and flat provenance mismatch.

- [ ] **Step 2: Run static and local integration tests and record RED evidence**

  Run: `npx vitest run tests/candidateMmiImportPolicy.test.ts`

  With the repository's existing disposable-local mutation environment exported, run: `npm run test:integration:mutating`

  Expected: policy test fails because the migration is absent; local integration test fails because candidate tables/RPCs are absent. The mutation command must fail closed before collection if its local-only prerequisites are not present; never print credential values.

- [ ] **Primary review checkpoint: approve SQL security scope**

  Show the primary the exact planned tables, RPC names, grants, and failed tests. The primary must explicitly confirm the new migration preserves the existing `20260817001000` direct-read denial, that there are no production direct normalized-table callers, and that no HIGH/CRITICAL GitNexus impact was ignored.

- [ ] **Step 3: Implement the forward-only migration**

  Add provenance/batch columns without deleting or deactivating `questions`; create private import ledger/session tables; add validated import/finalize RPCs; require source namespace, source/manifest hashes, the tracked normalized-manifest SHA-256, each reviewed artifact SHA-256, exact station/sub-question IDs, and a one-to-one existing flat provenance join. Enforce a partial unique identity across all non-null normalized flat links, 60-second station prep, and five 120-second orders. Keep panel IDs out of normalized flow. Imports stage stations as drafts; only atomic 155/775/10 verification finalizes both reviewed batches and publishes the complete set.

  Add `normalized_mmi_station_enabled` as non-secret app config with default disabled. Candidate RPCs must return a safe `feature_disabled` error unless the value is exactly enabled. Use a per-user advisory transaction lock and immutable trusted `started_at` to resume a caller's non-expired same-station session rather than reset its timer. Return only scenario/current prompt; never return all sub-questions. Make abort ownership-checked and idempotent. Reassert the existing `20260817001000` direct-table revocation and add SQL postcondition assertions for owner, security-definer, search path, grants, RLS, direct-table denial, and fixed response shape.

- [ ] **Step 4: Run static and local integration tests to verify GREEN**

  Run: `npx vitest run tests/candidateMmiImportPolicy.test.ts`

  With the repository's existing disposable-local mutation environment exported, run: `npm run test:integration:mutating`

  Expected: PASS. The local proof must report exactly 155 stations, 775 candidate prompts, five orders per station, 10 panels excluded, and 785 active flat rows preserved.

### Task 4: Add the typed, safe candidate RPC client and runner

**Files:**

- Create: `src/features/candidateMmi/api.ts`
- Create: `src/features/candidateMmi/runner.ts`
- Create: `src/features/candidateMmi/featureFlag.ts`
- Create: `tests/candidateMmiApi.test.ts`
- Modify: `vitest.config.mts`

**Interfaces:**

- Consumes: `CandidateMmiMediaPort`, `CandidateMmiPhaseProjection`, `CompletedResponseArtifactRef`, and the three RPCs from Task 3.
- Produces: `createCandidateMmiApi(rpc)`, `createCandidateMmiRunner(api, mediaPort)`, `isNormalizedMmiStationEnabled(readConfig)`, and safe error type `CandidateMmiApiError`.

- [x] **Step 1: Write failing Vitest tests**

  Test that only the fixed safe projection shape parses; a response containing a future prompt array, rubric, model answer, or unknown field is rejected. Test false for missing, unavailable, malformed, false, and non-string config values; true only for exact enabled value. Test refresh/re-entry calls `get` and derives state from returned timestamps rather than resetting. Test expiry calls `finishResponse` once then re-reads projection, early `finishResponse` does not request/reveal a later prompt, and repeated leave calls `abort` safely once before the idempotent server abort.

- [x] **Step 2: Run the focused Vitest test and record RED evidence**

  Run: `npx vitest run tests/candidateMmiApi.test.ts`

  Expected: FAIL because the candidate API, runner, and feature-flag modules are absent.

- [ ] **Primary review checkpoint: approve client trust boundary**

  Show the primary the response-schema rejection tests and runner call-order tests. Confirm client time is display-only and the server projection wins after every re-entry/expiry condition.

- [x] **Step 3: Implement minimal validated API and orchestration**

  Implement an injected RPC client with exact request arguments and an allowlisted error mapper. Implement the runner so `prepare` runs before a response, `beginResponse` runs only for the current response phase, `finishResponse` yields only an opaque reference or `null`, and `abort` accepts only leave/expiry/feature-disabled reasons. Implement flag reads through existing non-secret `app_config` access and treat all read failures as disabled.

- [x] **Step 4: Run the focused Vitest test to verify GREEN**

  Run: `npx vitest run tests/candidateMmiApi.test.ts`

  Expected: PASS.

### Task 5: Add the gated no-text-input station UI

**Files:**

- Create: `app/practice/mmi-station.tsx`
- Modify: `app/(tabs)/practice.tsx`
- Modify: `tests/navigation.test.ts`
- Modify: `tests/uiContracts.test.ts`

**Interfaces:**

- Consumes: `isNormalizedMmiStationEnabled`, `createCandidateMmiRunner`, `createNoCaptureMediaPort`, and candidate phase projections.
- Produces: a feature-gated Practice chooser option and the `/practice/mmi-station` route.

- [ ] **Step 1: Run GitNexus impact analysis before existing-symbol edits**

  Run the repository-local GitNexus context and upstream impact commands for `PracticeScreen`, `handleStart`, and `MODES`. Record direct callers, affected flows, and risk. If any result is HIGH or CRITICAL, warn the user and wait before editing.

- [ ] **Step 2: Write failing UI/navigation tests**

  Add static/UI contract assertions that the candidate route imports the candidate runner, has no `TextInput`, `answerText`, or legacy scoring call, and has a leave/abort control. Assert the Practice chooser shows exactly the legacy options while disabled and exposes the named 11-minute station option only when the flag test double enables it. Assert legacy `router.push('/practice/session')` behavior remains available for free/timed modes.

- [ ] **Step 3: Run focused tests and record RED evidence**

  Run: `npx vitest run tests/navigation.test.ts tests/uiContracts.test.ts`

  Expected: FAIL because the candidate route and feature-gated option are absent.

- [ ] **Primary review checkpoint: approve fallback preservation**

  Show the primary the disabled-state test and the proof that the legacy typed-answer route is not being replaced. Confirm the direct candidate route checks the flag before session creation.

- [ ] **Step 4: Implement the minimal gated UI**

  Add the candidate route with scenario/current-prompt display, trusted countdown, loading/retry/feature-disabled/completed/abandoned states, and leave confirmation. Use no typed-answer widget. Extend `PracticeScreen` by loading the one flag and adding the candidate option only when enabled; retain existing mode/category selection and legacy start path otherwise.

- [ ] **Step 5: Run focused tests to verify GREEN**

  Run: `npx vitest run tests/navigation.test.ts tests/uiContracts.test.ts`

  Expected: PASS.

### Task 6: Prove browser flow with synthetic E2E fixtures

**Files:**

- Modify: `e2e/cofounder-preview.spec.ts`

**Interfaces:**

- Consumes: synthetic app-config and candidate RPC responses; no private workbook data and no hosted network.
- Produces: Playwright evidence for enabled candidate flow and disabled legacy fallback.

- [ ] **Step 1: Run GitNexus impact analysis before editing the E2E mock helper**

  Run the repository-local GitNexus context and upstream impact commands for `installSupabaseMocks`. Record its risk and affected tests. If HIGH or CRITICAL, warn the user and wait.

- [ ] **Step 2: Write failing E2E tests and mock only synthetic data**

  Add tests that enable the synthetic flag, start an 11-minute candidate station, see only the synthetic scenario before 60 seconds, then exactly response orders 1 through 5 at the synthetic boundaries, never see a future marker, survive a page reload by using server timestamps, complete at 660 seconds, and leave through abort. Add a disabled-flag test that retains the legacy Practice chooser and cannot open the candidate route. Assert no textbox is present in the candidate page.

- [ ] **Step 3: Run focused Playwright test and record RED evidence**

  Run: `npx playwright test e2e/cofounder-preview.spec.ts --grep "candidate MMI|feature-disabled fallback"`

  Expected: FAIL because candidate routes and synthetic RPC handling are absent.

- [ ] **Primary review checkpoint: approve E2E secrecy proof**

  Show the primary that every marker is synthetic and that the future-prompt assertion checks both scenario and active-response phases. Confirm all Supabase hosts remain intercepted and no shared infrastructure is contacted.

- [ ] **Step 4: Implement the smallest synthetic mock extensions required by the tests**

  Extend `installSupabaseMocks` only with exact app-config and candidate RPC endpoints. Return fixed-shape synthetic projections and use synthetic clock controls; preserve existing legacy E2E fixtures and wildcard fail-closed host interception.

- [ ] **Step 5: Run focused Playwright test to verify GREEN**

  Run: `npx playwright test e2e/cofounder-preview.spec.ts --grep "candidate MMI|feature-disabled fallback"`

  Expected: PASS.

### Task 7: Fresh local proof and full verification

**Files:**

- Modify only if a failing verification proves a scoped defect in an already-planned file.

**Interfaces:**

- Consumes: completed migration, private local normalized artifacts, synthetic tests, and disposable local Supabase credentials.
- Produces: reproducible verification evidence without hosted access.

- [ ] **Step 1: Re-run the fresh isolated local migration/import sequence**

  Start or reset only the disposable local Supabase/Postgres environment according to the repository’s mutation-test safety contract. Apply the complete local migration chain including `20260826000000_normalized_mmi_station_orchestration.sql`, generate private local normalized payloads from the verified workbook, run the normalized import/finalization operation, and execute the local integration suite. Do not call any linked/hosted command.

  Run: `npm run test:integration:mutating`

  Expected: PASS; output/evidence proves 155 stations, 775 sub-questions, exactly five ordered prompts per station, 10 panels excluded, and 785 flat rows preserved/active.

- [ ] **Step 2: Run complete Node/Vitest suites and coverage**

  Run: `npm test`

  Run: `npm run test:coverage`

  Expected: PASS with each configured coverage threshold at least 80 percent.

- [ ] **Step 3: Run typecheck, production build, and full E2E**

  Run: `npm run typecheck`

  Run: `npm run build`

  Run: `npm run test:e2e`

  Expected: all commands PASS. E2E remains synthetic and does not contact hosted Supabase.

- [ ] **Step 4: Run repository integrity and security checks**

  Run: `git diff --check`

  Run: `git grep -nEi 'med_interview_question_bank.*(scenario_text|question_text|model_answer|criteria|panel_note)|MediaRecorder|navigator\.mediaDevices' -- ':!supabase/imports/20260825_med_interview_question_bank/generate_import.py'`

  Run the repository-approved secret scan and `npm audit --omit=dev`; classify findings, do not auto-fix, and never run `npm audit fix --force`.

  Expected: no whitespace errors, no private workbook payload added, no capture implementation, no newly introduced secret, and no unaddressed Critical/High security issue.

- [ ] **Primary review checkpoint: inspect every final change**

  The primary independently reviews `git diff`, all test outputs, migration security postconditions, coverage, E2E evidence, and untracked-file preservation. Address every Primary Critical/High finding before the audit.

### Task 8: Final read-only audit, change detection, single commit, and push

**Files:**

- Modify: only intended tracked files already created/changed in Tasks 1–6; do not add private artifacts or unrelated files.

**Interfaces:**

- Consumes: clean verification evidence and the final diff.
- Produces: audited single commit and branch push, if the audit has no unresolved Critical/High finding.

- [ ] **Step 1: Request the independent read-only audit**

  Give the final diff and verification evidence to exactly one `quality_auditor`. The auditor may inspect but must not edit. Resolve every Critical or High finding with the persistent `quality_engineer`, then re-run the affected RED/GREEN and verification commands.

- [ ] **Step 2: Run GitNexus change detection before staging**

  Run: `node .gitnexus/run.cjs detect-changes --scope all`

  If the helper is unavailable, run the installed GitNexus CLI against this worktree and branch with `detect-changes --scope all`. Expected: only the planned candidate-MMI import, data, API, runner, UI, test, and documentation surfaces/flows are affected.

- [ ] **Step 3: Stage only intended tracked files and create the one final commit**

  Inspect: `git status --short && git diff --cached --check`

  Stage exact intended paths; exclude `.DS_Store`, `.impeccable/`, `supabase/.branches/`, private payload artifacts, and all unrelated user changes. Commit exactly:

  Run: `git commit -m "feat: add timed MMI station orchestration"`

  Expected: one new commit with only intended tracked changes.

- [ ] **Step 4: Push only after the audit and local verification are clean**

  Run: `git push origin feat/cofounder-ui-reliability`

  Expected: branch push succeeds. Do not deploy or invoke hosted Supabase.

- [ ] **Step 5: Report the unexecuted hosted next operation**

  Report the final changed files, test/coverage outputs, local 155/775/10 proof, audit result, commit SHA, and push result. Present the exact unexecuted next hosted operation: apply `supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql`, then invoke the verified normalized import/finalization RPC using the final private artifact hashes and expected 155/775/10 counts. Explain that it adds normalized candidate data and its secure session boundary while preserving all 785 flat rows. Do not execute it without a new exact approval.

## Plan self-review

- Spec coverage: Tasks 1 and 3 cover provenance, 155/775/10 grouping, panel exclusion, forward-only coexistence, and fail-closed import; Tasks 2 and 4 cover the 660-second timer, refresh, expiry, media port, and opaque artifact; Tasks 5 and 6 cover feature-gated UI, no typed input, fallback, and E2E; Tasks 7 and 8 cover all required verification, audit, commit, push, and unexecuted hosted operation report.
- Completeness scan: this plan contains no deferred implementation marker or undefined interface. The existing mutation-test safety contract supplies only disposable local credentials at execution time and fails closed otherwise.
- Type consistency: `CandidateMmiMediaPort`, `CompletedResponseArtifactRef`, phase order `1 | 2 | 3 | 4 | 5`, and feature flag key are defined once above and reused consistently in every task.
- Scope check: this is Session 1 only. Capture, upload, AI scoring, and deployment remain excluded.
