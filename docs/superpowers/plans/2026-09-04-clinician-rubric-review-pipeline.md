# Clinician Rubric Review Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, and deploy a disabled-by-default pipeline that turns the 3,300 source marking criteria into exactly 775 traceable draft rubrics, presents them in a clinician-review Google Sheet, and activates the signed batch only after exact-hash attestation.

**Architecture:** A private source snapshot is parsed and reconciled to the deployed normalized prompt identities. Pure TypeScript modules perform explicit domain mapping, deterministic weight normalization, rubric generation, runtime parsing, canonical hashing, and approval verification; a locked-down Supabase migration stages and atomically activates the reviewed batch. Google Sheet review is a separate artifact, and the feature flag remains false throughout generation, review, import, and postflight.

**Tech Stack:** TypeScript, Node.js 24 native type stripping, Node test runner/Vitest, SHA-256, PostgreSQL/Supabase, Google Drive/Sheets, Expo verification pipeline

**Spec:** `docs/superpowers/specs/2026-09-04-clinician-rubric-review-pipeline-design.md`

## Global Constraints

- Keep `normalized_mmi_station_enabled=false` until privacy, scoring-function, Cron, manual-QA, named-account smoke, and deliberate enablement gates all pass.
- Treat the source Google Sheet as read-only and keep its Drive ID, owner email, prompts, marking criteria, and reviewer email out of Git and logs.
- Reconcile to exactly 155 candidate stations, 775 standard prompts, 3,300 real criteria rows, and 10 excluded panel prompts; reject every mismatch.
- Never set `clinician_reviewed_at`, `clinician_reviewed_by`, `status='active'`, or a clinician approval decision before the cofounder personally completes review and attests the exact artifact hash.
- Preserve every source criterion for the 775 candidate prompts with its source row, ID, domain, and weight; reject instead of truncating.
- Run GitNexus upstream impact analysis with each exact symbol name before modifying any existing function, class, method, or exported constant. Warn before proceeding on HIGH or CRITICAL risk.
- Run `gitnexus detect-changes --scope staged --repo InterviewStation` before every commit and re-run `gitnexus analyze .` after every commit.
- Add tests before implementation and keep all enforced coverage categories at or above 80%.
- Apply hosted SQL only to isolated project `obfwfoykalvoxqdnosus`; never mutate shared project `tliwifhnsytxpcynuwsy`.
- Keep actual source snapshots, draft/reviewed rubric JSON, XLSX files, and clinician identity artifacts private and Git-ignored. Commit aggregate manifests only.

## File Structure

### Existing files to modify

- `src/features/mmi/types.ts` — add the new student-feedback template identifier to the client contract.
- `supabase/functions/_shared/mmiContracts.ts` — add the new template definition and retained v2 feedback catalog.
- `supabase/functions/_shared/mmiScoringContract.ts` — retain v1 and introduce pinned scoring contract `2026-09-04.1`.
- `tests/mmiContracts.test.ts` — prove client/Edge parity, version retention, template semantics, and strict parsing.
- `tests/candidateMmiScoring.test.ts` — prove candidate scoring resolves the current retained contract without changing the v1 snapshot.
- `.gitignore` — exclude all private rubric source, draft, review, and signed artifacts.
- `package.json` — add deterministic rubric-generation and verification commands.
- `docs/BEFORE-COFOUNDER-VIEWING.md` — record draft/review and activation evidence without claiming premature approval.
- `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md` — record the disabled importer deployment, clinician gate, and final postflight.

### New implementation files

- `scripts/clinician-rubrics/types.ts` — private source, mapping, rubric, review, artifact, and attestation interfaces.
- `scripts/clinician-rubrics/source.ts` — repeated-header removal, exact source parsing, and 155/775/3300 reconciliation.
- `scripts/clinician-rubrics/domainMapping.ts` — versioned 26-domain proposal and deterministic weight normalization.
- `scripts/clinician-rubrics/generate.ts` — source-backed criterion and safety-proposal generation.
- `scripts/clinician-rubrics/canonical.ts` — canonical serialization and SHA-256 functions.
- `scripts/clinician-rubrics/approval.ts` — per-row approval and exact-hash attestation verification.
- `scripts/generate-clinician-rubric-review.ts` — stdin/private-file CLI that emits private artifacts and aggregate-only stdout.
- `supabase/migrations/20260904000000_clinician_rubric_import.sql` — service-only batch ledger, staging RPC, activation RPC, and fail-closed assertions.

### New tests and fixtures

- `tests/fixtures/clinician-rubrics/source-snapshot.json` — synthetic two-station source with no real prompt content.
- `tests/clinicianRubricSource.test.ts` — source parsing and reconciliation tests.
- `tests/clinicianRubricGeneration.test.ts` — mapping, weights, criteria, safety, parser, and hashing tests.
- `tests/clinicianRubricApproval.test.ts` — review-decision and attestation tests.
- `tests/clinicianRubricImportPolicy.test.ts` — static SQL ownership, ACL, validation, and feature-flag tests.
- `tests/integration/clinicianRubricImport.integration.test.ts` — local 775-row staging/activation and rollback tests.

### Generated private and aggregate artifacts

- Private, ignored: `supabase/imports/20260825_med_interview_question_bank/clinician-rubric-source.json`
- Private, ignored: `supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-draft.json`
- Private, ignored: `supabase/imports/20260825_med_interview_question_bank/clinician-rubric-review-rows.json`
- Private, ignored: `supabase/imports/20260825_med_interview_question_bank/clinician-rubric-review.xlsx`
- Private, ignored after review: `supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-reviewed.json`
- Tracked aggregate evidence: `supabase/imports/20260825_med_interview_question_bank/clinician-rubric-manifest.json`

---

### Task 1: Retained Scoring Contract v2

**Files:**
- Modify: `src/features/mmi/types.ts:16-30`
- Modify: `supabase/functions/_shared/mmiContracts.ts:16-30`
- Modify: `supabase/functions/_shared/mmiContracts.ts:166-209`
- Modify: `supabase/functions/_shared/mmiScoringContract.ts:211-239`
- Test: `tests/mmiContracts.test.ts`
- Test: `tests/candidateMmiScoring.test.ts`

**Interfaces:**
- Produces: `MMI_STUDENT_FEEDBACK_TEMPLATES` containing `organise-response`.
- Produces: `MMI_STUDENT_FEEDBACK_CATALOGS['2026-09-04.1']` with a structure-improvement definition.
- Produces: `MMI_SCORING_CONTRACTS['2026-09-04.1']` and `CURRENT_MMI_SCORING_CONTRACT_VERSION === '2026-09-04.1'`.
- Preserves: byte-equivalent `MMI_SCORING_CONTRACTS['2026-08-17.1']` behavior.

- [ ] **Step 1: Run impact analysis on the existing exported contract symbols**

Run:

```bash
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js impact MMI_STUDENT_FEEDBACK_TEMPLATES --direction upstream
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js impact MMI_STUDENT_FEEDBACK_CATALOGS --direction upstream
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js impact CURRENT_MMI_SCORING_CONTRACT_VERSION --direction upstream
```

Expected: tests and scoring-handler dependents are identified; any HIGH/CRITICAL result is reported before editing.

- [ ] **Step 2: Write failing retained-contract tests**

Add assertions equivalent to:

```typescript
assert.equal(CURRENT_MMI_SCORING_CONTRACT_VERSION, '2026-09-04.1');
assert.equal(
  getMmiScoringContract('2026-08-17.1').studentFeedbackCatalog.templates['organise-response'],
  undefined,
);
assert.deepEqual(
  getMmiScoringContract('2026-09-04.1').studentFeedbackCatalog.templates['organise-response'],
  {
    kind: 'improvement',
    text: 'Organise your response into clear priorities and explain the order in which you would address them.',
  },
);
assert.equal(
  createMmiScoringContractSnapshot('2026-08-17.1').version,
  '2026-08-17.1',
);
```

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```bash
node --test tests/mmiContracts.test.ts tests/candidateMmiScoring.test.ts
```

Expected: FAIL because `2026-09-04.1` and `organise-response` do not exist.

- [ ] **Step 4: Implement the minimal retained v2 catalog and contract**

Use the same identifier in client and Edge tuples:

```typescript
'organise-response',
```

Add the v2-only template:

```typescript
const V2_STUDENT_FEEDBACK_TEMPLATE_DEFINITIONS = deepFreeze({
  ...V1_STUDENT_FEEDBACK_TEMPLATE_DEFINITIONS,
  'organise-response': {
    kind: 'improvement',
    text: 'Organise your response into clear priorities and explain the order in which you would address them.',
  },
});
```

Retain both catalogs and pin both contracts:

```typescript
export const CURRENT_MMI_SCORING_CONTRACT_VERSION = '2026-09-04.1';

export const MMI_SCORING_CONTRACTS: MmiScoringContractRegistry = deepFreeze({
  '2026-08-17.1': cloneJson(PINNED_V1_CONTRACT),
  '2026-09-04.1': cloneJson(PINNED_V2_CONTRACT),
});
```

- [ ] **Step 5: Run focused and compile-time contract tests to verify GREEN**

Run:

```bash
node --test tests/mmiContracts.test.ts tests/candidateMmiScoring.test.ts
npm run typecheck
```

Expected: PASS; v1 remains accessible and v2 is current.

- [ ] **Step 6: Commit the retained scoring contract**

```bash
git add src/features/mmi/types.ts supabase/functions/_shared/mmiContracts.ts supabase/functions/_shared/mmiScoringContract.ts tests/mmiContracts.test.ts tests/candidateMmiScoring.test.ts
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: retain clinician rubric scoring contract v2"
```

---

### Task 2: Exact Source Snapshot Parser

**Files:**
- Create: `scripts/clinician-rubrics/types.ts`
- Create: `scripts/clinician-rubrics/source.ts`
- Create: `tests/fixtures/clinician-rubrics/source-snapshot.json`
- Create: `tests/clinicianRubricSource.test.ts`

**Interfaces:**
- Produces: `parseRubricSourceSnapshot(value: unknown, expectations?: SourceExpectations): ReconciledRubricSource`.
- Produces: `PRODUCTION_SOURCE_EXPECTATIONS` with `155`, `775`, `3300`, and `10`.
- Produces: stable `SourcePrompt`, `SourceCriterion`, and `ReconciledRubricSource` types.
- Consumes later: Task 3 and Task 4 receive `ReconciledRubricSource.prompts`.

- [ ] **Step 1: Define exact source and reconciled interfaces in the failing test**

The production types must include:

```typescript
export interface SourceExpectations {
  readonly stationCount: number;
  readonly promptCount: number;
  readonly criterionCount: number;
  readonly excludedPanelCount: number;
}

export interface RawRubricSourceSnapshot {
  readonly artifactVersion: 1;
  readonly sheets: {
    readonly stations: readonly (readonly unknown[])[];
    readonly subQuestions: readonly (readonly unknown[])[];
    readonly markingCriteria: readonly (readonly unknown[])[];
    readonly panelQuestions: readonly (readonly unknown[])[];
  };
}

export interface SourceStation {
  readonly stationId: string;
  readonly stationType: string;
  readonly category: string;
  readonly topic: string;
  readonly scenarioText: string;
}

export interface SourceCriterion {
  readonly rowNumber: number;
  readonly criterionId: string;
  readonly subQuestionId: string;
  readonly bulletText: string;
  readonly weight: number;
  readonly domain: string;
}

export interface SourcePrompt {
  readonly stationId: string;
  readonly subQuestionId: string;
  readonly order: 1 | 2 | 3 | 4 | 5;
  readonly scenarioText: string;
  readonly questionText: string;
  readonly category: string;
  readonly topic: string;
  readonly criteria: readonly SourceCriterion[];
}

export interface ReconciledRubricSource {
  readonly sourceFingerprint: string;
  readonly stations: readonly SourceStation[];
  readonly prompts: readonly SourcePrompt[];
  readonly criterionCount: number;
  readonly excludedPanelCount: number;
}
```

Test successful parsing, repeated headers, one fully empty allocated row, duplicate IDs, orphan criteria, unknown prompt orders, missing criteria, panel exclusion, and exact-count failure.

- [ ] **Step 2: Run the source test to verify RED**

Run:

```bash
node --test tests/clinicianRubricSource.test.ts
```

Expected: FAIL because `parseRubricSourceSnapshot` is absent.

- [ ] **Step 3: Implement strict row parsing and reconciliation**

Expose configurable test expectations while pinning production values:

```typescript
export const PRODUCTION_SOURCE_EXPECTATIONS = Object.freeze({
  stationCount: 155,
  promptCount: 775,
  criterionCount: 3300,
  excludedPanelCount: 10,
});

export function parseRubricSourceSnapshot(
  value: unknown,
  expectations: SourceExpectations = PRODUCTION_SOURCE_EXPECTATIONS,
): ReconciledRubricSource {
  const snapshot = parseExactSnapshotShape(value);
  return reconcileSourceRows(snapshot, expectations);
}
```

Implement `parseExactSnapshotShape(value: unknown): RawRubricSourceSnapshot` as the exact outer-shape validator and `reconcileSourceRows(snapshot: RawRubricSourceSnapshot, expectations: SourceExpectations): ReconciledRubricSource` as the only orchestration helper. Inside reconciliation, accept only exact headers, remove rows only when they are fully empty or exact repeated headers, normalize line endings/NFKC, and reject control/invisible characters rather than deleting clinical text. Parse stations, prompts, criteria, and excluded panels into immutable local arrays; verify referential integrity and exact counts before calculating the canonical source fingerprint.

- [ ] **Step 4: Run source tests and typecheck**

Run:

```bash
node --test tests/clinicianRubricSource.test.ts
npm run typecheck
```

Expected: PASS with all malformed-source cases rejected.

- [ ] **Step 5: Commit the source parser**

```bash
git add scripts/clinician-rubrics/types.ts scripts/clinician-rubrics/source.ts tests/fixtures/clinician-rubrics/source-snapshot.json tests/clinicianRubricSource.test.ts
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: reconcile clinician rubric source rows"
```

---

### Task 3: Domain Mapping and Deterministic Weights

**Files:**
- Create: `scripts/clinician-rubrics/domainMapping.ts`
- Modify: `scripts/clinician-rubrics/types.ts`
- Create: `tests/clinicianRubricGeneration.test.ts`

**Interfaces:**
- Produces: `DOMAIN_MAPPING_VERSION === '2026-09-04.1'`.
- Produces: `mapSourceDomain(domain: string): DomainProposal`.
- Produces: `normaliseDimensionWeights(criteria: readonly SourceCriterion[]): MmiDimensionWeights`.
- Produces: `DomainProposal` with `dimension`, `confidence`, and `safetyProposal`.

Add these shared types to `scripts/clinician-rubrics/types.ts`:

```typescript
export type RubricDimension =
  | 'structure'
  | 'ethics'
  | 'communication'
  | 'reflection'
  | 'nhs_awareness';

export type MmiDimensionWeights = Readonly<Record<RubricDimension, number>>;

export interface DomainProposal {
  readonly dimension: RubricDimension;
  readonly confidence: 'high' | 'review_required';
  readonly safetyProposal: 'immediate-risk' | 'confidentiality' | 'senior-support' | null;
}
```

- [ ] **Step 1: Write failing tests for all 26 source domains**

Use exact expectations:

```typescript
assert.deepEqual(mapSourceDomain('ethics'), {
  dimension: 'ethics', confidence: 'high', safetyProposal: null,
});
assert.deepEqual(mapSourceDomain('clinical_reasoning'), {
  dimension: 'structure', confidence: 'review_required', safetyProposal: null,
});
assert.deepEqual(mapSourceDomain('patient_safety'), {
  dimension: 'ethics', confidence: 'review_required', safetyProposal: 'immediate-risk',
});
assert.throws(() => mapSourceDomain('invented_domain'), /Unknown source domain/);
```

Add weight cases for one dimension, five dimensions, stable ties, zero-weight dimensions, and exact sum `1`.

- [ ] **Step 2: Run generation tests to verify RED**

```bash
node --test tests/clinicianRubricGeneration.test.ts
```

Expected: FAIL because mapping and weight functions are absent.

- [ ] **Step 3: Implement the immutable mapping table**

Define every source label explicitly; do not use prefix or fuzzy matching:

```typescript
export const DOMAIN_MAPPING_VERSION = '2026-09-04.1' as const;

export const SOURCE_DOMAIN_MAPPING = Object.freeze({
  ethics: proposal('ethics', 'high'),
  professionalism: proposal('ethics', 'review_required'),
  patient_benefit: proposal('ethics', 'review_required'),
  communication: proposal('communication', 'high'),
  reflection: proposal('reflection', 'high'),
  stress_management: proposal('reflection', 'review_required'),
  nhs_hot_topics: proposal('nhs_awareness', 'high'),
  nhs_topics: proposal('nhs_awareness', 'high'),
  healthcare_relevance: proposal('nhs_awareness', 'review_required'),
  health_inequalities: proposal('nhs_awareness', 'review_required'),
  public_health: proposal('nhs_awareness', 'review_required'),
  governance: proposal('nhs_awareness', 'review_required'),
  evidence_based_medicine: proposal('nhs_awareness', 'review_required'),
  judgement: proposal('structure', 'review_required'),
  prioritisation: proposal('structure', 'review_required'),
  information_gathering: proposal('structure', 'review_required'),
  critical_thinking: proposal('structure', 'review_required'),
  planning: proposal('structure', 'review_required'),
  clinical_reasoning: proposal('structure', 'review_required'),
  teamwork: proposal('structure', 'review_required'),
  delegation: proposal('structure', 'review_required'),
  content: proposal('structure', 'review_required'),
  safety: proposal('ethics', 'review_required', 'immediate-risk'),
  patient_safety: proposal('ethics', 'review_required', 'immediate-risk'),
  safeguarding: proposal('ethics', 'review_required', 'senior-support'),
  escalation: proposal('ethics', 'review_required', 'senior-support'),
});
```

- [ ] **Step 4: Implement largest-remainder normalization**

Use 10,000 integer units, stable dimension order, and remainder/index sorting. Return all five dimensions divided by 10,000 and assert the integer units sum to 10,000 before conversion.

```typescript
const WEIGHT_UNITS = 10_000;
const MMI_DIMENSION_ORDER = [
  'structure', 'ethics', 'communication', 'reflection', 'nhs_awareness',
] as const;
```

- [ ] **Step 5: Run focused tests and typecheck**

```bash
node --test tests/clinicianRubricGeneration.test.ts
npm run typecheck
```

Expected: PASS; every production source domain is explicit and unknown domains fail closed.

- [ ] **Step 6: Commit mapping and weights**

```bash
git add scripts/clinician-rubrics/types.ts scripts/clinician-rubrics/domainMapping.ts tests/clinicianRubricGeneration.test.ts
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: map clinician rubric dimensions deterministically"
```

---

### Task 4: Draft Rubric Generation and Canonical Hashing

**Files:**
- Create: `scripts/clinician-rubrics/generate.ts`
- Create: `scripts/clinician-rubrics/canonical.ts`
- Modify: `scripts/clinician-rubrics/types.ts`
- Modify: `tests/clinicianRubricGeneration.test.ts`

**Interfaces:**
- Produces: `generateDraftArtifact(source: ReconciledRubricSource): DraftRubricArtifact`.
- Produces: `canonicalSerialize(value: JsonValue): string`.
- Produces: `sha256Canonical(value: JsonValue): string`.
- Produces: `DraftReviewRow` with exact source trace, mapping confidence, parser result, and blank clinician decision.

Add the shared artifact types before implementing generation:

```typescript
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface RubricTrace {
  readonly sourceCriterionIds: readonly string[];
  readonly sourceRows: readonly number[];
  readonly sourceDomains: readonly string[];
}

export interface DraftRubricRecord {
  readonly promptId: string;
  readonly rubric: MmiRubric;
  readonly trace: RubricTrace;
}

export interface DraftReviewRow {
  readonly stationId: string;
  readonly promptId: string;
  readonly promptOrder: 1 | 2 | 3 | 4 | 5;
  readonly mappingReviewRequired: boolean;
  readonly parserResult: 'valid';
  readonly traceResult: 'complete';
  readonly clinicianDecision: '';
}

export interface DraftRubricArtifact {
  readonly artifactVersion: 1;
  readonly sourceFingerprint: string;
  readonly mappingVersion: '2026-09-04.1';
  readonly scoringContractVersion: '2026-09-04.1';
  readonly rubrics: readonly DraftRubricRecord[];
  readonly reviewRows: readonly DraftReviewRow[];
}
```

Import the existing `MmiRubric` contract type from `supabase/functions/_shared/mmiContracts.ts` rather than declaring a second rubric shape.

- [ ] **Step 1: Write failing rubric and canonical-hash tests**

Assert that generation:

```typescript
const artifact = generateDraftArtifact(source);
assert.equal(artifact.rubrics.length, source.prompts.length);
assert.equal(artifact.reviewRows.every(row => row.clinicianDecision === ''), true);
assert.equal(artifact.rubrics.every(row => parseMmiRubric(row.rubric).version === 1), true);
assert.equal(sha256Canonical({ b: 2, a: 1 }), sha256Canonical({ a: 1, b: 2 }));
assert.equal(
  artifact.rubrics.flatMap(row => row.trace.sourceCriterionIds).length,
  source.criterionCount,
);
```

Add rejection tests for duplicate source traces, criteria over 1,000 characters, more than 20 criteria, missing strength/improvement, unknown feedback templates, and unresolved safety groups.

- [ ] **Step 2: Run generation tests to verify RED**

```bash
node --test tests/clinicianRubricGeneration.test.ts
```

Expected: FAIL because draft generation and canonical hashing are absent.

- [ ] **Step 3: Implement source-backed criterion generation**

Use fixed template mappings:

```typescript
const STRENGTH_TEMPLATE_BY_DIMENSION = Object.freeze({
  structure: 'clear-priorities',
  ethics: 'balanced-ethical-reasoning',
  communication: 'patient-centred-language',
  reflection: 'reflective-learning',
  nhs_awareness: 'nhs-context',
});

const IMPROVEMENT_TEMPLATE_BY_DIMENSION = Object.freeze({
  structure: 'organise-response',
  ethics: 'weigh-ethical-pillars',
  communication: 'check-understanding',
  reflection: 'deepen-reflection',
  nhs_awareness: 'connect-nhs-values',
});
```

For each applicable dimension, preserve complete source bullets in stable criterion-ID order and build one strength plus one improvement criterion. Reject text overflow rather than trimming.

- [ ] **Step 4: Implement safety proposals and trace proof**

Map only explicit safety proposals to:

```typescript
const SAFETY_TEMPLATE_BY_GROUP = Object.freeze({
  'immediate-risk': 'escalate-immediate-risk',
  confidentiality: 'protect-confidentiality',
  'senior-support': 'seek-senior-support',
});
```

Every generated runtime criterion and safety item must point to one or more source criterion IDs. Verify set equality between the source IDs and the union of trace IDs.

- [ ] **Step 5: Implement canonical serialization**

Sort object keys recursively, preserve array order, reject non-finite numbers and non-JSON values, serialize UTF-8 without whitespace, and hash with Node `createHash('sha256')`.

- [ ] **Step 6: Parse every generated rubric before returning**

```typescript
for (const row of rubrics) {
  parseMmiRubric(row.rubric, MMI_STUDENT_FEEDBACK_CATALOGS['2026-09-04.1']);
}
```

Generation must throw before producing files when any rubric fails.

- [ ] **Step 7: Run focused tests, typecheck, and coverage**

```bash
node --test tests/clinicianRubricGeneration.test.ts
npm run typecheck
npm run test:coverage
```

Expected: PASS with all enforced coverage categories at or above 80%.

- [ ] **Step 8: Commit generation and hashing**

```bash
git add scripts/clinician-rubrics/types.ts scripts/clinician-rubrics/generate.ts scripts/clinician-rubrics/canonical.ts tests/clinicianRubricGeneration.test.ts
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: generate traceable clinician rubric drafts"
```

---

### Task 5: Review Decisions and Exact-Hash Attestation

**Files:**
- Create: `scripts/clinician-rubrics/approval.ts`
- Modify: `scripts/clinician-rubrics/types.ts`
- Create: `tests/clinicianRubricApproval.test.ts`

**Interfaces:**
- Produces: `verifyReviewedArtifact(input: ReviewVerificationInput): VerifiedReviewedArtifact`.
- Consumes: exact `DraftRubricArtifact`, 26 domain decisions, 775 rubric decisions, and clinician attestation.
- Guarantees: returned `VerifiedReviewedArtifact` is branded and can be passed to the import CLI.

- [ ] **Step 1: Write failing approval-gate tests**

Define the decision and attestation shapes:

```typescript
export interface ClinicianAttestation {
  readonly reviewerName: string;
  readonly reviewerQualification: string;
  readonly reviewerEmail: string;
  readonly approvedArtifactSha256: string;
  readonly attestedAt: string;
}

export type ReviewDecision = 'Approved' | 'Change requested' | '';

export interface DomainReviewDecision {
  readonly sourceDomain: string;
  readonly decision: ReviewDecision;
  readonly clinicianComment: string;
}

export interface RubricReviewDecision {
  readonly promptId: string;
  readonly decision: ReviewDecision;
  readonly clinicianCorrections: MmiRubric | null;
  readonly clinicianComment: string;
  readonly approvedSafetyGroups: readonly string[];
}

export interface ReviewVerificationInput {
  readonly artifact: DraftRubricArtifact;
  readonly domainDecisions: readonly DomainReviewDecision[];
  readonly rubricDecisions: readonly RubricReviewDecision[];
  readonly attestation: ClinicianAttestation;
}

declare const VERIFIED_REVIEW_ARTIFACT: unique symbol;

export type VerifiedReviewedArtifact = DraftRubricArtifact & {
  readonly artifactSha256: string;
  readonly [VERIFIED_REVIEW_ARTIFACT]: true;
};
```

Test rejection of any blank/change-requested row, unresolved domain, unreviewed safety proposal, malformed email, empty qualification, non-ISO timestamp, stale hash, changed rubric content, wrong prompt count, and duplicate target.

- [ ] **Step 2: Run approval tests to verify RED**

```bash
node --test tests/clinicianRubricApproval.test.ts
```

Expected: FAIL because `verifyReviewedArtifact` is absent.

- [ ] **Step 3: Implement the approval verifier**

The function must recompute the rubric-content artifact hash after removing display-only formulas and before reading the signed hash:

```typescript
export function verifyReviewedArtifact(
  input: ReviewVerificationInput,
): VerifiedReviewedArtifact {
  assertExactDomainApprovals(input.domainDecisions);
  assertExactRubricApprovals(input.rubricDecisions, input.artifact.rubrics);
  assertSafetyApprovals(input.rubricDecisions);
  const artifactSha256 = sha256Canonical(toCanonicalReviewedPayload(input));
  assertAttestation(input.attestation, artifactSha256);
  return brandVerifiedArtifact(input, artifactSha256);
}
```

No default reviewer identity or timestamp is permitted.

Implement these local helpers with the shown responsibilities so the approval path is mechanically testable: `assertExactDomainApprovals(decisions)` requires one approved row for each of the 26 known domains; `assertExactRubricApprovals(decisions, rubrics)` requires exactly one approved decision for each prompt; `assertSafetyApprovals(decisions)` rejects every proposed but unapproved safety group; `toCanonicalReviewedPayload(input)` removes display-only fields while applying clinician corrections; `assertAttestation(attestation, hash)` validates identity fields, ISO time, and exact hash equality; and `brandVerifiedArtifact(input, hash)` constructs the branded immutable return value only after every assertion passes.

- [ ] **Step 4: Run approval tests and typecheck**

```bash
node --test tests/clinicianRubricApproval.test.ts
npm run typecheck
```

Expected: PASS; only a fully approved, current-hash artifact receives the branded type.

- [ ] **Step 5: Commit the approval verifier**

```bash
git add scripts/clinician-rubrics/types.ts scripts/clinician-rubrics/approval.ts tests/clinicianRubricApproval.test.ts
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: verify clinician rubric hash attestation"
```

---

### Task 6: Service-Only Staging and Atomic Activation Migration

**Files:**
- Create: `supabase/migrations/20260904000000_clinician_rubric_import.sql`
- Create: `tests/clinicianRubricImportPolicy.test.ts`
- Create: `tests/integration/clinicianRubricImport.integration.test.ts`
- Modify: `tests/integration/localDatabaseFixture.ts`

**Interfaces:**
- Produces: `public.mmi_rubric_import_batches` aggregate ledger.
- Produces: `public.stage_clinician_rubric_batch(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, JSONB)` callable only by `service_role`.
- Produces: `public.activate_clinician_rubric_batch(TEXT)` callable only by `service_role`.
- Consumes after sign: canonical artifact SHA, source fingerprint, scoring contract version, reviewer profile UUID, review timestamp, and 775-row JSONB payload.

- [ ] **Step 1: Write failing static migration-policy tests**

Require the SQL to contain:

```typescript
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mmi_rubric_import_batches/i);
assert.match(sql, /CHECK \(row_count = 775\)/i);
assert.match(sql, /stage_clinician_rubric_batch/i);
assert.match(sql, /activate_clinician_rubric_batch/i);
assert.match(sql, /normalized_mmi_station_enabled[\s\S]*?false/i);
assert.match(sql, /REVOKE ALL[\s\S]*?FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT EXECUTE[\s\S]*?TO service_role/i);
```

Also reject dynamic SQL, unqualified security-definer references, authenticated execution, partial activation, and absent row-count checks.

- [ ] **Step 2: Write failing local integration tests**

Generate 155 synthetic stations with five prompts each and 775 valid version-1 rubric payloads. Test:

- staging creates 775 drafts and one staged ledger;
- runtime roles cannot read tables or execute either RPC;
- feature flag true blocks staging and activation;
- 774, 776, duplicate, unknown, unpublished, invalid-weight, invalid-template, wrong-hash, and missing-reviewer payloads fail transactionally;
- activation marks all 775 active in one transaction;
- a conflicting active target causes zero new activations;
- identical retry returns the recorded result; and
- changed payload under the same artifact hash fails.

- [ ] **Step 3: Run policy and integration tests to verify RED**

```bash
node --test tests/clinicianRubricImportPolicy.test.ts
SUPABASE_LOCAL_MUTATION_TESTS=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA npm run test:integration:mutating -- tests/integration/clinicianRubricImport.integration.test.ts
```

Expected: FAIL because the migration and RPCs are absent.

- [ ] **Step 4: Implement the aggregate ledger and validation helpers**

The ledger must store hashes and aggregate provenance, never rubric text:

```sql
CREATE TABLE IF NOT EXISTS public.mmi_rubric_import_batches (
  artifact_sha256 TEXT PRIMARY KEY CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  source_fingerprint TEXT NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  scoring_contract_version TEXT NOT NULL,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count = 775),
  status TEXT NOT NULL CHECK (status IN ('staged', 'active')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);
```

Enable RLS, grant no table access to runtime roles, and restrict service-role table access to columns needed for the two RPCs.

- [ ] **Step 5: Implement the staging RPC**

Use `SECURITY DEFINER`, owner `postgres`, fixed `search_path = pg_catalog, public, extensions, pg_temp`, and fully qualified relations. Validate exact JSON keys, 775 distinct prompt IDs, published prompt membership, version `1`, reviewed content shape, reviewer profile existence, current scoring contract `2026-09-04.1`, feature flag false, and payload fingerprint before inserting drafts plus the staged ledger in one transaction.

- [ ] **Step 6: Implement the activation RPC**

Recompute the stored draft payload fingerprint, verify all 775 rows still match the staged artifact, verify feature flag false and zero conflicting active rows, then update exactly 775 rows from `draft` to `active`. Require `GET DIAGNOSTICS v_activated = ROW_COUNT` and raise unless `v_activated = 775` before marking the ledger active.

- [ ] **Step 7: Add ownership, ACL, default-privilege, and catalog postconditions**

End the migration with a fail-closed `DO` block verifying:

- function owners and `prosecdef` values;
- fixed `proconfig` search paths;
- no `PUBLIC`, `anon`, or `authenticated` execution;
- only `service_role` execution;
- RLS enabled on the ledger and rubric table;
- no runtime table privilege on ledger or rubrics; and
- both functions resolve to the exact expected argument signatures.

- [ ] **Step 8: Run policy, local integration, and full tests**

```bash
node --test tests/clinicianRubricImportPolicy.test.ts
SUPABASE_LOCAL_MUTATION_TESTS=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA npm run test:integration:mutating -- tests/integration/clinicianRubricImport.integration.test.ts
npm test
npm run typecheck
```

Expected: PASS; 775-row activation is atomic and runtime roles remain closed.

- [ ] **Step 9: Commit the import boundary**

```bash
git add supabase/migrations/20260904000000_clinician_rubric_import.sql tests/clinicianRubricImportPolicy.test.ts tests/integration/clinicianRubricImport.integration.test.ts tests/integration/localDatabaseFixture.ts
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: stage and activate signed clinician rubrics"
```

---

### Task 7: Private Artifact CLI and Aggregate Manifest

**Files:**
- Create: `scripts/generate-clinician-rubric-review.ts`
- Modify: `.gitignore`
- Modify: `package.json`
- Create during execution: private/ignored source and draft JSON files listed under File Structure.
- Create: `supabase/imports/20260825_med_interview_question_bank/clinician-rubric-manifest.json`
- Test: `tests/clinicianRubricGeneration.test.ts`

**Interfaces:**
- Produces command: `npm run rubrics:generate -- --stdin`.
- Produces command: `npm run rubrics:verify -- --reviewed supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-reviewed.json`.
- Stdout contains aggregate counts and hashes only.
- Stderr contains stable error codes without prompt, criterion, reviewer, or attestation content.

- [ ] **Step 1: Add a failing CLI subprocess test**

Invoke the CLI with the synthetic fixture over stdin and assert:

```typescript
assert.deepEqual(JSON.parse(stdout), {
  stationCount: 2,
  promptCount: 10,
  criterionCount: 20,
  rubricCount: 10,
  sourceFingerprint: expectedSourceFingerprint,
  draftArtifactSha256: expectedDraftHash,
});
assert.doesNotMatch(stdout, /Synthetic scenario|Synthetic criterion/);
```

Add a malformed-input case requiring exit code `1`, code `invalid_source_snapshot`, and no echoed source text.

- [ ] **Step 2: Run the CLI test to verify RED**

```bash
node --test tests/clinicianRubricGeneration.test.ts
```

Expected: FAIL because the CLI and package commands are absent.

- [ ] **Step 3: Implement stdin/private-file modes and atomic private writes**

The CLI must read all input before parsing, write each artifact to a same-directory temporary filename, rename only after all generation and validation succeeds, and set file mode `0o600` where supported. Never print private output paths unless `--show-paths` is explicitly supplied.

```typescript
const sourceText = options.stdin
  ? await readStdinUtf8(MAX_SOURCE_BYTES)
  : await readFile(options.sourcePath, 'utf8');
const source = parseRubricSourceSnapshot(JSON.parse(sourceText), options.expectations);
const artifact = generateDraftArtifact(source);
await writePrivateArtifactsAtomically(options.outputDirectory, source, artifact);
process.stdout.write(`${JSON.stringify(toAggregateProof(source, artifact))}\n`);
```

- [ ] **Step 4: Add exact private ignore rules and package scripts**

Add:

```gitignore
/supabase/imports/20260825_med_interview_question_bank/clinician-rubric-source.json
/supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-draft.json
/supabase/imports/20260825_med_interview_question_bank/clinician-rubric-review-rows.json
/supabase/imports/20260825_med_interview_question_bank/clinician-rubric-review.xlsx
/supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-reviewed.json
```

Add package commands using native type stripping:

```json
"rubrics:generate": "node --experimental-strip-types scripts/generate-clinician-rubric-review.ts",
"rubrics:verify": "node --experimental-strip-types scripts/generate-clinician-rubric-review.ts --verify"
```

Use explicit `.ts` extensions for every relative import reached by these Node entry points so Node 24 native type stripping resolves modules consistently with the typechecker.

- [ ] **Step 5: Run tests, typecheck, and secret/private-artifact scan**

```bash
node --test tests/clinicianRubricSource.test.ts tests/clinicianRubricGeneration.test.ts tests/clinicianRubricApproval.test.ts
npm run typecheck
git check-ignore supabase/imports/20260825_med_interview_question_bank/clinician-rubric-source.json supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-draft.json supabase/imports/20260825_med_interview_question_bank/clinician-rubric-review.xlsx
```

Expected: all tests pass and all private paths are ignored.

- [ ] **Step 6: Capture the live source through bounded read-only Sheet ranges**

Resolve the private `.gsheet` pointer outside Git, read spreadsheet metadata first, then read only these metadata-derived ranges:

- `stations!A1:I1000`;
- `sub_questions!A1:F1000`;
- `marking_criteria!A1:E4029`; and
- `panel_questions!A1:I1000`.

Assemble the returned values in memory with their 1-based row numbers and stream the exact JSON object to `npm run rubrics:generate -- --stdin`. Do not print the values or persist the Drive ID.

- [ ] **Step 7: Verify the real aggregate proof**

Parse stdout and require the fixed aggregate fields plus two concrete 64-character hashes:

```typescript
const proof = JSON.parse(stdout);
assert.deepEqual(
  {
    stationCount: proof.stationCount,
    promptCount: proof.promptCount,
    criterionCount: proof.criterionCount,
    excludedPanelCount: proof.excludedPanelCount,
    rubricCount: proof.rubricCount,
    parserFailureCount: proof.parserFailureCount,
    untracedCriterionCount: proof.untracedCriterionCount,
  },
  {
    stationCount: 155,
    promptCount: 775,
    criterionCount: 3300,
    excludedPanelCount: 10,
    rubricCount: 775,
    parserFailureCount: 0,
    untracedCriterionCount: 0,
  },
);
assert.match(proof.sourceFingerprint, /^[a-f0-9]{64}$/);
assert.match(proof.draftArtifactSha256, /^[a-f0-9]{64}$/);
```

Record both exact hashes in the aggregate manifest. Abort on any non-zero parser or trace count.

- [ ] **Step 8: Commit only code, ignore rules, and aggregate manifest**

```bash
git add .gitignore package.json scripts/generate-clinician-rubric-review.ts supabase/imports/20260825_med_interview_question_bank/clinician-rubric-manifest.json tests/clinicianRubricGeneration.test.ts
git status --short
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "feat: produce private clinician rubric review artifacts"
```

Expected: no private source, rubric content, workbook, Drive ID, or clinician identity is staged.

---

### Task 8: Clinician Review Google Sheet

**Files and external artifacts:**
- Read: private `clinician-rubric-review-rows.json`
- Generate: private `clinician-rubric-review.xlsx`
- Create: one new native Google Sheet in `My Drive/ChatGPT`
- Never modify: source `med_interview_question_bank.gsheet`

**Interfaces:**
- Produces: a native review Sheet with `Instructions & Attestation`, `Domain Mapping`, `Rubric Review`, and `Validation Summary` tabs.
- Produces: exact reviewer-editable columns and protected derived columns.
- Consumes after review: Task 10 reads decisions and attestation from this distinct Sheet.

- [ ] **Step 1: Use the Spreadsheets workflow to generate the local XLSX**

Create four sheets with these exact columns:

```text
Instructions & Attestation:
Field | Value | Validation

Domain Mapping:
Source domain | Source criterion count | Prompt count | Proposed dimension | Confidence | Safety proposal | Clinician decision | Clinician comment

Rubric Review:
Station ID | Prompt ID | Order | Category | Topic | Scenario | Question | Source criteria | Source domains and weights | Proposed dimension weights | Proposed strength criteria | Proposed improvement criteria | Proposed safety items | Parser result | Trace result | Mapping review required | Clinician decision | Clinician corrections | Clinician comment

Validation Summary:
Metric | Required | Current | Status
```

Populate exactly 26 domain rows and 775 rubric rows. Keep all source and rubric text wrapped, top-aligned, and hidden from any public link.

- [ ] **Step 2: Add review controls and formulas**

Use dropdown validation `Approved, Change requested` only in clinician-decision columns. Leave every decision blank. Add summary formulas for approved, change-requested, unreviewed, parser failures, trace failures, mapping-review-required, and current artifact hash. Protect identity, source, proposal, formula, and validation columns.

- [ ] **Step 3: Import as a new native Google Sheet**

Import the local XLSX with native Google Sheets conversion into `My Drive/ChatGPT`. Verify the returned spreadsheet ID differs from the private source Sheet ID before any post-import update.

- [ ] **Step 4: Restrict sharing**

Keep the new Sheet private to the owner until the cofounder supplies the account email to share. Do not enable link sharing or domain-wide access. When the email is supplied, grant `writer` to that exact account only.

- [ ] **Step 5: Verify metadata and bounded ranges**

Read back metadata, record exact `sheetId` values, and verify:

- four visible tabs with exact titles;
- 27 populated rows including the header in `Domain Mapping`;
- 776 populated rows including the header in `Rubric Review`;
- dropdown validation only in intended decision cells;
- protected derived columns;
- zero prefilled clinician decisions;
- no broad sharing; and
- no formulas with external URLs or source-Sheet IDs.

- [ ] **Step 6: Record aggregate review-package evidence**

Update the tracked manifest with review Sheet creation timestamp, tab names, row counts, draft artifact hash, and `review_status: awaiting_clinician`. Do not commit the Sheet ID, URL, reviewer email, prompt text, or rubric text.

- [ ] **Step 7: Commit aggregate review readiness**

```bash
git add supabase/imports/20260825_med_interview_question_bank/clinician-rubric-manifest.json
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "docs: record clinician rubric review readiness"
```

---

### Task 9: Pre-Sign Deployment and Full Verification

**Files:**
- Modify: `docs/BEFORE-COFOUNDER-VIEWING.md`
- Modify: `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md`
- Deploy: `supabase/migrations/20260904000000_clinician_rubric_import.sql` to isolated project only

**Interfaces:**
- Produces: deployed but unused service-only staging/activation RPCs.
- Produces: dated proof that active rubric count remains zero and the feature flag remains false.
- Establishes: explicit human checkpoint before Task 10.

- [ ] **Step 1: Run the complete local verification suite**

```bash
npm test
npm run typecheck
npm run test:coverage
npm run build
SUPABASE_LOCAL_MUTATION_TESTS=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA npm run test:integration:mutating
```

Expected: every suite passes, coverage remains above 80%, and the production web export succeeds.

- [ ] **Step 2: Run security and private-data checks**

Verify no source/reviewer/private artifact is tracked, no runtime role can access rubrics or import ledgers, no SQL function accepts arbitrary relation/SQL text, and no test/log output contains real prompt or criterion content.

- [ ] **Step 3: Capture isolated-preview preflight**

Using project ref `obfwfoykalvoxqdnosus`, verify migration history currently ends at `20260901001000`, feature flag is false, active/draft rubric counts are zero, candidate runtime tables are empty, and no conflicting migration version exists.

- [ ] **Step 4: Apply only the reviewed rubric-import migration**

Run a Supabase dry run against the exact isolated project. Require exactly `20260904000000_clinician_rubric_import.sql`, then apply it. Do not include seeds, roles, vault secrets, source data, rubric payloads, or functions unrelated to the migration.

- [ ] **Step 5: Run hosted catalog/ACL postflight**

Verify the ledger/RPC ownership, security-definer flags, search paths, grants, RLS, zero ledger rows, zero rubric rows, feature flag false, and zero candidate runtime rows. Do not call either import RPC before clinician approval.

- [ ] **Step 6: Update both release runbooks truthfully**

Record:

- exact deployment commit and migration SHA-256;
- isolated project ref;
- draft artifact aggregate hash/count evidence;
- review Sheet status `awaiting_clinician`;
- importer deployed but never called;
- active reviewed rubric count `0/775`; and
- feature flag false.

- [ ] **Step 7: Commit, verify exact SHA, push, and update the open PR**

```bash
git add docs/BEFORE-COFOUNDER-VIEWING.md docs/PRE-CLOSED-ROUND-DEPLOYMENT.md
git diff --cached --check
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "docs: record clinician rubric pre-sign readiness"
git push origin feat/cofounder-ui-reliability
```

Require remote SHA equality and green PR checks before handing the review Sheet to the cofounder.

---

## Mandatory Human Gate: Clinician Review and Attestation

Stop after Task 9. The clinician/cofounder must personally:

1. review all 26 domain mappings;
2. review all 775 prompt rubrics and safety proposals;
3. enter corrections where needed;
4. mark every mapping and rubric `Approved`;
5. enter their real name, qualification, account email, and attestation time; and
6. type the exact final canonical artifact SHA-256 after the corrected workbook has been regenerated and revalidated.

Do not execute Tasks 10–12 until the clinician explicitly reports completion and the connected Google account readback proves the approval state and hash.

---

### Task 10: Signed Artifact Verification and Reviewer Profile

**Files and external state:**
- Read: clinician-review Google Sheet
- Generate: private/ignored `clinician-rubrics-reviewed.json`
- Create or verify: one named cofounder Auth user/profile in isolated preview

**Interfaces:**
- Consumes: all approved domain/rubric decisions and clinician attestation.
- Produces: branded `VerifiedReviewedArtifact` and reviewer profile UUID.
- Passes to Task 11: exact artifact hash, source fingerprint, contract version, reviewer UUID, review timestamp, and 775-row payload.

- [ ] **Step 1: Read the final Sheet metadata and exact bounded ranges**

Re-read metadata before content. Use the exact tab names and bounded rectangles established in Task 8. Verify sharing is still restricted and capture revision-level last-modifying identity as supporting evidence.

- [ ] **Step 2: Export decisions into the private reviewed artifact**

Run:

```bash
npm run rubrics:verify -- --reviewed supabase/imports/20260825_med_interview_question_bank/clinician-rubrics-reviewed.json
```

Expected aggregate stdout: 26/26 mappings approved, 775/775 rubrics approved, zero change requests, zero unreviewed safety proposals, zero parser failures, zero trace failures, and attested hash equality.

- [ ] **Step 3: Verify clinician identity without committing personal data**

Confirm the attestation email matches the exact Google account granted review access. Record qualification evidence privately. Do not include email, registration number, or private evidence in Git or aggregate logs.

- [ ] **Step 4: Create or verify the named isolated-preview account**

Use Supabase Admin only for project `obfwfoykalvoxqdnosus`. Invite the exact reviewer email or verify the existing named account, require email confirmation, and resolve its `profiles.id`. Do not grant admin unless a separate role decision requires it; rubric review provenance only needs the profile identity.

- [ ] **Step 5: Run a read-only pre-import check**

Require feature flag false, 775 published candidate prompts, zero active rubrics, zero conflicting version-1 rows, empty candidate runtime tables, and migration `20260904000000` present.

---

### Task 11: Stage, Verify, and Atomically Activate the Signed Batch

**Files and external state:**
- Read: private verified artifact
- Mutate: isolated-preview `mmi_scoring_rubrics` and `mmi_rubric_import_batches`
- Never mutate: source Google Sheet or shared Supabase project

**Interfaces:**
- Consumes: verified artifact and reviewer profile from Task 10.
- Produces: exactly 775 active reviewed rubrics and one active aggregate ledger.

- [ ] **Step 1: Stage the exact signed artifact**

Call `stage_clinician_rubric_batch` once with the exact attested artifact hash, source fingerprint, contract `2026-09-04.1`, reviewer UUID, attested timestamp, and 775-row JSONB payload. Capture only aggregate result fields.

- [ ] **Step 2: Re-read staged rows with owner-only verification**

Recompute the payload hash from stored drafts and require 775 distinct targets, version `1`, status `draft`, exact reviewer UUID/timestamp, parser-compatible JSON shapes, zero extras, and ledger status `staged`.

- [ ] **Step 3: Activate atomically**

Call `activate_clinician_rubric_batch` with the attested artifact hash. Require the returned activation count to equal 775. Any other result is failure; keep the feature flag false and repair forward.

- [ ] **Step 4: Run independent aggregate postflight**

Require:

```text
activeRubrics=775
coveredPrompts=775
uncoveredPrompts=0
duplicateActiveTargets=0
reviewerMismatch=0
artifactLedgerStatus=active
featureFlag=false
candidateRuntimeRows=0
```

Also verify runtime roles cannot read rubric or ledger content and cannot execute staging/activation RPCs.

- [ ] **Step 5: Retry the identical activation call**

Require an idempotent result reporting the already-active 775-row batch. Then attempt a changed payload under the same artifact hash in a transaction expected to fail; verify stored hashes/counts remain unchanged.

---

### Task 12: Final Evidence, Tests, and Review Handoff

**Files:**
- Modify: `supabase/imports/20260825_med_interview_question_bank/clinician-rubric-manifest.json`
- Modify: `docs/BEFORE-COFOUNDER-VIEWING.md`
- Modify: `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md`

**Interfaces:**
- Produces: aggregate evidence that item 1 is complete without exposing private clinical content or personal data.
- Leaves: feature flag false and all unrelated cofounder gates truthful.

- [ ] **Step 1: Record aggregate signed-batch evidence**

Update the manifest and runbooks with exact artifact/source hashes, contract/mapping versions, 775/775 coverage, zero failures, reviewer profile reference, review/activation timestamps, migration SHA, and postflight counts. Record the reviewer by internal profile reference only; keep name, email, qualification evidence, and rubric content private.

- [ ] **Step 2: Run final verification on the exact tree**

```bash
npm test
npm run typecheck
npm run test:coverage
npm run build
SUPABASE_LOCAL_MUTATION_TESTS=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA npm run test:integration:mutating
git diff --check
```

Expected: all checks pass, coverage stays above 80%, and no private artifacts are tracked.

- [ ] **Step 3: Run staged graph and security review**

Run GitNexus staged change detection; inspect every d=1 dependent; scan the staged diff for Drive IDs, reviewer identity, prompts, marking criteria, API keys, service-role keys, database passwords, and private artifact paths containing content.

- [ ] **Step 4: Commit final evidence**

```bash
git add supabase/imports/20260825_med_interview_question_bank/clinician-rubric-manifest.json docs/BEFORE-COFOUNDER-VIEWING.md docs/PRE-CLOSED-ROUND-DEPLOYMENT.md
node /Users/sanje/.npm/_npx/5e786f48223a616c/node_modules/gitnexus/dist/cli/index.js detect-changes --scope staged --repo InterviewStation
git commit -m "docs: record clinician-reviewed rubric activation"
```

- [ ] **Step 5: Push and verify review head**

```bash
git push origin feat/cofounder-ui-reliability
git rev-parse HEAD
git ls-remote --heads origin feat/cofounder-ui-reliability
gh pr checks 10
```

Require local, remote, and PR head SHAs to match. Do not enable the feature; hand off the remaining privacy, scoring-function, Cron, manual-QA, named-smoke, and enablement gates separately.
