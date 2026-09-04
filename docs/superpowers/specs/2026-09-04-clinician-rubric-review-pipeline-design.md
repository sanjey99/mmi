# Clinician Rubric Review Pipeline Design

**Date:** 2026-09-04

**Status:** Proposed for implementation

**Release target:** Isolated Supabase project `obfwfoykalvoxqdnosus`

**Feature flag:** `normalized_mmi_station_enabled=false` until every release gate passes

## Context

The isolated cofounder preview contains 155 published MMI stations and 775
ordered prompts, but it contains no active clinician-reviewed scoring rubrics.
The clinician reviewer is also a cofounder. The cofounder needs a complete,
review-ready rubric package before they can review and sign it; the candidate
experience must remain disabled until that genuine clinical approval exists.

The authoritative source is the private native Google Sheet represented locally
by `med_interview_question_bank.gsheet`. Its Drive identifier remains outside
the repository. Read-only inspection matches the original import manifest:

- `stations`: 194 non-empty rows including the header;
- `sub_questions`: 833 non-empty rows including the header;
- `marking_criteria`: 3,333 non-empty rows including the header and 32 repeated
  headers, yielding 3,300 actual criteria rows;
- `panel_questions`: 11 non-empty rows including the header;
- 155 complete five-prompt candidate stations and 775 candidate prompts;
- 10 panel questions excluded; and
- five station relations quarantined by the existing normalized import.

The source workbook was previously exported as
`med_interview_question_bank.xlsx` with SHA-256
`903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`.
The live Google Sheet is now the review source. A new content fingerprint will
be computed from canonical cell values rather than assuming that a fresh XLSX
export has the same container hash.

## Goals

1. Produce exactly one version-1 draft rubric for each of the 775 candidate
   prompts from the source marking criteria.
2. Preserve every source criterion and its weight in traceable draft evidence.
3. Give the clinician/cofounder a separate, comprehensible Google Sheet for
   review, correction, per-prompt approval, and final attestation.
4. Validate the exact reviewed artifact with the application's runtime rubric
   parser before any hosted import.
5. Bind approval to one canonical artifact SHA-256 and one qualified reviewer.
6. Activate all 775 rubrics atomically only after genuine review, while the
   candidate feature remains disabled.
7. Produce aggregate, non-sensitive postflight evidence proving complete
   coverage and no candidate activity.

## Non-goals

- The generator does not perform or claim clinical review.
- AI output does not create reviewer identity, qualifications, approval status,
  or approval timestamps.
- The source question-bank Sheet is never edited.
- Panel questions and the five quarantined incomplete station relations remain
  outside this release.
- Rubric work does not approve the privacy notice, deploy provider credentials,
  complete physical-device QA, or enable the candidate feature.
- Hidden rubric text, marking criteria, model answers, or reviewer metadata are
  never exposed through candidate APIs or client bundles.

## Existing Contract

Each `mmi_scoring_rubrics` row targets exactly one standard prompt, has a
positive version, and moves through `draft`, `active`, or `retired`. An active
row requires both `clinician_reviewed_at` and `clinician_reviewed_by`. Once a
rubric is active or retired, its target, version, content, weights, safety
items, and reviewer provenance are immutable.

Runtime parsing is stricter than the database JSON checks. Every rubric must:

- contain 2–20 coded criteria;
- contain at least one strength and one improvement criterion;
- use only `structure`, `ethics`, `communication`, `reflection`, and
  `nhs_awareness`;
- use five numeric weights between zero and one that total exactly one;
- place criteria only in dimensions with non-zero weights;
- use canonical codes and approved student-feedback template identifiers;
- contain no duplicate criterion codes or duplicate kind/template pairs; and
- contain no more than 20 uniquely coded safety items using approved safety
  feedback templates.

The database currently proves only that `clinician_reviewed_by` references a
profile. It does not prove that the profile belongs to a qualified clinician.
The review artifact and attestation therefore provide the missing governance
evidence, while the preview profile UUID supplies the database reference.

## Chosen Architecture

The pipeline has four separated stages:

1. **Read and reconcile:** read the source Google Sheet without mutation and
   reconcile it to the exact deployed 155/775 normalized prompt set.
2. **Generate and validate drafts:** deterministically transform source
   criteria into traceable rubric proposals and reject incomplete or invalid
   output.
3. **Clinician review and attestation:** publish a separate restricted review
   Sheet, allow the cofounder to correct and approve each prompt, then bind the
   final approval to a canonical artifact hash.
4. **Import and activate:** re-read, canonicalize, validate, hash-check, import
   as drafts, and activate all 775 in one checked transaction after sign-off.

No stage can silently advance the next stage. Draft generation never sets
clinical approval fields, and hosted import never infers approval from a
non-empty reviewer UUID.

## Stage 1: Source Read and Reconciliation

The reader consumes bounded ranges from the exact visible tabs:

- `stations`;
- `sub_questions`;
- `marking_criteria`; and
- `panel_questions` only to prove exclusion.

It removes the same repeated-header rows recorded by the existing manifest,
normalizes display text without changing clinical meaning, and builds immutable
maps keyed by `station_id`, `sub_q_id`, and `criterion_id`.

The reader fails closed unless all of these are true:

- every deployed candidate prompt maps to exactly one source prompt;
- exactly 775 candidate prompts are present with no extras or duplicates;
- every candidate prompt has at least one source marking criterion;
- all criterion IDs are unique and reference a known candidate prompt;
- each criterion has non-empty text, a positive numeric source weight, and a
  non-empty source domain;
- the 10 panel questions are excluded; and
- the canonical source fingerprint matches the value recorded when the review
  package was generated.

The original cell value, row number, source criterion ID, source domain, and
source weight remain in the private trace record. No source criterion is
silently dropped or truncated.

## Stage 2: Deterministic Draft Generation

### Domain mapping

The source contains 26 domain labels while the application supports five
dimensions. The generator uses a versioned mapping table and exposes that table
in the review workbook. Direct mappings receive `high` confidence; semantic
collapses receive `review_required` confidence. No unknown domain receives a
default dimension.

Initial proposal:

| Source domain | Proposed application dimension | Review treatment |
| --- | --- | --- |
| `ethics`, `professionalism`, `patient_benefit` | `ethics` | clinician confirms |
| `communication` | `communication` | clinician confirms |
| `reflection`, `stress_management` | `reflection` | clinician confirms |
| `nhs_hot_topics`, `nhs_topics`, `healthcare_relevance`, `health_inequalities`, `public_health`, `governance`, `evidence_based_medicine` | `nhs_awareness` | clinician confirms |
| `judgement`, `prioritisation`, `information_gathering`, `critical_thinking`, `planning`, `clinical_reasoning`, `teamwork`, `delegation`, `content` | `structure` | always flagged `review_required` |
| `safety`, `patient_safety`, `safeguarding`, `escalation` | `ethics` plus proposed safety classification | always flagged `review_required` |

If the clinician changes this table, drafts are regenerated and assigned a new
artifact hash before per-prompt approval begins.

### Weight calculation

For each prompt, source weights are summed by proposed application dimension
and divided by the prompt's total source weight. Zero-weight dimensions remain
present with value zero. A deterministic fixed-precision largest-remainder
method ensures that serialized weights total exactly one without depending on
iteration order or floating-point drift.

The review row displays both the source-domain totals and proposed application
weights. A clinician edit invalidates the prior hash and triggers full
revalidation.

### Criteria generation

Source bullets are grouped by proposed application dimension in stable
criterion-ID order. For each applicable dimension, the generator creates:

- one source-backed strength criterion; and
- one source-backed improvement criterion.

The assessor text uses fixed wrappers around the complete, unchanged source
bullets. The generator does not add clinical facts or reinterpret the expected
action. It rejects any group that cannot fit the runtime text limit without
losing source material.

Each criterion records private trace metadata outside the runtime rubric JSON:

- source criterion IDs;
- source row numbers;
- source domains and weights;
- transformation version; and
- mapping confidence.

Student-visible feedback uses only the versioned approved catalog. The current
catalog lacks a semantically correct generic structure-improvement template.
Implementation must add an explicit structure-improvement template through a
new retained scoring-contract version rather than misusing an unrelated safety
template. The old scoring contract remains available for historical snapshots.

### Safety proposals

Criteria from `safety`, `patient_safety`, `safeguarding`, or `escalation` are
proposed—not declared—as safety-critical. The proposal is grouped into the
existing fixed safety feedback categories for immediate risk, confidentiality,
and senior support. The clinician must explicitly accept, edit, or reject every
proposed safety item. Unreviewed safety proposals block approval.

## Stage 3: Clinician Review Workbook

A new native Google Sheet is created in the user's `ChatGPT` Drive folder. It
is distinct from and does not modify the source question bank. Access is
restricted to the owner and the named clinician/cofounder.

The workbook contains:

### `Instructions & Attestation`

- review scope and exclusions;
- reviewer name, professional role/qualification, and account email;
- source and transformation versions;
- canonical source fingerprint and draft artifact SHA-256;
- counts for stations, prompts, source criteria, mapped domains, and safety
  proposals;
- a fixed attestation statement; and
- a final field in which the clinician types the exact approved artifact hash.

### `Domain Mapping`

- all 26 source domains;
- source-row and prompt counts;
- proposed application dimension;
- confidence classification;
- clinician decision (`Approved`, `Change requested`); and
- clinician comment.

No prompt may be approved while its domain mapping is unresolved.

### `Rubric Review`

Exactly one row per candidate prompt, containing:

- station and prompt identity;
- category, topic, scenario, and prompt text;
- source marking criteria, domains, and weights;
- proposed dimension weights;
- proposed strength and improvement criteria;
- proposed safety-critical items;
- parser-validation result;
- trace completeness result;
- clinician decision (`Approved`, `Change requested`, blank); and
- clinician comments.

Derived identity, source, and validation cells are protected. The clinician
edits only designated review/correction columns. Conditional formatting makes
unreviewed, invalid, changed, and approved rows visually distinct.

### `Validation Summary`

- exact coverage and duplicate counts;
- source-to-runtime trace counts;
- parser failures grouped by reason;
- unresolved domain and safety decisions;
- approved/change-requested/unreviewed totals; and
- the current canonical artifact SHA-256.

## Approval Semantics

Clinical approval requires all of the following:

1. Every domain-mapping row is approved.
2. Every one of the 775 rubric rows is approved.
3. No parser, trace, count, duplicate, overflow, or safety-review error remains.
4. The clinician enters their real identity and qualification.
5. The clinician types the exact canonical artifact SHA-256 in the attestation
   field using their own Google account.
6. A final read proves the typed hash equals a fresh canonical export.
7. The reviewer has a named preview account whose profile UUID can be stored as
   `clinician_reviewed_by`.

Google revision metadata is supporting evidence, not a substitute for the
explicit per-row decisions and hash-bound attestation. No service account,
administrator, developer, or AI may enter the clinician's approval for them.

## Stage 4: Import and Atomic Activation

After genuine approval, the importer:

1. reads the exact reviewed workbook;
2. canonicalizes it into the versioned private JSON artifact;
3. recomputes and verifies the signed SHA-256;
4. passes every rubric through `parseMmiRubric` using the pinned scoring
   contract;
5. proves exact coverage of the deployed 775 prompt IDs;
6. inserts all records as `draft` in the isolated preview;
7. re-reads and verifies every stored draft; and
8. activates all 775 in one transaction with the real reviewer profile UUID and
   one review timestamp.

The transaction aborts on any missing prompt, extra prompt, duplicate target,
invalid rubric, changed hash, absent reviewer profile, pre-existing conflicting
active rubric, or feature flag value other than `false`.

The import must not create candidate sessions, transcripts, scoring claims,
provider requests, or paid calls.

## Postflight Evidence

The hosted postflight must prove, using aggregate-only output:

- exactly 775 distinct active version-1 rubrics;
- exactly 775 covered candidate prompts and zero uncovered prompts;
- zero duplicate active targets;
- every active rubric has the expected reviewer UUID and review timestamp;
- every stored rubric re-parses under the pinned contract;
- artifact hash and source fingerprint match the attestation;
- `normalized_mmi_station_enabled=false`;
- zero candidate sessions, drafts, prompt attempts, and scoring claims; and
- candidate projections still expose no rubric or source-criteria fields.

The runbook records the source fingerprint, artifact hash, transformation
version, reviewer identity reference, timestamps, aggregate counts, exact
deployment commit, and verification commands. It does not publish hidden rubric
content or unnecessary personal data.

## Error Handling and Recovery

- Source drift, unknown domains, missing criteria, count mismatch, parser
  failure, or hash mismatch stops the pipeline before hosted mutation.
- Review corrections regenerate the canonical artifact and invalidate all
  earlier attestation hashes.
- Draft import is retriable only with the identical artifact hash.
- Activation is one transaction; partial activation is forbidden.
- Active rubric content is never edited in place. A required correction retires
  version 1 and creates a newly reviewed version 2.
- On any hosted failure, the feature remains disabled and repair is forward-only.

## Testing Strategy

### Unit tests

- repeated-header removal and exact source reconciliation;
- all 26 source-domain mappings and unknown-domain rejection;
- deterministic fixed-precision weight normalization;
- stable criterion ordering and complete source traceability;
- text overflow, duplicate, missing, and malformed-source rejection;
- safety proposal grouping and unresolved-review blocking;
- canonical serialization and artifact hashing; and
- approval-state and attestation-hash verification.

### Contract tests

- every generated rubric passes `parseMmiRubric`;
- the new structure-improvement template is available only in the new scoring
  contract version;
- historical scoring-contract snapshots remain unchanged; and
- candidate-safe public output remains fixed-template and rubric-free.

### Database integration tests

- exact 775-draft import and all-or-nothing activation;
- missing, duplicate, invalid, unsigned, or wrong-reviewer batches fail closed;
- active content immutability and forward-only version replacement;
- feature-disabled provider-egress proof; and
- no rubric leakage through runtime roles or student APIs.

### Review and hosted verification

- workbook sheet/range/count/validation readback;
- clinician-owned per-row decisions and hash attestation;
- isolated-preview dry-run and transactional import;
- aggregate postflight; and
- a separate clinician-reviewed evaluation set for unsafe advice, valid
  alternative answers, missing critical actions, and prompt injection before
  the candidate feature can be enabled.

## Delivery Sequence

1. Implement the scoring-contract addition and draft generator with tests.
2. Generate the canonical source fingerprint and 775 draft rubrics.
3. Create and verify the separate restricted clinician-review Google Sheet.
4. Complete other non-clinical technical gates while the feature remains off.
5. Cofounder reviews mappings, rubrics, and safety proposals and requests any
   corrections.
6. Regenerate until all 775 rows pass and the cofounder signs the exact hash.
7. Provision the cofounder's named preview profile.
8. Import drafts and atomically activate the signed batch.
9. Run hosted postflight, update runbooks, and only then proceed to the separate
   end-to-end smoke and feature-enable decision.

## Acceptance Criteria

- The source Google Sheet is unchanged.
- A separate review Sheet contains exactly 775 traceable rubric rows.
- Every source marking criterion for those prompts is represented with no
  silent truncation or omission.
- Every proposed rubric passes the exact application parser.
- The clinician can review mappings, criteria, weights, and safety proposals
  without using developer tooling.
- No rubric can be described as clinician reviewed before per-row approval and
  exact-hash attestation.
- Hosted activation cannot partially succeed and cannot occur while the feature
  flag is enabled.
- Final postflight proves 775 active reviewed rubrics, zero uncovered prompts,
  no candidate activity, and no rubric leakage.
