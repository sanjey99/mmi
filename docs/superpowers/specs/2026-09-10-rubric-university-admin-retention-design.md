# Rubric Scoring, University Practice, Admin, and Retention Design

**Date:** 10 September 2026

**Status:** Approved in chat; awaiting written-spec review

**Builds on:** The single 11-minute MMI station experience

## Decision

The product will grade every answer against the marking criteria attached to
that exact sub-question in the source question bank. The AI decides only which
rubric points the answer demonstrably achieved; application code calculates
the percentage from those decisions.

Practice remains a complete 11-minute station: a 60-second scenario brief
followed by five two-minute answers. The Practice screen will distinguish a
user's university-focused pool from the full repository, with both
availability numbers expressed as complete stations.

Administrators will manage the shared station repository and AI configuration
and may inspect structured results and costs across users. Candidate answer
audio and transcript text will not be retained after successful assessment.

## Source workbook contract

The source workbook is a content source, not merely a list of prompt strings.
The import must preserve the fields needed to operate and audit the question
bank:

- station ID, category, topic, difficulty, university tags, preparation time,
  scenario, publication state, and usable image metadata;
- sub-question ID, order, question text, response time, and any non-empty
  cached model answer;
- criterion ID, sub-question ID, source order, bullet text, original weight,
  and domain; and
- panel-question content, tags, publication state, model answer, and notes.

Panel notes are administrative content and must never be sent to candidates or
to the scoring model. Cached model answers are also hidden from candidates and
are not part of the rubric assessment unless a later, separately approved
design gives them a defined purpose.

The current workbook contains 155 complete stations, 775 candidate
sub-questions, and 3,100 criteria attached to those sub-questions. Every
current candidate sub-question has four criteria. The import must reject or
report orphaned criteria rather than attaching them heuristically.

The workbook's original criterion weights are retained as source metadata for
traceability, but do not affect the live score. The live scoring rule is equal
weight per criterion. Source values that are visibly displaced into the wrong
column, such as `draft` appearing as an image URL, must be normalized into
explicit publication metadata and reported in the import manifest.

Imports are deterministic and idempotent. Their manifest records the workbook
hash, imported and rejected counts, normalization decisions, and source IDs so
that an administrator can trace every live station back to its source row.

## Rubric-based AI assessment

### One assessment instance per answer

After the timed station is complete, the server creates one independent model
request for each of the five answers. Each request receives only:

1. the scenario brief snapshotted for that station attempt;
2. the current sub-question text;
3. the marking criteria snapshotted for that sub-question; and
4. the candidate's current answer transcript.

The request does not receive future or previous answers, generic scoring
dimensions, panel notes, hidden model answers, or criteria belonging to a
different sub-question. Starting a separate assessment instance for every
answer prevents context from one answer influencing another.

### Model responsibility

For every supplied criterion, the model must return exactly one decision:

- `achieved: true` when the answer contains sufficient evidence for the
  criterion; or
- `achieved: false` when the criterion is absent, merely implied, contradicted,
  or too vague to satisfy the rubric.

The response schema identifies criteria by the server-supplied criterion ID.
It rejects missing, duplicate, invented, or reordered decisions. A positive
decision must include a transcript character range supporting it; a negative
decision must not. Evidence ranges are used only to validate the model's
decision during processing and are never retained or returned to clients.

The scoring prompt instructs the model to use the marking criteria as the
exclusive standard and to avoid awarding credit for general fluency,
confidence, length, or clinically plausible material that does not meet a
listed point.

### Server-owned score

The model does not choose percentages. For a question with `N` criteria, each
criterion is worth `100 / N` percent. The server calculates:

`question score = achieved criterion count / total criterion count * 100`

The current workbook therefore awards 25% for each of four criteria. If a
future question has five criteria, each will be worth 20%. The displayed
checklist shows every criterion, its equal percentage, and whether it was
achieved.

The overall station score is the arithmetic mean of the five question scores,
so every two-minute question contributes equally. Domain summaries may group
criterion outcomes for coaching, but cannot alter the score.

### Validation and failure behavior

Provider output is accepted only after strict schema, criterion-ID, evidence,
and range validation. Invalid output is a technical failure and never becomes
a score. A retry reuses the immutable scenario, question, rubric, and answer
snapshots and scores only unfinished questions; it does not rerun the timed
station or duplicate a completed assessment.

If any question remains unscored, the station result clearly shows assessment
as pending or failed and does not present a fabricated overall percentage.

## Versioned assessment snapshots

Each station attempt snapshots the scenario, five question texts, ordered
criterion IDs and bullets, and the scoring-contract version. The assessment
also records the selected practice scope and target-university value.

Editing shared content creates a new version for future attempts. It cannot
change the rubric, score, or wording associated with a completed or in-flight
attempt. Historical results remain explainable even after a station is edited,
unpublished, or archived.

## University practice pools

The Practice screen contains two 11-minute practice choices:

1. **[University] practice** uses stations tagged for the user's target
   university plus stations tagged `ALL`. Its card states the target
   university and the number of complete stations available.
2. **All-university practice** uses every published, complete station in the
   repository and states that complete-station count.

For example, an Oxford-targeted user currently sees 115 Oxford-practice
stations because the workbook has 115 universal `ALL` stations and no
Oxford-only rows. The full repository currently contains 155 complete
stations. Counts are calculated from live published content rather than
hard-coded.

University matching uses a canonical alias map shared by profile storage,
imports, counts, and selection. For example, `King's College London` maps to
the workbook tag `KCL`. Tags are compared as normalized exact values, not
free-text substrings.

The server selects only from the requested pool and prefers stations the user
has seen least recently. The attempt permanently records whether it came from
the targeted or full-repository pool. A candidate cannot change request
parameters to select draft, archived, incomplete, or out-of-pool content.

## Candidate result experience

After successful scoring, the candidate sees:

- the overall station percentage and five question percentages;
- one checklist per question containing each criterion, its equal percentage,
  and achieved/not-achieved state;
- concise structured strengths based on achieved criteria; and
- concise next steps based on missed criteria.

The candidate can view their own retained historical results. They cannot view
another user's identity, results, cost records, or administrative content.
Legacy assessments that cannot be truthfully reconstructed into rubric
checkboxes remain labelled as legacy results; the system must not invent
criterion outcomes for them.

## Data minimization and retention

The product does not create or store raw audio. Speech recognition may produce
temporary transcript text for recovery and scoring.

For a completed answer:

- transcript text is retained only while assessment is pending;
- it is deleted immediately after the corresponding rubric decisions and
  usage record are saved successfully;
- if assessment cannot complete, it expires no later than 24 hours after the
  answer is finalized; and
- after expiry, the UI explains that the answer content expired and the
  candidate must retake the station rather than offering an impossible retry.

The application must not retain transcript excerpts, evidence text, raw model
responses, prompts containing candidate answers, or provider request bodies.
Operational logs contain identifiers and safe error stages, never scenario,
question, rubric, answer, credentials, or response content.

The following structured records are retained until the account is deleted or
a later explicit retention policy applies:

- user, station, question, criterion, and content-version identifiers;
- achieved/not-achieved criterion decisions;
- question and overall percentages;
- structured strengths and next-step references derived from rubric points;
- scoring-contract version, provider, and model;
- input, cached-input, output, and total token counts when supplied;
- the configured input/output rate snapshot, estimated cost, latency, outcome,
  and timestamps; and
- the practice scope and target-university snapshot.

Deleting an account cascades its sessions, structured assessments, usage
records, and access-audit links. A forward migration applies the same policy to
existing data by removing stored transcript evidence and legacy answer text
while preserving non-content scores where they remain meaningful.

## AI configuration and cost accounting

The admin AI settings screen exposes the active provider, model, compatible
base URL where applicable, and per-million-token input, cached-input, and
output rates. API keys remain write-only: administrators may replace or clear
them but can never retrieve their existing value through the browser.

Every assessment call snapshots the active provider, model, and configured
rates. Cost is calculated from provider-reported token usage and those rate
snapshots, so historical cost does not change when an administrator edits the
current model or rates. Missing provider usage is visibly marked unknown; it
must not be silently treated as zero.

Configuration changes are validated, attributed to the acting administrator,
timestamped, and audited without recording secret values.

## Administrative capabilities

### Repository management

Administrators can search and filter complete stations by publication state,
university, category, topic, and difficulty. A station editor manages the
scenario and all five ordered sub-questions and their ordered rubric points as
one unit.

Draft stations may be incomplete. Publishing requires a valid scenario,
exactly five questions, a positive time limit for every phase, and at least one
criterion for every question. The editor previews each criterion's computed
equal percentage before publication.

Administrators can create drafts, edit through new versions, publish,
unpublish, archive, and restore content. Destructive hard deletion is not a
normal UI action because old attempts depend on immutable content snapshots.

### Structured assessment explorer

An administrator can inspect any user's retained structured result, including
station and question identifiers, rubric checkboxes, percentages, model,
token usage, cost, outcome, and timestamps. The explorer never exposes answer
audio, transcript text, transcript excerpts, or raw provider content.

Every cross-user detail view writes an audit event containing the acting admin,
subject user, assessment, purpose category, and timestamp. Access is enforced
by server-side role checks rather than hidden UI controls.

### Usage dashboard

Administrators can filter usage by date, user, provider, model, station,
university practice scope, and success state. The dashboard shows call count,
token totals, known cost, unknown-cost count, average latency, failure rate,
and per-question drill-down without answer content.

### Dashboard overview

The admin home page summarizes published, draft, and archived stations;
station counts by university; criteria/import health; active AI provider and
model; recent usage and cost; scoring failures; and links to repository,
configuration, assessment, and usage tools.

## Authorization and data access

Browser code does not query sensitive base tables directly. Candidate and
admin screens use narrow server functions that return only the fields required
for that screen.

- candidates can create, resume, and view only their own attempts and results;
- administrators can manage shared content and AI settings;
- administrators can view structured assessments and costs across users;
- neither role can retrieve a successfully assessed or expired transcript;
  and
- API keys and other secrets are never returned to either role.

Database row-level security, explicit function grants, fixed search paths,
input validation, rate limiting, and server-owned content lookup enforce these
rules independently of the browser interface.

## Compatibility and rollout

Historical migration files remain unchanged. A forward-only migration creates
the criterion, version, usage, and access-audit structures; imports the complete
workbook contract; changes assessment RPCs; and scrubs content that violates
the new retention policy.

Old generic-dimension assessments remain readable only as labelled legacy
scores after content scrubbing. New assessments use a distinct schema version
and rubric checklist contract. The rollout must not reinterpret old scores as
new rubric percentages.

Local implementation and verification do not authorize changing shared
Supabase, Vercel, provider credentials, or other remote environments. Preview
or production deployment is a separate, explicit action.

## Verification

Automated tests must prove:

- workbook import preserves all supported sheets and criterion provenance,
  reports orphaned or malformed rows, and is deterministic;
- every published candidate station has exactly five ordered questions and
  every question has criteria;
- the scoring request contains only the scenario, current question, current
  rubric, and current answer;
- different sub-questions create different model instances and rubric inputs;
- provider output cannot omit, duplicate, reorder, or invent criteria;
- each achieved checkbox contributes exactly `100 / N`, the server calculates
  the question score, and the five question scores are averaged equally;
- vague or unrelated answers do not gain credit outside the rubric in scorer
  contract tests;
- invalid provider output and missing token usage are represented honestly;
- university counts and selection use target-tag-plus-`ALL` for targeted
  practice and all published stations for repository practice;
- candidate ownership and admin cross-user authorization are enforced in the
  database and API layers;
- successful assessment deletes transcript text atomically with result
  persistence, and failed/pending content expires within 24 hours;
- no candidate transcript, excerpt, raw provider response, or API key is
  returned by candidate or admin endpoints;
- account deletion cascades retained candidate data;
- admin station editing validates publishability and preserves old snapshots;
- cost uses snapshotted rates and provider usage; and
- every cross-user admin detail view creates an access-audit event.

Unit, integration, and end-to-end coverage for the changed surfaces must meet
the repository's 80% minimum. End-to-end tests cover both practice choices, a
complete five-question scoring run, the candidate checklist, admin content
editing, model changes, usage inspection, cross-user structured inspection,
and the absence of transcripts from those views.

## Acceptance criteria

This design is complete when a user can choose a clearly labelled university
or all-repository 11-minute station, answer five questions, and receive five
strict rubric checklists whose percentages are calculated from equal-weight
criteria by the server.

An administrator can manage full station content, publication versions, AI
provider/model/rates, cross-user structured results, and usage costs without
being able to retrieve candidate answer content. Successfully scored answers
leave no retained audio, transcript, evidence excerpt, or raw model response.
