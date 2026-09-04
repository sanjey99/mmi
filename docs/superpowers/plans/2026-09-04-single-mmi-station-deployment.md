# Single MMI Station Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one authenticated 11-minute MMI station that displays a scenario-only brief, captures five timed transcript responses, and returns real AI feedback without a release flag or human approval gate.

**Architecture:** Keep the existing normalized question domain and server-authoritative station clock. Remove the legacy practice choice and every active flag check, then score the five finalized responses only after the station finishes using one built-in server-side scoring contract. Apply the forward migration and Edge function only to the isolated Supabase project, deploy the exact verified commit to Vercel Preview, and record the resulting URL and SHA.

**Tech Stack:** Expo Router, React Native Web, TypeScript, Vitest, Node test runner, Playwright, PostgreSQL/Supabase migrations and RPCs, Supabase Edge Functions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-04-single-mmi-station-deployment-design.md`

## Global Constraints

- Every invited, signed-in user gets the same MMI station; there is no founder, cofounder, candidate, or review access mode.
- Delete the active `normalized_mmi_station_enabled` contract; do not rename it or replace it with another switch.
- The source Sheet mapping is fixed: `stations.scenario_text` is the 60-second brief; `sub_questions.question_text`, joined by `station_id` and ordered `1..5`, supplies the five 120-second questions.
- The preparation phase exposes no question, response control, transcript, scoring criteria, model answer, or future prompt.
- Microphone transcription and typed input are peers; denial or lack of browser speech support never blocks typing.
- Store transcript text for recovery and scoring, but never record, upload, or persist raw audio.
- Begin AI evaluation after response five is finalized; show no score or coaching during the timed station.
- AI results must pass the existing strict schema before persistence; never synthesize fallback scores.
- A scoring failure preserves the completed station and supports retry without rerunning the timer.
- Use isolated Supabase project `obfwfoykalvoxqdnosus`; never mutate shared project `tliwifhnsytxpcynuwsy`.
- Work is reviewable only after exact-SHA verification, push, isolated Supabase deployment, Vercel Preview deployment, authenticated smoke testing, and URL handoff.
- Preserve unrelated local changes in `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.impeccable/`, `.DS_Store`, and `supabase/.branches/`.

---

### Task 1: Lock the Sheet-to-database content boundary

**Files:**
- Modify: `tests/candidateMmiImportPolicy.test.ts`
- Modify: `tests/candidateMmiApi.test.ts`
- Verify: `supabase/imports/20260825_med_interview_question_bank/generate_import.py`
- Verify: `supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py`

**Interfaces:**
- Consumes: source Sheet tabs `stations` and `sub_questions`, linked by `station_id`.
- Produces: the invariant `scenario_text -> scenarioText` and `question_text -> promptText`, with sub-question orders `1..5`.

- [ ] **Step 1: Add failing source-mapping assertions**

Add a test that reads both import generators and requires the original workbook fields to remain distinct in normalized output:

```ts
it('maps the station scenario separately from five ordered sub-questions', () => {
  expect(flatGenerator).toContain("station['scenario_text']");
  expect(flatGenerator).toContain("sub_question['question_text']");
  expect(normalizedGenerator).toContain("'scenario_text': scenario_text");
  expect(normalizedGenerator).toContain("'question_text': question_text");
  expect(normalizedManifest.normalized_flow.sub_question_orders).toEqual([1, 2, 3, 4, 5]);
});
```

- [ ] **Step 2: Add failing API projection assertions**

Extend the parser tests with distinct synthetic markers. The scenario projection must accept only `scenarioText`, and the response projection must accept only `promptText`:

```ts
expect(parseScenarioProjection({ ...base, phase: 'scenario', scenarioText: 'SCENARIO_ONLY' }))
  .toMatchObject({ phase: 'scenario', scenarioText: 'SCENARIO_ONLY' });
expect(() => parseScenarioProjection({ ...base, phase: 'scenario', scenarioText: 'SCENARIO_ONLY', promptText: 'Q1_ONLY' }))
  .toThrow();
expect(parseResponseProjection({ ...base, phase: 'response', promptOrder: 1, promptText: 'Q1_ONLY' }))
  .toMatchObject({ phase: 'response', promptOrder: 1, promptText: 'Q1_ONLY' });
```

- [ ] **Step 3: Run the focused tests**

Run:

```bash
npx vitest run tests/candidateMmiImportPolicy.test.ts tests/candidateMmiApi.test.ts
```

Expected: the new public parser assertions fail if the parsers are not exported through a testable boundary; existing import assertions pass.

- [ ] **Step 4: Export testable parsers without widening runtime data**

Expose immutable test-only-compatible parser functions from `src/features/candidateMmi/api.ts`; do not add scenario and prompt fields to the same projection type. Keep the exact-key validation already used by `parseProjection`.

- [ ] **Step 5: Re-run the focused tests**

Run the command from Step 3. Expected: PASS, including the synthetic `SCENARIO_ONLY`/`Q1_ONLY` separation.

- [ ] **Step 6: Commit**

```bash
git add tests/candidateMmiImportPolicy.test.ts tests/candidateMmiApi.test.ts src/features/candidateMmi/api.ts
git commit -m "test: lock the MMI brief and question boundary"
```

### Task 2: Replace the practice split with one station entry

**Files:**
- Modify: `tests/candidateMmiUiContract.test.ts`
- Modify: `app/(tabs)/practice.tsx`
- Modify: `app/practice/session.tsx`
- Modify: `app/practice/mmi-station.tsx`
- Delete: `src/features/candidateMmi/featureFlag.ts`

**Interfaces:**
- Consumes: route `/practice/mmi-station` and `createCandidateMmiRunner.start()`/`restore(sessionId)`.
- Produces: one user-visible `11-minute MMI station` entry; legacy `/practice/session` redirects to `/(tabs)/practice`.

- [ ] **Step 1: Replace the gated UI tests with single-flow tests**

Require the Practice page to contain the neutral station label and route while excluding the flag reader, legacy mode labels, random flat-question loader, and legacy session route:

```ts
expect(practiceSource).toContain('11-minute MMI station');
expect(practiceSource).toContain('/practice/mmi-station');
expect(practiceSource).not.toMatch(/isNormalizedMmiStationEnabled|candidateEnabled|app_config/);
expect(practiceSource).not.toMatch(/Free practice|Timed practice|getRandomQuestion|\/practice\/session/);
expect(legacySessionSource).toContain("router.replace('/(tabs)/practice')");
```

Also require the station route to omit flag state and candidate-only error copy:

```ts
expect(stationSource).not.toMatch(/isNormalizedMmiStationEnabled|feature_disabled|candidate station/i);
expect(stationSource).toMatch(/scenarioText/);
expect(stationSource).toMatch(/promptText/);
```

- [ ] **Step 2: Run the UI contract test and confirm RED**

```bash
npx vitest run tests/candidateMmiUiContract.test.ts
```

Expected: FAIL because the current Practice page still offers three modes and reads the release flag.

- [ ] **Step 3: Simplify the Practice page**

Remove `MODES`, `CATEGORIES`, the flag query, flat-question counts, and legacy `startSession` path. Render one station card and one action:

```tsx
const handleStart = () => router.push('/practice/mmi-station' as never);

<Text style={styles.title}>MMI practice</Text>
<Text style={styles.modeName}>11-minute MMI station</Text>
<Text style={styles.modeDesc}>1-minute brief, then five 2-minute questions.</Text>
<Button label="Enter station" onPress={handleStart} />
```

Retain `ScreenWrapper`, accessible text hierarchy, and existing visual tokens.

- [ ] **Step 4: Redirect the legacy session page**

Replace the legacy response surface with a small authenticated redirect component. It may render a loading message while this effect runs:

```tsx
useEffect(() => {
  router.replace('/(tabs)/practice');
}, []);
```

Do not translate a legacy `sessionId` into a normalized session ID.

- [ ] **Step 5: Remove the route-level flag**

In `app/practice/mmi-station.tsx`, delete the `enabled` state and `app_config` effect. Restore an existing session whenever a valid `sessionId` is present; otherwise show the microphone/disclosure setup and start normally. Delete `src/features/candidateMmi/featureFlag.ts`.

- [ ] **Step 6: Run UI and type checks**

```bash
npx vitest run tests/candidateMmiUiContract.test.ts tests/candidateMmiApi.test.ts
npm run typecheck
```

Expected: PASS with no client import or read of `normalized_mmi_station_enabled`.

- [ ] **Step 7: Commit**

```bash
git add 'app/(tabs)/practice.tsx' app/practice/session.tsx app/practice/mmi-station.tsx src/features/candidateMmi/featureFlag.ts tests/candidateMmiUiContract.test.ts
git commit -m "feat: expose one MMI station flow"
```

### Task 3: Remove the database release and approval gates

**Files:**
- Create: `supabase/migrations/20260904000000_single_mmi_station.sql`
- Modify: `tests/candidateMmiUiContract.test.ts`
- Modify: `tests/integration/candidateMmiStation.integration.test.ts`

**Interfaces:**
- Consumes: existing authenticated RPC signatures and normalized `mmi_stations`/`mmi_sub_questions` content.
- Produces: current RPC definitions with authentication/ownership enforcement but no `app_config`, privacy-notice-row, or `mmi_scoring_rubrics` dependency.

- [ ] **Step 1: Add failing migration-policy assertions**

Point a new test helper at `20260904000000_single_mmi_station.sql` and require:

```ts
expect(sql).toMatch(/DELETE FROM public\.app_config\s+WHERE key = 'normalized_mmi_station_enabled'/i);
expect(sql).not.toMatch(/feature_disabled|clinician_reviewed|JOIN public\.mmi_scoring_rubrics/i);
expect(sql).toMatch(/question\.question_text/i);
expect(sql).toMatch(/question\.order_num/i);
expect(sql).toMatch(/SET search_path = public, pg_temp/g);
```

Keep assertions for authenticated ownership, service-role-only scoring claims, exact function grants, RLS, and direct table denial.

- [ ] **Step 2: Add failing local integration cases**

Create a synthetic station with `scenario_text = 'SCENARIO_ONLY'` and questions `Q1_ONLY` through `Q5_ONLY`, with no privacy notice and no `mmi_scoring_rubrics` rows. Assert:

```ts
assert.equal(started.phase, 'scenario');
assert.equal(started.scenarioText, 'SCENARIO_ONLY');
assert.equal('promptText' in started, false);
assert.equal(firstResponse.phase, 'response');
assert.equal(firstResponse.promptText, 'Q1_ONLY');
assert.equal('scenarioText' in firstResponse, false);
```

Also prove a second user cannot restore, checkpoint, finalize, abandon, or read feedback for the first user's session.

- [ ] **Step 3: Run the policy test and confirm RED**

```bash
npx vitest run tests/candidateMmiUiContract.test.ts
```

Expected: FAIL because the forward migration does not exist.

- [ ] **Step 4: Write the forward migration**

Begin a transaction, delete the obsolete config row, and replace these current function definitions without flag checks:

```sql
BEGIN;

DELETE FROM public.app_config
WHERE key = 'normalized_mmi_station_enabled';

-- Recreate with the existing authentication, ownership, timing,
-- idempotency, RLS, fixed search_path, and grant behavior intact:
-- start_candidate_mmi_station_session()
-- get_candidate_mmi_station_session(uuid)
-- checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint)
-- finalize_candidate_mmi_station_response(uuid, smallint, uuid)
-- get_candidate_mmi_station_feedback(uuid)
-- abandon_candidate_mmi_station_session(uuid)
-- claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid)
-- purge_expired_candidate_mmi_free_text(timestamptz)

COMMIT;
```

For `start_candidate_mmi_station_session()`, select one published normalized station with exactly five ordered questions and snapshot only `sub_q_id`, `order_num`, and `question_text`. Do not query `mmi_privacy_notices` or `mmi_scoring_rubrics`. Leave historical nullable snapshot columns null.

For `claim_candidate_mmi_response_scoring(...)`, require the owned session to be complete and all five response windows to be finalized before granting any scoring lease. A direct Edge request before the server-owned 660-second completion boundary returns a safe not-ready result and never reaches the provider.

For transcript retention, replace the notice join with a fixed seven-day private-text window:

```sql
AND response.finalized_at < p_now - interval '7 days';
```

Delete drafts older than seven days with the same fixed interval. Do not delete scores or aggregate feedback.

- [ ] **Step 5: Preserve the security boundary in SQL postconditions**

The migration must fail atomically unless all current functions have the expected owner, `SECURITY DEFINER` setting, `search_path`, grants, and direct-table revocations. It must also assert the obsolete config row count is zero and all 155 published stations still have five ordered prompts.

- [ ] **Step 6: Run policy and local database tests**

```bash
npx vitest run tests/candidateMmiUiContract.test.ts
npm run test:integration:mutating
```

Expected: PASS; station start succeeds without flag, notice, or per-question scoring rows, and cross-account access remains denied.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260904000000_single_mmi_station.sql tests/candidateMmiUiContract.test.ts tests/integration/candidateMmiStation.integration.test.ts
git commit -m "feat: remove MMI database release gates"
```

### Task 4: Make the AI criteria built-in and server-owned

**Files:**
- Modify: `supabase/functions/_shared/mmiScoringContract.ts`
- Modify: `supabase/functions/score-candidate-mmi-response/handler.ts`
- Modify: `src/features/candidateMmi/scoringApi.ts`
- Modify: `tests/mmiContracts.test.ts`
- Modify: `tests/candidateMmiScoring.test.ts`

**Interfaces:**
- Consumes: claimed server-owned `promptText` and finalized `transcript`.
- Produces: `getCurrentMmiRubric(): MmiRubric`, scoring contract version `2026-09-04.1`, and schema-validated public assessment output.

- [ ] **Step 1: Write failing built-in criteria tests**

Require the current scoring module to provide one immutable five-dimension rubric with ten criteria and no review metadata:

```ts
const rubric = getCurrentMmiRubric();
expect(rubric.version).toBe(2);
expect(Object.values(rubric.dimensionWeights).reduce((sum, value) => sum + value, 0)).toBe(1);
expect(new Set(Object.values(rubric.criteria).map(item => item.dimension)))
  .toEqual(new Set(MMI_DIMENSIONS));
expect(JSON.stringify(rubric)).not.toMatch(/clinician|reviewed|approved/i);
expect(Object.isFrozen(rubric)).toBe(true);
```

Update the handler fixture so a claimed response contains only `status`, `responseId`, `sessionId`, `promptOrder`, `transcript`, and `promptText`.

- [ ] **Step 2: Run scoring tests and confirm RED**

```bash
npx vitest run tests/mmiContracts.test.ts tests/candidateMmiScoring.test.ts
```

Expected: FAIL because `getCurrentMmiRubric` and contract `2026-09-04.1` do not exist and the current claim expects database snapshots.

- [ ] **Step 3: Add the built-in rubric and current contract**

In `_shared/mmiScoringContract.ts`, add an immutable rubric with equal dimension weights and paired strength/improvement criteria for structure, ethics, communication, reflection, and NHS awareness. Add contract `2026-09-04.1` whose assessor instructions say to evaluate only the supplied transcript against the current question, accept valid alternative reasoning, avoid delivery/accent inference, and return only the strict JSON schema.

Keep the old contract readable for existing stored results, but make `CURRENT_MMI_SCORING_CONTRACT_VERSION` equal `2026-09-04.1`. Do not include reviewer identity, approval state, or per-question activation.

- [ ] **Step 4: Make the Edge function own scoring inputs**

Change the claimed response type to:

```ts
type ClaimedResponse = Readonly<{
  status: 'claimed';
  responseId: string;
  sessionId: string;
  promptOrder: number;
  transcript: string;
  promptText: string;
}>;
```

The handler loads `getCurrentMmiScoringContract()` and `getCurrentMmiRubric()` locally, creates the provider request from those constants plus the claimed prompt/transcript, validates the provider response, converts it to public feedback, and persists only that validated result. Remove `feature_disabled` and `feedback_unavailable` as successful scoring outcomes; keep `no_response`, `in_progress`, provider errors, and retryable failure state.

- [ ] **Step 5: Update client-safe scoring errors**

Remove candidate/flag wording. Use neutral messages:

```ts
provider_not_configured: 'AI scoring is not configured yet.'
provider_failed: 'AI scoring is temporarily unavailable. Try again.'
invalid_provider_response: 'The AI scorer returned an invalid result. Try again.'
unavailable: 'AI scoring is unavailable. Try again.'
```

- [ ] **Step 6: Run focused tests**

```bash
npx vitest run tests/mmiContracts.test.ts tests/candidateMmiScoring.test.ts
npm run typecheck:edge-handler
```

Expected: PASS; a valid provider response becomes a real score, while invalid/provider-failed responses never call the completion repository.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/mmiScoringContract.ts supabase/functions/score-candidate-mmi-response/handler.ts src/features/candidateMmi/scoringApi.ts tests/mmiContracts.test.ts tests/candidateMmiScoring.test.ts
git commit -m "feat: ship built-in AI scoring criteria"
```

### Task 5: Start evaluation only after the full station

**Files:**
- Modify: `app/practice/mmi-station.tsx`
- Modify: `src/features/candidateMmi/scoringApi.ts`
- Modify: `tests/candidateMmiUiContract.test.ts`
- Modify: `tests/candidateMmiScoring.test.ts`

**Interfaces:**
- Consumes: five finalized response rows and `scoreCandidateResponse(sessionId, promptOrder)`.
- Produces: `scoreCompletedStation(sessionId)` and a retry control on the completed-station screen.

- [ ] **Step 1: Write failing end-of-station assertions**

Require the route not to call scoring from `advanceExpiredPhase`. Require one completed-phase function to request orders `1..5` and then refresh feedback:

```ts
expect(advanceExpiredPhaseSource).not.toContain('scoreCandidateResponse');
expect(routeSource).toMatch(/scoreCompletedStation/);
expect(routeSource).toMatch(/\[1, 2, 3, 4, 5\]/);
expect(routeSource).toMatch(/Retry AI scoring/);
```

- [ ] **Step 2: Run the UI/scoring tests and confirm RED**

```bash
npx vitest run tests/candidateMmiUiContract.test.ts tests/candidateMmiScoring.test.ts
```

Expected: FAIL because the current route launches scoring after every response deadline.

- [ ] **Step 3: Add a station scoring helper**

Add this API behavior with immutable order input:

```ts
const MMI_PROMPT_ORDERS = Object.freeze([1, 2, 3, 4, 5] as const);

async function scoreCompletedStation(sessionId: string) {
  const outcomes = await Promise.allSettled(
    MMI_PROMPT_ORDERS.map(order => scoringApi().scoreCandidateResponse(sessionId, order)),
  );
  await loadFeedback(sessionId);
  return outcomes;
}
```

Invoke it only when the trusted projection becomes `completed`. Guard duplicate calls with a session-scoped ref. A retry button clears that guard and calls the same helper; it does not create a new station.

- [ ] **Step 4: Remove in-station scoring**

Delete `promptToScore`, `hasCandidateResponse`, and the Edge invocation from `advanceExpiredPhase`. Finalization still checkpoints, freezes, stops speech, advances idempotently, and preserves no-response behavior.

- [ ] **Step 5: Render honest completion states**

While any result is pending, display `AI evaluation in progress`. If one or more results fail, display `AI scoring could not complete` and `Retry AI scoring`. Render numeric scores and feedback cards only for schema-validated `scored` assessments.

- [ ] **Step 6: Run tests and type checking**

```bash
npx vitest run tests/candidateMmiUiContract.test.ts tests/candidateMmiScoring.test.ts
npm run typecheck
```

Expected: PASS; no Edge scoring call occurs before the completed projection.

- [ ] **Step 7: Commit**

```bash
git add app/practice/mmi-station.tsx src/features/candidateMmi/scoringApi.ts tests/candidateMmiUiContract.test.ts tests/candidateMmiScoring.test.ts
git commit -m "feat: evaluate MMI responses after station completion"
```

### Task 6: Update the authoritative viewing and deployment runbooks

**Files:**
- Modify: `docs/BEFORE-COFOUNDER-VIEWING.md`
- Modify: `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md`

**Interfaces:**
- Consumes: implemented single-flow behavior and verification evidence.
- Produces: one truthful operational checklist with no clinician-scoring gate or feature-flag enablement step.

- [ ] **Step 1: Remove superseded blockers and sequence steps**

Delete requirements to obtain or activate reviewed rubrics, keep a candidate flag false, enable a candidate flag, grant founder-review access, or use fabricated/pending scoring. Replace them with:

```markdown
- [ ] The isolated Supabase project contains 155 published stations and 775 ordered questions.
- [ ] The scoring Edge function and AI provider configuration produce a real schema-valid result.
- [ ] The exact Vercel commit completes the 60 + (5 × 120) second station through an invited account.
```

- [ ] **Step 2: Record the source mapping and deployment rule**

State explicitly that `stations.scenario_text` is the brief and `sub_questions.question_text` supplies orders `1..5`. Record the standing rule that reviewable work must be deployed to Vercel and isolated Supabase unless the user explicitly opts out.

- [ ] **Step 3: Keep manual QA understandable**

Describe manual QA as checking real devices and assistive technology: microphone allow/deny, unsupported-browser typing, refresh/resume, all six timing boundaries, keyboard navigation, screen reader announcements, mobile layout, reduced motion, and inspection that raw audio/sensitive text is absent from storage and logs.

- [ ] **Step 4: Verify stale language is gone**

```bash
rg -n -i "clinician-reviewed|clinician review|candidate release flag|keep the flag off|enable the feature flag|founder-review" docs/BEFORE-COFOUNDER-VIEWING.md docs/PRE-CLOSED-ROUND-DEPLOYMENT.md
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add docs/BEFORE-COFOUNDER-VIEWING.md docs/PRE-CLOSED-ROUND-DEPLOYMENT.md
git commit -m "docs: simplify the MMI release runbooks"
```

### Task 7: Run exact-SHA local verification and prepare review

**Files:**
- Verify: all tracked files changed by Tasks 1–6
- Do not stage: unrelated local files listed in Global Constraints

**Interfaces:**
- Consumes: complete implementation commit series.
- Produces: one exact verified SHA pushed to `origin/feat/cofounder-ui-reliability` and a PR against current `origin/main`.

- [ ] **Step 1: Refresh and integrate current main**

```bash
git fetch origin
git merge --no-edit origin/main
```

Resolve only conflicts in files owned by this plan. Do not overwrite unrelated working-tree files.

- [ ] **Step 2: Run the complete verification suite**

```bash
npm test
npm run typecheck
npm run build
npm run test:coverage
npm audit --audit-level=high
git diff --check
```

Expected: every command exits `0`; coverage meets the repository's 80% floor; no high/critical audit finding is introduced.

- [ ] **Step 3: Run local Supabase proof**

Start the isolated local stack, apply the full migration chain, and run:

```bash
npm run test:integration:mutating
bash scripts/run-local-cofounder-adversarial-proof.sh
```

Expected: PASS with 155 stations, 775 questions, five orders per station, no flag row, cross-account denial, no direct transcript-table access, and no raw-audio storage surface.

- [ ] **Step 4: Inspect scope and secrets**

```bash
git status --short
git diff origin/main...HEAD --check
git diff origin/main...HEAD --name-status
rg -n "sk-[A-Za-z0-9_-]{20,}|service_role.*[A-Za-z0-9_-]{20,}" --glob '!package-lock.json' .
```

Expected: no secrets; only planned files plus previously owned unrelated local files remain.

- [ ] **Step 5: Record and push the exact SHA**

```bash
git rev-parse HEAD
git push -u origin feat/cofounder-ui-reliability
git ls-remote --heads origin feat/cofounder-ui-reliability
```

Require local and remote SHA equality.

- [ ] **Step 6: Create or update the PR**

Use base `main`, head `feat/cofounder-ui-reliability`, and a description that states the single-flow behavior, database migration, scoring timing, transcript/no-audio contract, exact test commands, and isolated deployment boundary.

### Task 8: Deploy to isolated Supabase and Vercel Preview

**Files:**
- Deploy: `supabase/migrations/20260904000000_single_mmi_station.sql`
- Deploy: `supabase/functions/score-candidate-mmi-response/`
- Deploy: exact feature-branch SHA to Vercel Preview
- Modify after proof: `docs/BEFORE-COFOUNDER-VIEWING.md`

**Interfaces:**
- Consumes: exact pushed SHA and isolated project `obfwfoykalvoxqdnosus`.
- Produces: a working authenticated Vercel URL backed by the isolated database and real AI scorer.

- [ ] **Step 1: Verify deployment targets before mutation**

Read back the linked Supabase ref, Vercel project, branch SHA, migration history, 155/775 counts, and empty/expected active-session state. Abort if any target resolves to `tliwifhnsytxpcynuwsy`.

- [ ] **Step 2: Apply only the forward migration**

Dry-run and then apply `20260904000000_single_mmi_station.sql` to `obfwfoykalvoxqdnosus`. Postflight must prove the flag row is absent, all current RPCs are executable only by their intended roles, direct private-table access remains revoked, and 155/775 content is unchanged.

- [ ] **Step 3: Configure and deploy the real scorer**

Verify the isolated project has the same working provider configuration contract already used by `score-answer`: provider name, model, API key secret, and exact allowed Vercel origin. Deploy `score-candidate-mmi-response` from the verified SHA. Never print secret values or provider request bodies.

- [ ] **Step 4: Deploy the exact client commit**

Deploy the pushed SHA as a protected Vercel Preview with `EXPO_PUBLIC_SUPABASE_URL` and the anon key for `obfwfoykalvoxqdnosus`. Record deployment ID, URL, commit SHA, and build result.

- [ ] **Step 5: Run authenticated hosted smoke tests**

Using an existing invited preview account, prove:

1. Practice shows only `11-minute MMI station`.
2. The brief shows only the selected row's `scenario_text` for 60 seconds.
3. Questions `question_text` orders `1..5` appear one at a time for 120 seconds each.
4. Microphone transcription works when allowed; typing works when denied.
5. Refresh restores the server deadline and transcript draft.
6. Evaluation starts after Q5, calls the real configured AI provider, and persists schema-valid feedback.
7. A forced provider failure preserves completion and the retry succeeds without rerunning the station.
8. Browser/network/storage inspection finds no raw audio upload or persisted audio object.

- [ ] **Step 6: Record evidence and commit**

Update `docs/BEFORE-COFOUNDER-VIEWING.md` with the exact SHA, Supabase ref, migration version/hash, Edge function version, Vercel deployment ID/URL, timestamp, and smoke outcomes. Do not record credentials, transcript text, question text, or provider bodies.

```bash
git add docs/BEFORE-COFOUNDER-VIEWING.md
git commit -m "docs: record single MMI station deployment"
git push origin feat/cofounder-ui-reliability
```

- [ ] **Step 7: Hand off the working URL**

Confirm the final documentation-only commit does not change the deployed client SHA. Give the user the protected Vercel URL, the deployed application SHA, and any manual browser/device checks that still require their physical device.

## Plan self-review

- Every behavior in the approved specification maps to Tasks 1–8.
- The Sheet mapping is explicit at both source and runtime boundaries.
- The station and scoring changes have RED/GREEN tests before implementation.
- No task creates a replacement product flag, account allowlist, review workflow, or fabricated score.
- Authentication, ownership, RLS, strict provider validation, and secret handling remain mandatory.
- Deployment mutates only the isolated Supabase ref and a protected Vercel Preview.
