# Rubric Scoring, University Practice, Admin, and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic MMI grading with equal-weight, per-question workbook rubrics; add university-scoped 11-minute practice; and give administrators privacy-safe content, model, result, and cost controls.

**Architecture:** A verified workbook importer writes complete private station payloads containing stable criteria and panel content. Forward-only Supabase migrations own content versions, practice-pool selection, immutable attempt snapshots, transactional score/usage persistence, transcript erasure, and narrow candidate/admin RPCs. Edge scoring asks the provider only for strict criterion decisions; TypeScript computes and validates scores, while Expo screens render server projections without direct sensitive-table access.

**Tech Stack:** Expo Router, React Native Web, TypeScript, Vitest, Node test runner, Playwright, Supabase/PostgreSQL, Supabase Edge Functions/Deno, and a Python standard-library XLSX importer.

**Spec:** `docs/superpowers/specs/2026-09-10-rubric-university-admin-retention-design.md`

## Global Constraints

- A practice attempt is always one 60-second scenario phase followed by exactly five 120-second response phases.
- The scoring provider receives only the snapshotted scenario, current question, current ordered criteria, and current transcript.
- The provider returns achieved/not-achieved decisions; application code computes `achieved / total * 100`, rounded to two decimals.
- Every question contributes equally to the station percentage.
- Targeted practice uses the profile university tag plus `ALL`; repository practice uses every published, complete station.
- Availability numbers always count complete 11-minute stations, never individual prompts.
- Successfully scored transcripts are erased in the score transaction; pending or failed transcript text expires within 24 hours.
- Raw audio, transcript excerpts, raw provider responses, and provider request bodies are never persisted or exposed.
- Administrators may inspect any user's structured rubric outcomes and costs, but never answer content or secret values.
- Every cross-user assessment detail view creates an access-audit row.
- Browser clients use narrow RPCs instead of reading sensitive base tables.
- Existing migrations remain unchanged; all database behavior changes are forward-only.
- Shared Supabase, Vercel, AI-provider credentials, and other remote resources are not changed without separate explicit approval.
- Unit, integration, and end-to-end coverage for changed surfaces must meet the repository's 80% minimum.
- Before every symbol edit, refresh GitNexus and run upstream impact analysis; warn the user before proceeding if risk is HIGH or CRITICAL, and text-confirm every UNKNOWN result.
- Preserve the user's unrelated changes in `AGENTS.md`, `CLAUDE.md`, `.codegraph/`, `.claude/skills/`, `.DS_Store`, and generated `__pycache__/` content.

## File Structure

### Import and database ownership

- Modify `supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py` to read the verified workbook directly and emit criteria and panel content.
- Modify `supabase/imports/20260825_med_interview_question_bank/generate_import.py` so the old flat-question manifest identifies itself as a legacy projection and points to the complete import.
- Modify `supabase/imports/20260825_med_interview_question_bank/normalized-station-manifest.json` to publish content-free counts and hashes for the complete import.
- Modify `supabase/imports/20260825_med_interview_question_bank/manifest.json` so its policy describes preservation rather than exclusion.
- Preserve the existing `.gitignore` rules for the two private normalized payloads; private prompt, rubric, model-answer, and panel-note content remains untracked.
- Create `supabase/migrations/20260910000000_mmi_rubric_content_import.sql` for criteria, panel content, versions, and complete-import RPCs.
- Create `supabase/migrations/20260910001000_mmi_rubric_scoring_retention.sql` for scoring snapshots, usage, atomic transcript erasure, legacy scrubbing, and 24-hour expiry.
- Create `supabase/migrations/20260910002000_mmi_university_practice_history.sql` for canonical tags, practice choices, scoped selection, results, and candidate history.
- Create `supabase/migrations/20260910003000_mmi_admin_operations.sql` for station/panel administration, configuration, metrics, cross-user structured results, and audit events.

### Scoring ownership

- Create `supabase/functions/_shared/rubricAssessment.ts` for criterion schemas, provider-decision validation, evidence-range validation, and server-calculated public results.
- Modify `supabase/functions/_shared/aiProvider.ts` to normalize provider token usage and return content plus usage without retaining raw provider bodies.
- Replace generic-rubric behavior in `supabase/functions/score-candidate-mmi-response/handler.ts` with the snapshotted rubric contract.
- Modify `supabase/functions/score-candidate-mmi-response/index.ts` to load rate configuration and call the new completion RPC.
- Keep `supabase/functions/_shared/mmiScoringContract.ts` and `mmiContracts.ts` only for labelled legacy assessment parsing; new scoring must not import their generic rubric.

### Candidate ownership

- Modify `src/features/candidateMmi/types.ts`, `api.ts`, `runner.ts`, `scoringApi.ts`, and `scoringSummary.ts` for practice scope and rubric-result contracts.
- Create `src/components/mmi/RubricChecklist.tsx` as the shared criterion display.
- Modify `app/(tabs)/practice.tsx`, `app/practice/mmi-station.tsx`, and `app/(tabs)/progress.tsx` for scoped practice, strict checklists, and retained history.
- Modify `app/privacy.tsx` so disclosure matches temporary transcript retention.

### Admin ownership

- Create `src/features/adminMmi/types.ts`, `validation.ts`, and `api.ts` for strict admin request/response boundaries.
- Create `app/admin/stations.tsx`, `station-editor.tsx`, `panels.tsx`, `usage.tsx`, `assessments.tsx`, and `assessment.tsx` as focused screens.
- Modify `app/admin/questions.tsx` into a compatibility redirect to the station repository.
- Modify `app/admin/ai-config.tsx`, `app/admin/index.tsx`, and `app/admin/_layout.tsx` to use the new admin projections and navigation.

---

### Task 1: Import the complete workbook contract

**Files:**
- Modify: `supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py`
- Modify: `supabase/imports/20260825_med_interview_question_bank/generate_import.py`
- Modify: `supabase/imports/20260825_med_interview_question_bank/normalized-station-manifest.json`
- Modify: `supabase/imports/20260825_med_interview_question_bank/manifest.json`
- Test: `tests/candidateMmiImportPolicy.test.ts`

**Interfaces:**
- Consumes: verified workbook SHA-256 `903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`.
- Produces: private payload version 2 with `stations[].sub_questions[].marking_criteria[]` and `panel_questions[]`; content-free manifest version 2.

- [ ] **Step 1: Write failing importer contract tests**

Extend the tests to require the complete normalized shape and exact usable counts:

```ts
expect(manifest.artifact_version).toBe(2);
expect(manifest.normalized_flow).toMatchObject({
  candidate_station_count: 155,
  candidate_sub_question_count: 775,
  candidate_criterion_count: 3100,
  panel_question_count: 10,
  criteria_per_candidate_sub_question: { min: 4, max: 4 },
});
expect(manifest.policy).toMatchObject({
  criteria_preserved: true,
  source_weights_preserved: true,
  domains_preserved: true,
  cached_model_answers_preserved_when_non_empty: true,
  panel_notes_preserved_admin_only: true,
  orphaned_criteria: 'reject_and_report',
});
```

Add a pure Python probe that passes one synthetic station, five questions, four criteria per question, and one panel row into `normalize_content()`. Assert criterion order, IDs, bullets, source weights, domains, panel notes, and blank model answers survive without being copied into candidate prompt text.

- [ ] **Step 2: Run the importer tests and verify RED**

Run: `npx vitest run tests/candidateMmiImportPolicy.test.ts`

Expected: FAIL because artifact version 1 has no criterion counts and `normalize_content()` does not exist.

- [ ] **Step 3: Implement direct workbook normalization**

Give the generator this testable boundary:

```python
def normalize_content(
    station_records: list[tuple[int, dict[str, str]]],
    sub_question_records: list[tuple[int, dict[str, str]]],
    criterion_records: list[tuple[int, dict[str, str]]],
    panel_records: list[tuple[int, dict[str, str]]],
) -> dict[str, object]:
    """Return validated candidate stations, panels, and a content-free report."""
```

For every usable candidate criterion, emit exactly:

```python
# Iterate each sub-question's criterion rows in ascending workbook source-row
# order and enumerate from one.
{
    'criterion_id': criterion['criterion_id'],
    'order_num': criterion_order,
    'bullet_text': criterion['bullet_text'].strip(),
    'source_weight': float(criterion['weight']),
    'domain': criterion['domain'].strip().lower() or None,
}
```

Read the workbook with the existing ZIP/XML helpers, reject duplicate source IDs and orphaned candidate criteria, require orders `[1, 2, 3, 4, 5]`, normalize university tags to lowercase canonical source values, and convert the displaced literal `draft` image value into `status: 'draft'` with `image_url: None`. Preserve blank cached model answers as `None`; never invent model-answer content.

Use this CLI contract:

```text
generate_normalized_station_import.py /path/to/med_interview_question_bank.xlsx [--verify-manifest]
```

Write the same two ignored private JSON parts. Put all ten panel rows in part 1 and an empty panel array in part 2 so retry-safe batch identity remains deterministic.

- [ ] **Step 4: Regenerate and verify private artifacts locally**

Run:

```bash
python3 supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py /Users/sanje/Downloads/med_interview_question_bank.xlsx
python3 supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py /Users/sanje/Downloads/med_interview_question_bank.xlsx --verify-manifest
```

Expected: both commands report 155 stations, 775 sub-questions, 3,100 attached criteria, 10 panels, and zero accepted orphan criteria without printing private content.

- [ ] **Step 5: Update tracked manifests without exposing content**

Record artifact hashes, canonical JSONB hashes, counts, sheet inventories,
normalization rules, and rejection counts. In the normalized manifest, use the
preservation policy asserted above. In the flat manifest, replace the ambiguous
boolean exclusions with `artifact_scope: legacy_flat_question_projection`,
`runtime_import: normalized-station-manifest.json`, and explicit text stating
that criteria, model answers, and panel notes are absent only from the retired
flat projection and preserved by the runtime complete-station import. Confirm
both tracked JSON files contain no scenario, question, bullet, note, or
model-answer value.

- [ ] **Step 6: Run tests and privacy checks**

Run:

```bash
npx vitest run tests/candidateMmiImportPolicy.test.ts
git check-ignore supabase/imports/20260825_med_interview_question_bank/normalized-stations-part-1.json
git check-ignore supabase/imports/20260825_med_interview_question_bank/normalized-stations-part-2.json
git diff --check
```

Expected: PASS, and both private artifacts are ignored.

- [ ] **Step 7: Commit the importer slice**

```bash
git add tests/candidateMmiImportPolicy.test.ts supabase/imports/20260825_med_interview_question_bank/generate_import.py supabase/imports/20260825_med_interview_question_bank/generate_normalized_station_import.py supabase/imports/20260825_med_interview_question_bank/manifest.json supabase/imports/20260825_med_interview_question_bank/normalized-station-manifest.json
git commit -m "feat: preserve complete MMI workbook rubrics"
```

### Task 2: Persist criteria, panels, and immutable content versions

**Files:**
- Create: `supabase/migrations/20260910000000_mmi_rubric_content_import.sql`
- Modify: `tests/candidateMmiImportPolicy.test.ts`
- Modify: `tests/integration/candidateMmiStation.integration.test.ts`

**Interfaces:**
- Consumes: payload version 2 from Task 1.
- Produces: `mmi_marking_criteria`, `mmi_panel_questions`, `mmi_station_versions`, and version-2 `import_normalized_mmi_station_batch`/`finalize_normalized_mmi_station_import` behavior.

- [ ] **Step 1: Write failing schema and import integration tests**

Require the migration to create private tables and to import exact counts:

```ts
async function countRows(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  assert.equal(error, null, error?.message);
  return count ?? 0;
}

function groupCounts(rows: readonly { sub_q_id: string }[]): number[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.sub_q_id, (counts.get(row.sub_q_id) ?? 0) + 1);
  return [...counts.values()];
}

assert.equal(await countRows(service, 'mmi_stations'), 155);
assert.equal(await countRows(service, 'mmi_sub_questions'), 775);
assert.equal(await countRows(service, 'mmi_marking_criteria'), 3100);
assert.equal(await countRows(service, 'mmi_panel_questions'), 10);

const { data: criterionCounts } = await service
  .from('mmi_marking_criteria')
  .select('sub_q_id');
assert.equal(groupCounts(criterionCounts).every(count => count === 4), true);
```

Also assert that `anon` and `authenticated` have no table or column privileges for the three new tables and that a malformed payload with an orphaned criterion rolls back the entire batch.

- [ ] **Step 2: Run policy tests and verify RED**

Run: `npx vitest run tests/candidateMmiImportPolicy.test.ts`

Expected: FAIL because the migration and tables do not exist.

- [ ] **Step 3: Create the content tables**

Use these stable identities and constraints:

```sql
CREATE TABLE public.mmi_marking_criteria (
  criterion_id text PRIMARY KEY,
  sub_q_id text NOT NULL REFERENCES public.mmi_sub_questions(sub_q_id) ON DELETE CASCADE,
  order_num integer NOT NULL CHECK (order_num > 0),
  bullet_text text NOT NULL CHECK (char_length(btrim(bullet_text)) BETWEEN 1 AND 2000),
  source_weight numeric(8,3) NOT NULL CHECK (source_weight > 0),
  domain text,
  source_namespace text NOT NULL,
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (sub_q_id, order_num)
);

CREATE TABLE public.mmi_panel_questions (
  question_id text PRIMARY KEY,
  question_text text NOT NULL,
  station_type text NOT NULL,
  topic text NOT NULL,
  difficulty public.question_difficulty NOT NULL,
  uni_tags text[] NOT NULL DEFAULT '{}',
  notes text,
  model_answer_cached text,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  source_namespace text NOT NULL,
  source_manifest_sha256 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.mmi_station_versions (
  station_id text NOT NULL REFERENCES public.mmi_stations(station_id),
  version integer NOT NULL CHECK (version > 0),
  content_snapshot jsonb NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (station_id, version)
);
```

Add `content_version integer NOT NULL DEFAULT 1`, `archived_at timestamptz`, and the `archived` state to `mmi_stations`. Enable RLS, revoke base-table privileges from `PUBLIC`, `anon`, and `authenticated`, and grant only the service-owned paths needed by import functions.

- [ ] **Step 4: Replace the batch importer transaction boundary**

Validate exact JSON keys at every level, cap text/array sizes, verify criterion ownership, and upsert station → questions → criteria → panels in one transaction. Do not update publication state during an ordinary re-import. On finalization, require:

```sql
v_station_count = 155
AND v_sub_question_count = 775
AND v_criterion_count = 3100
AND v_panel_count = 10
AND NOT EXISTS (
  SELECT 1
  FROM public.mmi_sub_questions q
  LEFT JOIN public.mmi_marking_criteria c ON c.sub_q_id = q.sub_q_id
  GROUP BY q.sub_q_id
  HAVING count(c.criterion_id) <> 4
)
```

Create a version-1 snapshot for imported stations only after the postconditions pass. Include scenario, metadata, five questions, and their ordered criteria in `content_snapshot`; omit panel notes from station versions because panels are separate content.

- [ ] **Step 5: Run the disposable local integration test**

Run: `npm run test:integration:mutating`

Expected: PASS against the explicitly configured disposable local Supabase instance; if no disposable instance is configured, the test reports SKIP without contacting a shared environment.

- [ ] **Step 6: Run schema and security policy tests**

Run:

```bash
npx vitest run tests/candidateMmiImportPolicy.test.ts tests/mmiStudentContentPolicy.test.ts
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit the content schema slice**

```bash
git add supabase/migrations/20260910000000_mmi_rubric_content_import.sql tests/candidateMmiImportPolicy.test.ts tests/integration/candidateMmiStation.integration.test.ts
git commit -m "feat: persist versioned MMI criteria and panel content"
```

### Task 3: Build the strict rubric assessment and token-usage domain

**Files:**
- Create: `supabase/functions/_shared/rubricAssessment.ts`
- Modify: `supabase/functions/_shared/aiProvider.ts`
- Modify: `supabase/functions/score-answer/index.ts`
- Create: `tests/mmiRubricAssessment.test.ts`
- Modify: `tests/aiProviderSecurity.test.ts`
- Modify: `tests/legacyScoringEdge.test.ts`
- Modify: `tsconfig.edge-handler.json`

**Interfaces:**
- Consumes: ordered `RubricCriterionSnapshot[]` and transient transcript text.
- Produces: `createRubricResponseSchema`, `parseRubricProviderAssessment`, `toPublicRubricAssessment`, `AiProviderResult`, and `AiTokenUsage`.

- [ ] **Step 1: Write failing equal-weight and strict-schema tests**

Use the public types below and prove all score math is server-owned:

```ts
const criteria = [
  { criterionId: 'C1', bulletText: 'First', domain: null },
  { criterionId: 'C2', bulletText: 'Second', domain: null },
  { criterionId: 'C3', bulletText: 'Third', domain: null },
  { criterionId: 'C4', bulletText: 'Fourth', domain: null },
] as const;

const result = toPublicRubricAssessment([
  { criterionId: 'C1', achieved: true, evidenceReference: { start: 0, end: 4 } },
  { criterionId: 'C2', achieved: false, evidenceReference: null },
  { criterionId: 'C3', achieved: false, evidenceReference: null },
  { criterionId: 'C4', achieved: false, evidenceReference: null },
], criteria, 'Safe escalation is required.');

expect(result.questionScorePct).toBe(25);
expect(result.criteria.map(item => item.weightPct)).toEqual([25, 25, 25, 25]);
expect(JSON.stringify(result)).not.toContain('Safe escalation');
```

Add table tests rejecting missing, extra, duplicate, reordered, unknown-ID, non-boolean, invalid positive-evidence, and negative-with-evidence decisions. Add a five-criterion case that awards 20% per achieved criterion and a three-criterion case rounded to two decimals.

- [ ] **Step 2: Run domain tests and verify RED**

Run: `npx vitest run tests/mmiRubricAssessment.test.ts tests/aiProviderSecurity.test.ts tests/legacyScoringEdge.test.ts`

Expected: FAIL because the rubric module and provider usage result do not exist.

- [ ] **Step 3: Implement immutable rubric types and score calculation**

Export these contracts:

```ts
export type RubricCriterionSnapshot = Readonly<{
  criterionId: string;
  bulletText: string;
  domain: string | null;
}>;

export type ProviderCriterionDecision = Readonly<{
  criterionId: string;
  achieved: boolean;
  evidenceReference: Readonly<{ start: number; end: number }> | null;
}>;

export type PublicRubricAssessment = Readonly<{
  schemaVersion: 3;
  questionScorePct: number;
  criteria: readonly Readonly<{
    criterionId: string;
    achieved: boolean;
    weightPct: number;
  }>[];
}>;
```

`createRubricResponseSchema(criteria)` returns an exact JSON schema whose decision array has `minItems` and `maxItems` equal to the criterion count and whose criterion ID enum contains only current IDs. `parseRubricProviderAssessment` additionally enforces array order and code-point evidence ranges. `toPublicRubricAssessment` copies no evidence offsets or transcript text and computes percentages with:

```ts
const roundPct = (value: number) => Math.round(value * 100) / 100;
const weightPct = roundPct(100 / criteria.length);
const questionScorePct = roundPct(
  decisions.filter(decision => decision.achieved).length / criteria.length * 100,
);
```

- [ ] **Step 4: Return normalized provider usage**

Change the provider boundary to:

```ts
export type AiTokenUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}>;

export type AiProviderResult = Readonly<{
  content: string;
  usage: AiTokenUsage | null;
}>;

export interface AiConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string | null;
  inputRatePerMillion: number;
  cachedInputRatePerMillion: number;
  outputRatePerMillion: number;
}
```

For Anthropic, read `usage.input_tokens`, `usage.cache_read_input_tokens`, and `usage.output_tokens`. For OpenAI-compatible responses, derive uncached input as `max(prompt_tokens - cached_tokens, 0)`, use `prompt_tokens_details.cached_tokens`, and read `completion_tokens`. Reject negative, fractional, inconsistent, or unsafe-integer usage by returning `usage: null`; never reject otherwise valid score content solely because usage is missing.

Update the legacy scorer to parse `providerResult.content` while deliberately ignoring `providerResult.usage`; this keeps the retired endpoint compiling without expanding legacy data retention.

- [ ] **Step 5: Run unit tests and typecheck**

Run:

```bash
npx vitest run tests/mmiRubricAssessment.test.ts tests/aiProviderSecurity.test.ts tests/legacyScoringEdge.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the scoring domain slice**

```bash
git add supabase/functions/_shared/rubricAssessment.ts supabase/functions/_shared/aiProvider.ts supabase/functions/score-answer/index.ts tests/mmiRubricAssessment.test.ts tests/aiProviderSecurity.test.ts tests/legacyScoringEdge.test.ts tsconfig.edge-handler.json
git commit -m "feat: add strict rubric assessment domain"
```

### Task 4: Make scoring, usage, and transcript erasure one transaction

**Files:**
- Create: `supabase/migrations/20260910001000_mmi_rubric_scoring_retention.sql`
- Modify: `supabase/functions/score-candidate-mmi-response/handler.ts`
- Modify: `supabase/functions/score-candidate-mmi-response/index.ts`
- Modify: `src/features/candidateMmi/scoringApi.ts`
- Modify: `tests/candidateMmiScoring.test.ts`
- Modify: `tests/mmiContracts.test.ts`
- Create: `tests/integration/mmiRubricScoringRetention.integration.test.ts`
- Modify: `vitest.mutation.config.mts`

**Interfaces:**
- Consumes: Task 2 criteria and Task 3 provider result.
- Produces: claim payload with scenario/question/criteria, schema-v3 stored assessment, usage event, and immediate transcript purge.

- [ ] **Step 1: Write failing handler tests for exact model context**

Define a claimed response with this exact shape:

```ts
const claimed = {
  status: 'claimed',
  responseId,
  sessionId,
  promptOrder: 2,
  scenarioText: 'A colleague may have breached confidentiality.',
  promptText: 'What would you do first?',
  transcript,
  criteria: [
    { criterionId: 'CRIT_1', bulletText: 'Clarifies the immediate risk', domain: 'safety' },
    { criterionId: 'CRIT_2', bulletText: 'Protects confidentiality', domain: 'ethics' },
    { criterionId: 'CRIT_3', bulletText: 'Escalates proportionately', domain: 'professionalism' },
    { criterionId: 'CRIT_4', bulletText: 'Documents the action', domain: 'governance' },
  ],
  scoringContractVersion: '2026-09-10.1',
};
```

Assert the provider content has exactly `scenarioText`, `questionText`, `criteria`, and `candidateAnswer`; the completion call receives `p_public_assessment` and `p_usage`; and neither object contains transcript evidence or generic dimensions.

- [ ] **Step 2: Write failing database retention tests**

Prove the completion RPC atomically stores criterion decisions and usage then sets both `finalized_transcript` and the matching draft transcript to absent. Prove a forced usage insert failure leaves the response unscored and its transcript available for retry. Prove the purge function expires pending/failed transcripts and drafts at 24 hours, marks them `feedback_unavailable`, and never erases a transcript with a live scoring lease.

Add `tests/integration/mmiRubricScoringRetention.integration.test.ts` to the
`include` array in `vitest.mutation.config.mts` so the existing local-mutation
safety gate applies.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/candidateMmiScoring.test.ts tests/mmiContracts.test.ts`

Expected: FAIL because the handler still sends the generic rubric and completion has no usage argument.

- [ ] **Step 4: Create assessment, usage, and snapshot schema changes**

Add these durable fields and table:

```sql
ALTER TABLE public.candidate_mmi_station_sessions
  ADD COLUMN scenario_text_snapshot text,
  ADD COLUMN practice_scope text CHECK (practice_scope IN ('target', 'all')),
  ADD COLUMN target_university_snapshot text;

CREATE TABLE public.mmi_ai_usage_events (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.candidate_mmi_station_sessions(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES public.candidate_mmi_station_responses(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL UNIQUE,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  input_rate_per_million numeric(14,6) NOT NULL,
  cached_input_rate_per_million numeric(14,6) NOT NULL,
  output_rate_per_million numeric(14,6) NOT NULL,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  estimated_cost numeric(16,8),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('scored', 'provider_failed', 'invalid_response', 'persistence_failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

Add `ai_input_rate_per_million`, `ai_cached_input_rate_per_million`, and `ai_output_rate_per_million` config rows with string value `0`; all rate labels and stored events use USD. Validate schema-v3 assessments as exact `{schemaVersion, questionScorePct, criteria}` objects. Existing generic assessments remain accepted as legacy only; new completions accept schema version 3 only.

The Edge repository loads and strictly parses all three `AiConfig` rates from
`app_config`; malformed or negative values make scoring configuration
unavailable rather than silently substituting a cost.

- [ ] **Step 5: Snapshot and claim the exact rubric**

At session start, write `scenario_text_snapshot` and this prompt rubric snapshot:

```json
{
  "version": 1,
  "criteria": [
    { "criterionId": "CRIT_1", "bulletText": "...", "domain": "safety" }
  ]
}
```

Set `scoring_contract_snapshot` to `{"version":"2026-09-10.1"}`. The service-role claim function returns only the current response's scenario, question, ordered criteria, contract version, and transcript. It returns `unavailable` for legacy attempts without a complete rubric snapshot instead of applying generic dimensions.

- [ ] **Step 6: Implement atomic completion and 24-hour expiry**

Replace completion with:

```sql
public.complete_candidate_mmi_response_scoring(
  p_response_id uuid,
  p_session_id uuid,
  p_lease_token uuid,
  p_public_assessment jsonb,
  p_usage jsonb
) RETURNS jsonb
```

Inside one transaction and after locking the claim/response, validate criterion IDs against the snapshot, recalculate the score in SQL, insert `mmi_ai_usage_events`, set `public_assessment`, set `scoring_status = 'scored'`, set `finalized_transcript = NULL`, set `transcript_purged_at = clock_timestamp()`, and remove any matching draft. Return only `{"status":"scored"}`.

The Edge handler also returns only `{"status":"scored"}`. Redefine
`get_candidate_mmi_station_feedback(session_id)` to hydrate stored criterion IDs
with bullet/domain data from the immutable rubric snapshot; scoring responses
never need to echo rubric text. A finalized empty response is deterministically
hydrated as 0% with every criterion unchecked and does not incur a provider
call.

Replace failure persistence with
`fail_candidate_mmi_response_scoring(response_id, session_id, lease_token, error_code, usage)`.
Every provider attempt inserts one usage event keyed by its lease token,
including provider and invalid-response failures with nullable tokens/cost. A
later successful retry creates another event for the same response instead of
overwriting the paid failed attempt.

Update `purge_expired_candidate_mmi_free_text(p_now)` to use `interval '24 hours'`. Do not purge an `in_progress` row with an unexpired lease. For expired pending/failed rows, erase transcript text, set `transcript_purged_at`, and set `scoring_status = 'feedback_unavailable'`.

- [ ] **Step 7: Apply the selected policy to legacy data and deletion constraints**

In the same forward migration:

```sql
UPDATE public.answers SET text = '' WHERE text <> '';
UPDATE public.scores
SET ai_feedback = 'Legacy narrative removed under the current retention policy.',
    improvement_tip = 'Legacy narrative removed under the current retention policy.';
```

Set legacy `dimensions.*.evidence` JSON values to `null`, never invent criterion matches, and label those results with `legacy: true` in result RPCs. Replace the `ON DELETE RESTRICT` profile/session/answer constraints in `legacy_scoring_claims` and `legacy_scoring_attempts` with cascading account-owned constraints so deleting an auth user can cascade all assessment and usage data.

- [ ] **Step 8: Replace generic handler behavior**

Use this strict system instruction:

```text
Judge only whether each supplied marking criterion is explicitly supported by the candidate answer. Do not award credit for fluency, length, confidence, plausibility, or ideas outside the listed criteria. Treat vague implication as not achieved. Return exactly one ordered decision for every supplied criterion and no additional fields.
```

Call `createRubricResponseSchema`, parse decisions against the transient transcript, calculate `PublicRubricAssessment`, snapshot model/rates, calculate known cost, and call the new completion RPC. Measure latency with a monotonic clock. Never log or persist provider content.

Calculate USD cost only when usage exists:

```ts
const estimatedCost = usage === null ? null : (
  usage.inputTokens * config.inputRatePerMillion
  + usage.cachedInputTokens * config.cachedInputRatePerMillion
  + usage.outputTokens * config.outputRatePerMillion
) / 1_000_000;
```

Round only for display; persist the numeric result at database precision.

Update `scoringApi.ts` to accept only `{status:'no_response'}` or
`{status:'scored'}` success payloads. Hydrated rubric feedback is fetched from
the owned database RPC after scoring completes.

- [ ] **Step 9: Run unit and disposable integration tests**

Run:

```bash
npx vitest run tests/candidateMmiScoring.test.ts tests/mmiRubricAssessment.test.ts tests/aiProviderSecurity.test.ts tests/mmiContracts.test.ts
npm run test:integration:mutating
npm run typecheck
```

Expected: PASS or an explicit local-only SKIP for the mutating test.

- [ ] **Step 10: Commit the transactional scoring slice**

```bash
git add supabase/migrations/20260910001000_mmi_rubric_scoring_retention.sql supabase/functions/score-candidate-mmi-response/handler.ts supabase/functions/score-candidate-mmi-response/index.ts src/features/candidateMmi/scoringApi.ts tests/candidateMmiScoring.test.ts tests/mmiContracts.test.ts tests/integration/mmiRubricScoringRetention.integration.test.ts vitest.mutation.config.mts
git commit -m "feat: score MMI answers against exact rubrics"
```

### Task 5: Render strict rubric results for candidates

**Files:**
- Modify: `src/features/candidateMmi/api.ts`
- Modify: `src/features/candidateMmi/scoringSummary.ts`
- Create: `src/components/mmi/RubricChecklist.tsx`
- Modify: `app/practice/mmi-station.tsx`
- Modify: `app/privacy.tsx`
- Modify: `tests/candidateMmiApi.test.ts`
- Modify: `tests/candidateMmiScoring.test.ts`
- Modify: `tests/candidateMmiScoringSummary.test.ts`
- Modify: `tests/candidateMmiUiContract.test.ts`

**Interfaces:**
- Consumes: hydrated schema-v3 question assessments from Task 4's feedback RPC.
- Produces: strict client parsing and an accessible achieved/not-achieved checklist; the paid scoring endpoint returns status only.

- [ ] **Step 1: Write failing client-boundary and UI tests**

Require this public projection and reject evidence-like extra fields:

```ts
const assessment = {
  schemaVersion: 3,
  questionScorePct: 25,
  criteria: [
    { criterionId: 'CRIT_1', bulletText: 'Clarifies immediate risk', domain: 'safety', weightPct: 25, achieved: true },
    { criterionId: 'CRIT_2', bulletText: 'Protects confidentiality', domain: 'ethics', weightPct: 25, achieved: false },
    { criterionId: 'CRIT_3', bulletText: 'Escalates proportionately', domain: 'professionalism', weightPct: 25, achieved: false },
    { criterionId: 'CRIT_4', bulletText: 'Documents the action', domain: 'governance', weightPct: 25, achieved: false },
  ],
};
expect(parseCandidateAssessment(assessment).questionScorePct).toBe(25);
expect(() => parseCandidateAssessment({ ...assessment, evidence: 'private' })).toThrow();
```

The UI contract must contain checkbox accessibility roles and must not contain `dimensions`, `RadarChart`, `evidence`, `transcript-only feedback`, or retained-answer copy on the completed screen.

- [ ] **Step 2: Run candidate tests and verify RED**

Run: `npx vitest run tests/candidateMmiApi.test.ts tests/candidateMmiScoring.test.ts tests/candidateMmiScoringSummary.test.ts tests/candidateMmiUiContract.test.ts`

Expected: FAIL because clients still require generic dimensions.

- [ ] **Step 3: Replace public candidate types**

Use these exact assessment types in `api.ts`:

```ts
export type CandidateMmiCriterionResult = Readonly<{
  criterionId: string;
  bulletText: string;
  domain: string | null;
  weightPct: number;
  achieved: boolean;
}>;

export type CandidateMmiPublicAssessment = Readonly<{
  schemaVersion: 3;
  questionScorePct: number;
  criteria: readonly CandidateMmiCriterionResult[];
}>;
```

Export `parseCandidateAssessment` for focused boundary testing. Require exact keys, bounded text, unique criterion IDs, weights greater than zero, a weight sum within `0.01` of 100, and a score equal to the sum of achieved weights within `0.01`. Keep labelled legacy parsing separate and read-only.

- [ ] **Step 4: Build the shared checklist**

`RubricChecklist` accepts `{criteria}` and renders each row with `accessibilityRole="checkbox"`, `accessibilityState={{ checked: criterion.achieved }}`, a visible tick/empty box, rubric bullet, optional domain, and `criterion.weightPct%`. It never accepts transcript or evidence props.

- [ ] **Step 5: Replace completed-station feedback cards**

Show `Question N · X%`, then `RubricChecklist`. Derive concise headings without model prose:

```ts
const strengths = criteria.filter(item => item.achieved);
const nextSteps = criteria.filter(item => !item.achieved);
```

Render achieved bullets under “Covered” and missed bullets under “Next time”. A skipped answer renders 0% with every rubric point missed. Keep honest pending, unavailable, and expired states. Update the microphone disclosure to say transcript text is temporary and deleted after successful scoring or within 24 hours after an unresolved assessment.

- [ ] **Step 6: Run candidate tests and typecheck**

Run:

```bash
npx vitest run tests/candidateMmiApi.test.ts tests/candidateMmiScoring.test.ts tests/candidateMmiScoringSummary.test.ts tests/candidateMmiUiContract.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the candidate rubric slice**

```bash
git add src/features/candidateMmi/api.ts src/features/candidateMmi/scoringSummary.ts src/components/mmi/RubricChecklist.tsx app/practice/mmi-station.tsx app/privacy.tsx tests/candidateMmiApi.test.ts tests/candidateMmiScoring.test.ts tests/candidateMmiScoringSummary.test.ts tests/candidateMmiUiContract.test.ts
git commit -m "feat: show equal-weight MMI rubric checklists"
```

### Task 6: Add university practice pools and candidate history

**Files:**
- Create: `supabase/migrations/20260910002000_mmi_university_practice_history.sql`
- Modify: `src/features/candidateMmi/types.ts`
- Modify: `src/features/candidateMmi/api.ts`
- Modify: `src/features/candidateMmi/runner.ts`
- Modify: `app/(tabs)/practice.tsx`
- Modify: `app/practice/mmi-station.tsx`
- Modify: `app/(tabs)/progress.tsx`
- Modify: `tests/candidateMmiApi.test.ts`
- Modify: `tests/mmiCandidateSchedule.test.ts`
- Modify: `tests/candidateMmiUiContract.test.ts`
- Create: `tests/integration/mmiUniversityPractice.integration.test.ts`
- Modify: `vitest.mutation.config.mts`

**Interfaces:**
- Consumes: published complete stations, profile `university_target`, and schema-v3 results.
- Produces: `CandidateMmiPracticeScope`, practice options, scoped start, server-owned station result, and candidate-owned history.

- [ ] **Step 1: Write failing alias, count, selection, and ownership tests**

Cover at least:

```ts
const { data: kclTag } = await service.rpc('canonical_mmi_university_tag', {
  p_value: "King's College London",
});
const { data: oxfordTag } = await service.rpc('canonical_mmi_university_tag', {
  p_value: 'Oxford',
});
const { data: oxfordOptions } = await oxford.client.rpc(
  'get_candidate_mmi_practice_options',
);

assert.equal(kclTag, 'kcl');
assert.equal(oxfordTag, 'oxford');
assert.deepEqual(oxfordOptions, {
  targetUniversity: 'oxford',
  targetTag: 'oxford',
  targetCount: 115,
  allCount: 155,
});
```

Prove counts exclude draft, archived, wrong-timing, missing-question, and criterion-less stations. Prove another candidate cannot read a history/result row and that target start fails safely when `university_target` is absent.

Add `tests/integration/mmiUniversityPractice.integration.test.ts` to the
`include` array in `vitest.mutation.config.mts`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/candidateMmiApi.test.ts tests/mmiCandidateSchedule.test.ts tests/candidateMmiUiContract.test.ts`

Expected: FAIL because scope and options do not exist.

- [ ] **Step 3: Create canonical university and eligibility functions**

Implement `canonical_mmi_university_tag(text)` as an immutable SQL function with explicit aliases, including `king's college london`, `kings`, and `king's` → `kcl`. Implement `is_complete_published_mmi_station(station_id)` requiring published state, 60-second prep, five questions ordered 1–5, 120 seconds each, and at least one criterion per question.

- [ ] **Step 4: Add narrow candidate RPCs**

Create:

```sql
public.get_candidate_mmi_practice_options() RETURNS jsonb
public.start_candidate_mmi_station_session(p_scope text) RETURNS jsonb
public.get_candidate_mmi_station_result(p_session_id uuid) RETURNS jsonb
public.list_candidate_mmi_history(p_limit integer DEFAULT 20) RETURNS jsonb
```

`get_candidate_mmi_practice_options` returns exact keys `targetUniversity`, `targetTag`, `targetCount`, and `allCount`. Target count uses normalized `targetTag = ANY(uni_tags) OR 'all' = ANY(uni_tags)`. The start function validates scope, refuses `target` when no profile target exists, resumes an active owned session, otherwise least-recently selects inside the requested pool, and snapshots scope/target/scenario/questions/criteria.

`get_candidate_mmi_station_result` returns a server-calculated station percentage when every non-empty response is scored; finalized empty responses contribute a deterministic 0% with all rubric points unchecked. Pending, failed, or expired non-empty responses prevent a fabricated overall. `list_candidate_mmi_history` returns only the caller's session metadata, overall percentage/status, scope, target snapshot, timestamps, and domain attainment computed from rubric checkboxes.

- [ ] **Step 5: Update candidate API and runner signatures**

```ts
export type CandidateMmiPracticeScope = 'target' | 'all';

export type CandidateMmiPracticeOptions = Readonly<{
  targetUniversity: string | null;
  targetTag: string | null;
  targetCount: number;
  allCount: number;
}>;

start: (scope: CandidateMmiPracticeScope) => Promise<CandidateMmiServerProjection>;
practiceOptions: () => Promise<CandidateMmiPracticeOptions>;
result: (sessionId: string) => Promise<CandidateMmiStationResult>;
history: (limit?: number) => Promise<readonly CandidateMmiHistoryItem[]>;
```

Pass `{p_scope: scope}` to Supabase. Require exact response keys and bounds before rendering.

- [ ] **Step 6: Build the two practice cards and history screen**

The primary card label is `${targetUniversity} practice` and says `${targetCount} complete 11-minute stations`. If the target is missing, show a profile-action notice and disable only that card. The secondary card says `All-university practice` and `${allCount} complete 11-minute stations`.

Navigate with `scope=target` or `scope=all`; the setup screen preserves that query through `runner().start(scope)`. Replace legacy `mock_sessions`/generic-dimension progress reads with `history()` and rubric-domain attainment. Each retained session row opens the owned completed-station result through `get_candidate_mmi_station_result`, reusing the checklist screen without triggering a new provider call. Do not render transcripts or legacy answer text.

- [ ] **Step 7: Run candidate and integration tests**

Run:

```bash
npx vitest run tests/candidateMmiApi.test.ts tests/mmiCandidateSchedule.test.ts tests/candidateMmiUiContract.test.ts
npm run test:integration:mutating
npm run typecheck
```

Expected: PASS or explicit local-only SKIP for mutating integration.

- [ ] **Step 8: Commit the practice slice**

```bash
git add supabase/migrations/20260910002000_mmi_university_practice_history.sql src/features/candidateMmi/types.ts src/features/candidateMmi/api.ts src/features/candidateMmi/runner.ts 'app/(tabs)/practice.tsx' app/practice/mmi-station.tsx 'app/(tabs)/progress.tsx' tests/candidateMmiApi.test.ts tests/mmiCandidateSchedule.test.ts tests/candidateMmiUiContract.test.ts tests/integration/mmiUniversityPractice.integration.test.ts vitest.mutation.config.mts
git commit -m "feat: add university-scoped MMI practice"
```

### Task 7: Create privacy-safe admin operations

**Files:**
- Create: `supabase/migrations/20260910003000_mmi_admin_operations.sql`
- Create: `src/features/adminMmi/types.ts`
- Create: `src/features/adminMmi/validation.ts`
- Create: `src/features/adminMmi/api.ts`
- Create: `tests/adminMmiValidation.test.ts`
- Create: `tests/adminMmiApi.test.ts`
- Create: `tests/integration/adminMmiOperations.integration.test.ts`
- Modify: `vitest.mutation.config.mts`

**Interfaces:**
- Consumes: versioned content, structured assessments, usage events, profile admin flag.
- Produces: validated admin CRUD/config/metrics APIs and audit-enforced cross-user detail access.

- [ ] **Step 1: Write failing station validation tests**

Use one immutable editor shape:

```ts
export type AdminMmiStationDraft = Readonly<{
  stationId: string;
  expectedVersion: number | null;
  category: string;
  topic: string;
  difficulty: 'foundation' | 'intermediate' | 'advanced';
  universityTags: readonly string[];
  prepTimeSec: 60;
  imageUrl: string | null;
  scenarioText: string;
  questions: readonly AdminMmiQuestionDraft[];
}>;
```

Test that drafts may be incomplete but publication requires exactly five distinct orders, 120 seconds each, non-empty question text, at least one distinct criterion ID per question, unique normalized tags, and safe bounded text. Test that equal preview weights are derived and never submitted as trusted values.

- [ ] **Step 2: Write failing admin boundary tests**

Require exact parsers for dashboard, station list/detail, panels, AI configuration/rates, usage, assessment list/detail, and audit confirmation. Reject any response containing `transcript`, `answerText`, `evidence`, `rawResponse`, or `apiKey` keys at any nesting depth.

Add `tests/integration/adminMmiOperations.integration.test.ts` to the
`include` array in `vitest.mutation.config.mts` so it cannot run without the
disposable-local mutation sentinel.

- [ ] **Step 3: Run tests and verify RED**

Run: `npx vitest run tests/adminMmiValidation.test.ts tests/adminMmiApi.test.ts`

Expected: FAIL because the admin modules and RPCs do not exist.

- [ ] **Step 4: Create audit tables and admin guard**

```sql
CREATE TABLE public.mmi_admin_access_audit (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  response_id uuid REFERENCES public.candidate_mmi_station_responses(id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('scoring_review', 'support', 'cost_review', 'quality_audit')),
  viewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.mmi_admin_change_audit (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

Every admin function begins by checking `auth.uid()`, authenticated role, and `profiles.is_admin = true`. Tables have RLS enabled and no browser table grants. Audit metadata excludes content and secrets.

- [ ] **Step 5: Add station and panel operations**

Create narrow functions:

```sql
public.get_admin_mmi_dashboard() RETURNS jsonb
public.list_admin_mmi_stations(p_query text, p_status text, p_university text, p_limit integer, p_offset integer) RETURNS jsonb
public.get_admin_mmi_station(p_station_id text) RETURNS jsonb
public.save_admin_mmi_station(p_station jsonb, p_expected_version integer) RETURNS jsonb
public.set_admin_mmi_station_status(p_station_id text, p_expected_version integer, p_status text) RETURNS jsonb
public.list_admin_mmi_panels(p_limit integer, p_offset integer) RETURNS jsonb
public.save_admin_mmi_panel(p_panel jsonb) RETURNS jsonb
```

`save_admin_mmi_station` uses optimistic concurrency, writes station/questions/criteria transactionally, increments `content_version`, and inserts the complete immutable version snapshot. Publishing revalidates the 60 + 5×120 contract and criterion presence. Status operations allow `draft`, `published`, and `archived`; hard delete is absent.

- [ ] **Step 6: Add AI settings and rate audit operations**

Create `get_admin_ai_config()` and `save_admin_ai_config(provider, model, base_url, input_rate, cached_input_rate, output_rate)`. Validate provider enum, bounded model, allowlisted HTTPS-compatible base URL policy, and non-negative rates. The getter returns `isConfigured` but never secret value. The save function writes one audit event with old/new non-secret fields and no key data.

- [ ] **Step 7: Add usage and structured-assessment operations**

Create:

```sql
public.get_admin_mmi_usage(p_filters jsonb) RETURNS jsonb
public.list_admin_mmi_assessments(p_filters jsonb) RETURNS jsonb
public.get_admin_mmi_assessment(p_response_id uuid, p_purpose text) RETURNS jsonb
```

Usage returns call count, token totals, known cost, unknown-cost count, average latency, failure rate, and bounded rows filtered by date/user/provider/model/station/scope/outcome. Assessment list/detail returns user display identity, station/question IDs, rubric bullets/check states, percentages, model, tokens, cost, outcome, and timestamps. Detail inserts `mmi_admin_access_audit` before returning. Build JSON from an explicit allowlist; never select or serialize `finalized_transcript`, drafts, evidence, raw content, or key values.

- [ ] **Step 8: Implement strict immutable TypeScript clients**

`createAdminMmiApi(client)` calls only the admin RPCs above. `validateStationDraft(draft, mode)` returns a new normalized object and an issue array; it never mutates UI state. Every response parser uses exact keys, finite numeric bounds, UUID/source-ID patterns, maximum array lengths, and recursive forbidden-key rejection.

- [ ] **Step 9: Run admin unit and disposable integration tests**

Run:

```bash
npx vitest run tests/adminMmiValidation.test.ts tests/adminMmiApi.test.ts
npm run test:integration:mutating
npm run typecheck
```

Expected: PASS or explicit local-only SKIP for mutating integration.

- [ ] **Step 10: Commit the admin operations slice**

```bash
git add supabase/migrations/20260910003000_mmi_admin_operations.sql src/features/adminMmi/types.ts src/features/adminMmi/validation.ts src/features/adminMmi/api.ts tests/adminMmiValidation.test.ts tests/adminMmiApi.test.ts tests/integration/adminMmiOperations.integration.test.ts vitest.mutation.config.mts
git commit -m "feat: add privacy-safe MMI admin operations"
```

### Task 8: Build the inspectable admin workspace

**Files:**
- Modify: `app/admin/index.tsx`
- Modify: `app/admin/ai-config.tsx`
- Modify: `app/admin/questions.tsx`
- Modify: `app/admin/_layout.tsx`
- Create: `app/admin/stations.tsx`
- Create: `app/admin/station-editor.tsx`
- Create: `app/admin/panels.tsx`
- Create: `app/admin/usage.tsx`
- Create: `app/admin/assessments.tsx`
- Create: `app/admin/assessment.tsx`
- Modify: `supabase/functions/manage-ai-key/handler.ts`
- Modify: `supabase/functions/manage-ai-key/index.ts`
- Modify: `tests/manageAiKeyHandler.test.ts`
- Create: `tests/adminMmiUiContract.test.ts`

**Interfaces:**
- Consumes: `createAdminMmiApi` from Task 7.
- Produces: complete station/panel editing, model/rate settings, usage reporting, and audited cross-user structured inspection.

- [ ] **Step 1: Write failing admin UI contract tests**

Assert navigation and safety boundaries:

```ts
expect(dashboard).toMatch(/Station repository/);
expect(dashboard).toMatch(/AI configuration/);
expect(dashboard).toMatch(/Usage and costs/);
expect(dashboard).toMatch(/Assessment explorer/);
expect(aiConfig).toMatch(/MODEL/);
expect(aiConfig).toMatch(/INPUT RATE/);
expect(assessmentDetail).not.toMatch(/transcript|answer text|evidence excerpt|raw response/i);
expect(stationEditor).toMatch(/five ordered questions/i);
expect(stationEditor).toMatch(/marking criteria/i);
```

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npx vitest run tests/adminMmiUiContract.test.ts`

Expected: FAIL because the new screens and cards do not exist.

- [ ] **Step 3: Build the dashboard and repository list**

Load `getDashboard()` once and render cards for published/draft/archived counts, university availability, criterion/import health, active provider/model, current-period known cost, unknown-cost calls, and scoring failures. Add routes for Station repository, Panel library, AI configuration, Usage and costs, Assessment explorer, and existing Feedback desk.

`stations.tsx` supports query, status, university, category, topic, and difficulty filters with bounded pagination. Each row shows station ID, metadata, version, publication state, five-question validity, criterion count, and edit action.

- [ ] **Step 4: Build the full station editor**

Use immutable state updates such as:

```ts
setDraft(current => ({
  ...current,
  questions: current.questions.map(question =>
    question.order === order
      ? { ...question, questionText: value }
      : question),
}));
```

The editor covers scenario, metadata, university tags, image URL, exactly five ordered question panels, and ordered criteria with bullet/domain/source-weight provenance. Display calculated equal percentages, version conflict errors, save-draft confirmation, and publish/unpublish/archive confirmations. Do not offer hard delete.

- [ ] **Step 5: Build the panel library**

List and edit the ten imported panel questions separately. Show notes and cached model answers only in this admin route. Clearly label panels as outside the 11-minute candidate practice pool.

- [ ] **Step 6: Refactor AI configuration onto the admin API**

Keep provider, write-only key replacement, model, and compatible base URL controls. Add numeric input/cached-input/output USD rates per million tokens and show that rate changes affect future calls only. Replace browser `app_config` reads/writes with `getAiConfig()`/`saveAiConfig()`. Keep secret replacement in `manage-ai-key`; add an explicit confirmed clear action whose response returns only `{configured:false}`.

- [ ] **Step 7: Build usage and assessment explorers**

`usage.tsx` renders filters and summary metrics, then per-question rows with provider/model/tokens/cost/latency/outcome. Unknown usage is labelled “Cost unavailable,” not £0/$0.

`assessments.tsx` lists user, station, question, percentage, model, cost state, and timestamp. Opening a row first asks for one purpose from `scoring_review`, `support`, `cost_review`, or `quality_audit`, then routes to `assessment.tsx`, which calls the audited detail RPC and renders only rubric checkboxes plus metadata.

- [ ] **Step 8: Keep old Question Desk links compatible**

Make `app/admin/questions.tsx` replace its route with `/admin/stations`. Update `_layout.tsx` route ownership without weakening its existing admin guard.

- [ ] **Step 9: Run UI tests, typecheck, and build**

Run:

```bash
npx vitest run tests/adminMmiUiContract.test.ts tests/adminMmiApi.test.ts tests/adminMmiValidation.test.ts tests/manageAiKeyHandler.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 10: Commit the admin UI slice**

```bash
git add app/admin src/features/adminMmi tests/adminMmiUiContract.test.ts tests/manageAiKeyHandler.test.ts supabase/functions/manage-ai-key/handler.ts supabase/functions/manage-ai-key/index.ts
git commit -m "feat: expand the MMI admin workspace"
```

### Task 9: Verify privacy, security, coverage, and complete journeys

**Files:**
- Modify: `e2e/cofounder-preview.spec.ts`
- Create: `e2e/rubric-mmi-admin.spec.ts`
- Create: `tests/mmiRubricRetentionPolicy.test.ts`
- Modify: `docs/superpowers/specs/2026-09-10-rubric-university-admin-retention-design.md`

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: automated proof of candidate and admin journeys plus a reviewed graph/security diff.

- [ ] **Step 1: Write failing end-to-end and static privacy tests**

Cover these browser journeys with synthetic local data/network fixtures:

```ts
test('targeted and all-repository cards start distinct 11-minute pools', async ({ page }) => {
  await page.goto('/practice');
  await expect(page.getByText(/Oxford practice/)).toBeVisible();
  await expect(page.getByText(/115 complete 11-minute stations/)).toBeVisible();
  await expect(page.getByText(/155 complete 11-minute stations/)).toBeVisible();
});

test('admin views rubric and cost without answer content', async ({ page }) => {
  await page.goto('/admin/assessments');
  await page.getByText('Scoring review').click();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await expect(page.getByText(/transcript|answer text|raw response/i)).toHaveCount(0);
});
```

The static policy test recursively scans candidate/admin response examples and SQL JSON builders for forbidden retained fields, asserts the 24-hour interval, immediate completion purge, API-key write-only behavior, base-table revokes, fixed search paths, and audit insertion before admin detail return.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `npx vitest run tests/mmiRubricRetentionPolicy.test.ts && npm run test:e2e -- e2e/rubric-mmi-admin.spec.ts`

Expected: FAIL until fixtures and final privacy wiring are complete.

- [ ] **Step 3: Complete local E2E fixtures and privacy copy**

Use only localhost Playwright targets and synthetic IDs/content. Stub narrow RPC/function responses, never real credentials or remote services. Update the approved design status to `Implemented locally; deployment not performed` only after every acceptance assertion passes.

- [ ] **Step 4: Run the full verification matrix**

Run:

```bash
npm test
npm run test:integration:mutating
npm run test:e2e
npm run test:coverage
npm run typecheck
npm run build
npm audit
git diff --check
```

Expected: all configured suites PASS, mutating integration either PASS on a disposable local instance or explicitly SKIP, both coverage runners meet 80%, audit reports no unresolved high/critical production vulnerability, and build/typecheck succeed.

- [ ] **Step 5: Refresh GitNexus and inspect graph changes**

Run:

```bash
node .gitnexus/run.cjs analyze --index-only
node .gitnexus/run.cjs detect-changes --scope all --repo .
node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo .
```

Expected: neither result is partial or truncated. Review every affected scoring, practice, admin, privacy, and import process; run focused regression tests for all listed callers.

- [ ] **Step 6: Perform the final security review**

Inspect the complete diff for hardcoded secrets, answer content in logs, missing input bounds, SQL injection, unsafe dynamic SQL, XSS-capable rendering, CSRF/CORS regressions, SSRF/base-URL regressions, missing authorization, missing rate limits, secret-return paths, and non-cascading account data. Fix every CRITICAL/HIGH finding and repeat Step 4.

- [ ] **Step 7: Commit verification artifacts**

```bash
git add e2e/cofounder-preview.spec.ts e2e/rubric-mmi-admin.spec.ts tests/mmiRubricRetentionPolicy.test.ts docs/superpowers/specs/2026-09-10-rubric-university-admin-retention-design.md
git commit -m "test: verify rubric MMI privacy and admin journeys"
```

## Final Acceptance Checklist

- [ ] A targeted card names the profile university and counts target-tag-plus-`ALL` complete stations.
- [ ] A second card counts and starts all published complete repository stations.
- [ ] Both paths retain the 60 + 5×120 second server-owned schedule.
- [ ] Every answer is assessed in a separate provider request with only its own scenario/question/rubric/transcript.
- [ ] Every workbook criterion appears as one strict checkbox and equal score share.
- [ ] The server, not the model or browser, calculates question and station percentages.
- [ ] Successfully scored transcript text disappears in the same transaction that saves score and usage.
- [ ] Failed/pending transcript text expires within 24 hours and cannot be retrieved afterward.
- [ ] Candidate history and admin explorers contain no audio, transcript, evidence excerpt, or raw provider response.
- [ ] Admin cross-user detail access is authorized and audited.
- [ ] Admins can manage station versions, panel content, publication state, provider, model, rates, structured assessments, and costs.
- [ ] Existing generic results are labelled legacy and are not converted into invented rubric decisions.
- [ ] Account deletion cascades attempts, structured results, usage, and access links.
- [ ] Full tests, coverage, typecheck, build, dependency audit, Git diff checks, and GitNexus change analysis pass.
- [ ] No remote deployment, credential modification, push, or merge occurs without separate user approval.
