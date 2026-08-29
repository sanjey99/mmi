# Normalized MMI Station Experience — Session 1 Design

## Status and decision

Approved on 2026-08-26 for Session 1 of the cofounder-preview work. This
document defines only normalized station data, trusted timing, candidate UI
orchestration, and the compatibility boundaries required by Sessions 2 and 3.
It does not authorize microphone or webcam capture, upload/storage,
transcription, AI scoring, analytics, admin features, CI/CD, deployment, or a
hosted Supabase change.

## Goal

Provide an opt-in candidate MMI station experience that runs one 660-second
station: a 60-second scenario brief followed by five ordered 120-second
response windows. The existing 785-row flat-question practice flow remains the
default and continues to work unchanged while the new feature is disabled.

## Scope and non-goals

Session 1 creates a forward-only normalized representation of the verified
workbook import, a fail-closed local import/finalization path, a
server-authoritative station-session projection, and a gated no-text-input
candidate UI.

The following are explicitly out of scope:

- microphone, webcam, `MediaRecorder`, camera libraries, recording storage,
  upload, transcription, or media permissions;
- AI scoring, rubrics, feedback, administration, analytics, or retention;
- changing or deactivating any existing imported `questions` row;
- deployment, Vercel changes, Supabase project configuration, or hosted
  Supabase DDL/DML/RPC/storage/role/secret/Cron/migration-history operations.

## Existing constraints and evidence

The committed converter verifies workbook SHA-256
`903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71` and
uses workbook-owned `MMI_###` station IDs and `MMI_###_Q#` sub-question IDs.
It verifies 155 complete station graphs, 775 deduplicated candidate prompts,
10 panel prompts, five quarantined broken relations, and 25 exact duplicate
source rows. The grouping is therefore data provenance, never language or
question-wording inference.

The existing normalized tables, `mmi_stations` and `mmi_sub_questions`, were
introduced by `20260817000000_capture_mmi_content_schema.sql`. The existing
Phase 4 attempt code is deliberately not reused: it depends on rubrics,
privacy-notice acknowledgement, scoring claims, and media/transcript phases.
The legacy Practice route and its typed-answer session remain the feature-flag
fallback.

The initial content-schema migration granted broad normalized-table privileges
while defining its early RLS policies. The completed follow-up migration,
`20260817001000_mmi_student_content_api.sql`, already revokes direct
`anon`/`authenticated` access and exposes hardened fixed-shape student preview
RPCs instead. `tests/integration/mmiContentSecurity.integration.test.ts`
proves that both students and admins are denied direct base-table reads through
multiple PostgREST shapes. There are no production direct normalized-table
callers. Session 1 preserves and reasserts that established boundary, then adds
current-phase-only candidate RPCs; prompt secrecy remains server-enforced.

No private workbook question, scenario, criterion, cached model answer, or
panel note may appear in source, documentation, tests, snapshots, errors, or
logs. All committed tests use synthetic text and assertions over counts, stable
IDs, and hashes only.

## Architecture

### Normalized verified import

A new additive migration will introduce a private normalized-import ledger and
provenance columns for the existing station tables. The original workbook is
not retained locally. A separate private local converter,
`generate_normalized_station_import.py`, instead consumes the committed flat
manifest plus the two exact ignored flat CSV artifacts whose hashes it verifies
before reading. It groups only the source-owned
`MMI_###/MMI_###_Q#` identity; `PANEL_###` identifies the ten excluded panel
records. It reconstructs the scenario/prompt split only after provenance
grouping, using the previous converter's structural `"\n\n"` delimiter and
requiring one exact common scenario prefix across all five rows. Any absent or
inconsistent source identity, artifact hash, delimiter, prefix, order, or
metadata fails closed. The converter creates ignored payload artifacts plus a
committed metadata-only normalized manifest. The manifest contains no prompt
text; it records the workbook hash, source namespace, stable IDs or their
hashes, expected counts, timing contract, and artifact payload hashes.

The importer accepts only exact structured records with the verified namespace,
manifest hash, station ID, sub-question ID, order, and fixed timing values. It
must reject an absent manifest, changed source identity, duplicate or missing
IDs, order outside `1..5`, timing different from 60/120 seconds, a panel ID in
the candidate set, or a mismatch with the existing flat-row provenance. A
finalization operation validates the complete set atomically: 155 stations,
775 candidate sub-questions, five ordered prompts per station, and exactly 10
panel records excluded from normalized station content. Only a verified,
finalized batch is eligible for candidate sessions.

The current 785 imported `questions` rows remain active and untouched. Each
normalized candidate prompt records the matching existing flat provenance ID
`<station_id>/<sub_q_id>`; panel IDs do not enter the candidate station table.
This proves coexistence without reconstructing groups from flat question text.

### Candidate-session security and lifecycle

The migration will create a user-owned candidate session record with the
selected verified station ID, immutable `started_at`, and optional
`abandoned_at`. It will expose only fixed-shape, caller-bound security-definer
RPCs:

- `start_candidate_mmi_station_session()` selects one verified published
  candidate station and creates the immutable start timestamp;
- `get_candidate_mmi_station_session(p_session_id uuid)` returns server time,
  the current phase boundaries, session state, and either the scenario or the
  current sub-question;
- `abandon_candidate_mmi_station_session(p_session_id uuid)` is ownership
  checked and idempotent.

`get_candidate_mmi_station_session` projects phase using trusted database time
and immutable `started_at`; it does not trust browser time or a client phase
counter. The response contract never includes a prompt list, future prompt ID,
future prompt text, rubric, cached answer, model answer, criterion, or raw
normalized table row. Browser roles have no direct access to normalized station
or sub-question tables or to the import ledger; this preserves the existing
`20260817001000` direct-read revocation rather than introducing a new broad
browser-read policy.

| Elapsed interval | Phase | Candidate-visible content |
| --- | --- | --- |
| `[0, 60)` seconds | `scenario` | `scenario_text` only |
| `[60, 180)` seconds | `response` order `1` | first prompt only |
| `[180, 300)` seconds | `response` order `2` | second prompt only |
| `[300, 420)` seconds | `response` order `3` | third prompt only |
| `[420, 540)` seconds | `response` order `4` | fourth prompt only |
| `[540, 660)` seconds | `response` order `5` | fifth prompt only |
| `[660, ∞)` seconds | `completed` | completion state only |

The arithmetic boundary is inclusive at each new phase. The client refreshes
the trusted projection and derives its displayed countdown from returned
timestamps. It never resets `started_at`. If a response operation finishes
before the current window ends, recording may stop but the next prompt remains
unavailable until the next trusted boundary. On expiry the runner asks the
media port to finish the active response best-effort, then obtains the new
server projection. Leaving invokes the idempotent abort path and the server
abandon operation; a late or repeated completion cannot reveal a later prompt.

### Candidate client and media boundary

New modules under `src/features/candidateMmi/` are independent of
`src/features/mmi/`:

- `types.ts` defines fixed client-safe projection types, phase types, and an
  opaque branded `CompletedResponseArtifactRef`;
- `schedule.ts` is a pure 60/120 timing projection for rendering, local tick
  updates, and testable boundary behavior;
- `mediaPort.ts` defines `CandidateMmiMediaPort` with `prepare`,
  `beginResponse`, `finishResponse`, and `abort`; it knows no capture library,
  device, storage, or upload detail;
- `api.ts` validates opaque RPC responses and maps safe error codes;
- `runner.ts` coordinates projections and the media port without importing a
  recording implementation;
- `featureFlag.ts` reads exactly one non-secret app-config key,
  `normalized_mmi_station_enabled`, treating missing, unavailable, malformed,
  or non-`true` values as disabled.

Session 1 supplies a no-capture media-port implementation. Session 2 may
replace that implementation while retaining the interface. Session 3 may
consume the opaque artifact references while retaining the session and timing
contracts. Neither later session permits Session 1 code to inspect the opaque
reference.

### Gated UI and legacy fallback

`app/(tabs)/practice.tsx` retains its existing free and eight-minute legacy
modes. When the flag is true, it additionally offers the separate 11-minute
MMI station mode and routes to `app/practice/mmi-station.tsx`; when false, the
new entry and direct route are unavailable. The new screen displays the
scenario/current prompt, phase timer, status, and leave/abort confirmation.
It deliberately contains no `TextInput` or typed-answer field. The old
`app/practice/session.tsx` is not changed as part of the candidate UI and
continues to implement the flat fallback.

The flag is checked in the client for navigation and in every candidate-session
RPC for the security boundary. It defaults to disabled through an additive
`app_config` row and fails closed if it is missing or not exactly the enabled
value. The feature flag is the only switch for this new station flow.

## Error handling

Safe API outcomes are a fixed allowlist: unauthenticated, feature disabled,
session unavailable, station unavailable, invalid request, completed, and
abandoned. The client uses user-safe messages and never logs RPC payloads or
prompt content. Network failure preserves the last trusted projection only for
display; a retry must re-read the server projection before beginning another
response.

Database functions use explicit `SECURITY DEFINER`, fixed search paths, minimum
EXECUTE grants, caller ownership checks, RLS on new tables, direct-table grant
revocation for browser roles, and migration postcondition assertions. The
normalized import ledger remains inaccessible to runtime browser roles.

## Testing and acceptance criteria

Unit tests in `tests/mmiCandidateSchedule.test.ts` cover exact phase boundaries, total scheduled duration, prompt
ordering, early media completion, abort idempotency, opaque artifacts, feature
flag parsing, and safe API validation. Policy tests inspect the migration and
converter/manifest contract without private text. Disposable local Supabase
integration tests run the fresh migration/import sequence and prove the
155/775/10 invariants, five prompts per candidate station, panel exclusion,
flat-row preservation, RLS/direct-read denial, current-prompt-only RPC output,
refresh/re-entry, expiry, and leave/abort ownership behavior. E2E tests use
synthetic prompts and synthetic RPC responses to prove gated navigation,
no text input, ordering, no future-prompt exposure, refresh/re-entry, timer
expiry, abort, and disabled legacy fallback.

Before the single final commit, run Node/Vitest, coverage, local mutating
integration, typecheck, production web build, relevant Playwright E2E,
`git diff --check`, secret/security scans, and GitNexus change detection. The
required independent final security audit is read-only; all Critical and High
findings must be resolved before committing or pushing.

## Roles and review gates

One persistent `quality_engineer` owns every code, test, migration, fixture,
and documentation edit. The primary agent inspects the design, reviews each
RED-before-GREEN gate, runs independent verification, integrates the work, and
reviews the final diff. One final `quality_auditor` performs an independent
read-only security review. No additional editing agent is permitted.

Before every edit to an indexed symbol, the engineer runs GitNexus context and
upstream impact analysis and reports any HIGH or CRITICAL result before editing.
Before committing, the primary runs GitNexus `detect-changes` and confirms only
the planned symbols and flows changed.

## Hosted boundary and next exact operation

Hosted Supabase is read-only for this session. The migration and private
payload import are local/disposable verification only. No `supabase db push`,
DDL, DML, RPC invocation, role/storage/secret/Cron change, migration-history
change, or deployment may target hosted infrastructure.

After implementation is verified, the report must present—but not execute—the
exact next hosted operation: apply
`supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql`
as an additive forward-only migration, then invoke the new normalized import
RPC using the verified namespace, workbook/manifest hashes, private payload
artifact hashes, and the exact 155/775/10 expected counts. It will create the
private ledger/session/RPC boundary and normalize candidate station data while
leaving all 785 flat rows active. This needs a new exact approval after the SQL
and private artifact hashes are reviewed.
