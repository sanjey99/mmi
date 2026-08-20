# Phase 4 MMI Station Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Run the required GitNexus impact analysis before editing every existing symbol. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a student MMI station library that starts a voice-led, one-station-at-a-time practice attempt, transcribes a reviewed answer, produces rubric-driven AI feedback immediately after each prompt, advances only when the student chooses **Continue to next prompt**, and saves a deterministic station summary.

**Architecture:** Treat standard MMI stations and role-play stations as a dedicated domain beside legacy free practice. Supabase exposes only student-safe station metadata and the current prompt. Authenticated Edge Functions own attempt creation, transcription, scoring, idempotency, and forward progression. Versioned clinician-reviewed rubrics and hidden assessor context remain server-side. Raw audio is transient; the reviewed transcript and validated assessment are persisted.

**Tech Stack:** Expo SDK 55, Expo Router, React Native, `expo-audio@~55.0.16`, Zustand, Supabase Auth/Postgres/Edge Functions, OpenAI `whisper-1` verbose transcription for speech-to-text, the existing configurable scoring provider, TypeScript, Vitest, and Playwright.

**Approved design:** [`docs/superpowers/specs/2026-08-17-phase-4-mmi-station-practice-design.md`](../specs/2026-08-17-phase-4-mmi-station-practice-design.md)

## Global constraints

- Preserve the existing dirty working tree. Do not reset or discard unrelated work.
- Do not commit, push, deploy functions, apply migrations, or change remote secrets without explicit user permission. Any commit/deploy command below is a checkpoint to run only after that permission.
- Preserve the AI-key boundary: `ai_api_key` is write-only to every client, including admins. Only `manage-ai-key` replaces it; scoring reads it server-side.
- Keep legacy free practice independent. Do not reuse `answers.question_id` for MMI attempts and do not regress `app/practice/session.tsx` or `app/practice/feedback.tsx`.
- Keep Phase 5 MMI Circuit deferred. One Phase 4 attempt contains exactly one station.
- Keep Phase 6 Tutor deferred and visibly marked **Coming soon**.
- Standard stations use `mmi_stations` plus ordered `mmi_sub_questions`; role-play uses `roleplay_stations` and is a single recorded response, not a live AI actor.
- Give feedback immediately after each successful submission. A successful score cannot be retried or resubmitted. The sole pedagogical action is **Continue to next prompt** when another prompt remains and **View station summary** after the final prompt. Technical failures may be retried with the same idempotency key.
- Do not claim to assess pace, tone, confidence, emotion, pronunciation, or other vocal delivery. The assessment input is the student-reviewed transcript.
- Never expose `model_answer_cached`, rubric instructions, safety criteria, `actor_persona`, `background_info`, AI prompts, provider error bodies, or provider credentials to student/admin clients.
- Use TDD: demonstrate RED, implement the smallest GREEN change, then refactor. Maintain the repository's 80% coverage requirement.
- Before editing an existing function, class, or method, run GitNexus upstream impact analysis and report direct callers, affected processes, and risk. Warn before any HIGH/CRITICAL edit. Before any permitted commit, run `gitnexus_detect_changes()`.
- Use the required `★ Insight` block before and after code changes during execution.

## Fixed launch decisions

These values make the plan executable rather than leaving provider placeholders:

| Decision | Phase 4 value |
|---|---|
| Recording SDK | `expo-audio@~55.0.16` |
| Transcription boundary | Authenticated Supabase Edge Function `transcribe-mmi-audio` |
| Transcription model | OpenAI `whisper-1` with `response_format = verbose_json`, chosen because the response includes decoded input duration |
| Transcription secret | Dedicated Edge secret `TRANSCRIPTION_API_KEY`; never `app_config.ai_api_key` |
| Model override policy | No arbitrary launch override; another model is allowed only after its per-request response provides an authoritative decoded duration or a separate approved media-decode boundary exists |
| Accepted upload formats | `audio/m4a`, `audio/mp4`, `audio/webm`, `audio/wav`, `audio/mpeg`, `audio/ogg` |
| Maximum recording | Client recorder stops at the station limit or 10 minutes, whichever is smaller; server compares a full local parse with provider-decoded duration and hard-limits uploads to 12 MiB |
| Stored student artifact | Reviewed transcript only; no raw audio object or path is persisted |
| Role-play timing | Add `prep_time_sec DEFAULT 120` and `time_limit_sec DEFAULT 300` to `roleplay_stations` during schema reconciliation |
| Role-play category | Add the same category type used by standard stations; backfill existing role-play rows to the audited scenario category, then allow curator corrections before release |
| Scoring dimensions | Existing product axes: structure, ethics, communication, reflection, NHS awareness; zero-weight dimensions are `null`/N/A |
| Summary generation | Deterministic aggregation of persisted prompt results; no extra LLM call |

## Initial CodeGraph blast radius

This planning pass made no symbol edits. CodeGraph's current index reports:

| Existing symbol | Known dependents | Planning risk |
|---|---|---|
| `QuestionsScreen` | Questions tab plus shared `ScreenWrapper`, `Card`, and `Button` rendering | Low: replace a placeholder while preserving the tab route |
| `RootLayout` | Root Expo stack and auth/bootstrap wrappers | High: a routing mistake can affect every auth/onboarding/app route; add only the `mmi` stack entry and run all guard E2E |
| `TimerRing` | Two render/callback references from `SessionScreen`; no direct covering tests found | Medium: accessibility/reset changes can regress legacy timed practice, so add tests before reuse |
| `ProgressScreen` | Progress tab plus legacy practice-store selectors and shared charts/cards | Medium: append a separate MMI section without changing legacy aggregates |
| `scoreAnswer` | Two call references in `src/stores/practiceStore.ts`; no direct covering tests found | High: provider extraction must preserve the legacy response and AI-key boundary |

Run fresh symbol-level `gitnexus_impact` immediately before each eventual edit because the dirty working tree or index may change after this plan.

## Inputs required before production release

Development may proceed with explicitly labelled fixtures, but production connection is blocked until all of these exist:

1. A fresh read-only Supabase schema and RLS audit of the three MMI content tables.
2. At least one clinician-reviewed, versioned rubric for every launch prompt and role-play station.
3. A small clinician-reviewed evaluation set covering unsafe advice, reasonable alternative answers, omission of safety-critical actions, and prompt-injection text.
4. An approved transcript-retention period and user-facing privacy wording. Until then, do not claim a retention duration in the UI.
5. The current scoring provider hostname confirmed and placed on the server-owned allowlist before provider-boundary hardening is deployed.
6. The production web origins confirmed for `APP_ALLOWED_ORIGINS`.
7. Explicit permission to apply migrations, configure `TRANSCRIPTION_API_KEY`, or deploy the new functions.

## Shared contracts

Use these contracts consistently in mobile/web code, Edge Functions, tests, and SQL JSON validation.

```ts
export const MMI_DIMENSIONS = [
  'structure',
  'ethics',
  'communication',
  'reflection',
  'nhs_awareness',
] as const;

export type MmiDimension = (typeof MMI_DIMENSIONS)[number];
export type MmiScore = 1 | 2 | 3 | 4 | 5;

export type MmiPromptIdentity =
  | { promptKind: 'standard'; stationId: string; subQuestionId: string }
  | { promptKind: 'roleplay'; stationId: string };

export interface MmiDimensionResult {
  score: MmiScore | null;
  applicable: boolean;
  evidence: string | null;
  improvement: string | null;
}

export interface MmiAssessment {
  dimensions: Record<MmiDimension, MmiDimensionResult>;
  overallPct: number;
  strengths: string[];
  improvements: string[];
  improvementTip: string;
  rubricVersion: number;
}

export type SubmitMmiPromptRequest = MmiPromptIdentity & {
  attemptId: string;
  transcript: string;
  idempotencyKey: string;
};
```

The client supplies identity and transcript only. The scoring function obtains the attempt's pinned station context, current-prompt text, hidden model answer, hidden role-play context, and rubric snapshot from the database. The public result exposes `applicable`, not exact rubric weights or criteria.

---

### Task 1: Audit and capture the canonical remote MMI content schema

**Files:**

- Create: `supabase/migrations/20260817000000_capture_mmi_content_schema.sql`
- Create: `tests/integration/mmiContentSchema.integration.test.ts`

**Purpose:** The remote content tables exist but are absent from local migrations. Capture their exact types and constraints before building on them, without querying question rows or altering the remote project.

- [x] Run a read-only schema query through the configured Supabase MCP for columns, types, defaults, enum/check constraints, FKs, indexes, grants, and policies:

```sql
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('mmi_stations', 'mmi_sub_questions', 'roleplay_stations')
order by table_name, ordinal_position;

select conrelid::regclass::text as table_name,
       conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.mmi_stations'::regclass,
  'public.mmi_sub_questions'::regclass,
  'public.roleplay_stations'::regclass
)
order by table_name, conname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('mmi_stations', 'mmi_sub_questions', 'roleplay_stations');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('mmi_stations', 'mmi_sub_questions', 'roleplay_stations');
```

- [x] Through the same read-only scoped MCP, inspect content counts and a small deterministic sample from each MMI content type. This is specifically to classify student-facing versus assessor-only fields and understand the collected MMI prompt style; do not query `profiles`, `answers`, attempts, secrets, or any student data, and do not copy assessor content into client fixtures or documentation:

```sql
select category::text, difficulty::text, status::text, count(*)
from public.mmi_stations
group by category::text, difficulty::text, status::text
order by category::text, difficulty::text, status::text;

select s.station_id, s.category::text, s.topic, s.difficulty::text,
       s.uni_tags, s.prep_time_sec, s.scenario_text,
       q.sub_q_id, q.order_num, q.question_text, q.time_limit_sec,
       q.model_answer_cached
from public.mmi_stations s
join public.mmi_sub_questions q on q.station_id = s.station_id
where s.status::text = 'published'
order by s.category::text, s.station_id, q.order_num
limit 15;

select station_id, title, topic, difficulty::text, uni_tags,
       opening_line, actor_persona, background_info, status::text
from public.roleplay_stations
order by status::text, station_id
limit 10;
```

- [x] Record only structural conclusions: prompt counts/order, typical time limits, content-field classification, whether cached model answers contain usable reference points, and rubric gaps. Do not reproduce full question/model-answer/actor text in the plan or test logs.

- [x] Write `mmiContentSchema.integration.test.ts` first. Gate it behind the existing integration-test environment convention and assert:

```ts
it('enforces station/sub-question integrity', async () => {
  await expectInsertSubQuestion({ station_id: 'missing' }).rejects.toMatchObject({
    code: '23503',
  });
  await expectDuplicatePromptOrder().rejects.toMatchObject({ code: '23505' });
  await expectInvalidTiming().rejects.toMatchObject({ code: '23514' });
});
```

- [x] Run the isolated integration test and record RED because a blank test project has no local MMI tables:

```bash
npm test -- --run tests/integration/mmiContentSchema.integration.test.ts
```

- [x] Create an idempotent reconciliation migration from the audited catalog. It must:

  - create all three tables on a blank project;
  - preserve existing remote rows;
  - retain `mmi_sub_questions.station_id -> mmi_stations.station_id ON DELETE CASCADE`;
  - add `UNIQUE (station_id, order_num)`;
  - require positive prep/response limits;
  - preserve the exact audited draft/published status semantics and make student APIs select only the audited published value;
  - add role-play `prep_time_sec` and `time_limit_sec` with the fixed defaults above;
  - add `roleplay_stations.category` using the audited standard-station category type, backfill to the valid scenario-category value, and require curator review before launch;
  - add indexes for published/category/university/difficulty and ordered prompt lookup.

- [x] Apply the migration only to a local/isolated Supabase instance and rerun the test for GREEN. Do not apply it to `tliwifhnsytxpcynuwsy`.

- [x] Review the SQL manually for destructive statements. There must be no `DROP TABLE`, no content-row rewrite except the explicitly audited role-play category backfill, and no column containing a secret.

#### Task 1 audit record — 2026-08-17

- The scoped hosted project contained `0` standard stations, `0` sub-questions, `0` role-play stations, and `0` cached model answers at audit time. The deterministic sample queries therefore returned no content. Prompt-count patterns, real response-time distributions, prompt style, cached-answer usefulness, and rubric quality remain release inputs and were not inferred.
- `mmi_stations.category` and both status columns are audited as `text`; difficulty uses the existing `question_difficulty` enum (`foundation`, `intermediate`, `advanced`). Hosted RLS treats `published` as the sole student-visible status and the column default is `draft`, so the reconciliation constraint fixes the launch set to those two values.
- The hosted sub-question relationship already cascades deletes and `sub_q_id` is unique, but `(station_id, order_num)` uniqueness and positive preparation/response-time checks were absent. Task 1 adds those invariants.
- Hosted role-play content lacked `category`, `prep_time_sec`, and `time_limit_sec`. Task 1 adds them using the audited standard-category type (`text`), the fixed `scenarios` backfill, and the approved `120`/`300` second defaults.
- All three hosted tables had RLS enabled. The existing broad table grants remain constrained by hosted policies, but direct authenticated reads can still reach assessor-bearing base-table columns. Task 2 must revoke those base-table client grants and expose only fixed student-safe RPC projections before any remote migration is authorized.
- TDD evidence: the isolated pre-migration database produced `5/5` expected RED failures with `PGRST205` because the tables were absent; after a clean local reset with the migration, `5/5` tests passed. Reapplying the migration to the migrated local database also completed successfully.

---

### Task 2: Create student-safe station discovery and current-prompt APIs

**Files:**

- Create: `supabase/migrations/20260817001000_mmi_student_content_api.sql`
- Create: `tests/mmiStudentContentPolicy.test.ts`
- Create: `tests/integration/mmiContentSecurity.integration.test.ts`

**Purpose:** PostgreSQL RLS filters rows, not columns. A student-safe API must explicitly project allowed fields and prevent relationship expansion or `select('*')` from revealing assessor-only content.

- [x] Write the text-contract test first and require the migration to revoke direct client access to all assessor-bearing base tables:

```ts
expect(sql).toMatch(/revoke\s+all\s+on\s+public\.mmi_stations/i);
expect(sql).toMatch(/revoke\s+all\s+on\s+public\.mmi_sub_questions/i);
expect(sql).toMatch(/model_answer_cached/);
expect(studentProjection).not.toMatch(/model_answer_cached|actor_persona|background_info/i);
```

- [x] Write integration tests first for authenticated student and authenticated admin JWTs. Both roles must fail to read hidden fields through base-table reads, `select('*')`, guessed IDs, filters, and relationship expansion.

- [x] In the migration, revoke direct `anon`/`authenticated` reads of the base tables and add three `SECURITY DEFINER` RPCs with `SET search_path = public, pg_temp`, explicit authorization, fixed return types, and `REVOKE ALL ... FROM PUBLIC` before granting only `authenticated`:

```sql
create function public.list_mmi_station_cards(
  p_category text default null,
  p_university text default null,
  p_difficulty text default null,
  p_search text default null,
  p_kind text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  station_kind text,
  station_id text,
  title text,
  category text,
  topic text,
  difficulty text,
  university_tags text[],
  prep_time_sec integer,
  prompt_count integer
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with cards as (
    select
      'standard'::text as station_kind,
      s.station_id,
      s.topic::text as title,
      s.category::text,
      s.topic::text,
      s.difficulty::text,
      s.uni_tags::text[] as university_tags,
      s.prep_time_sec,
      count(q.id)::integer as prompt_count
    from public.mmi_stations s
    join public.mmi_sub_questions q on q.station_id = s.station_id
    where s.status::text = 'published'
      and (p_category is null or s.category::text = p_category)
      and (p_university is null or p_university = any(s.uni_tags::text[]))
      and (p_difficulty is null or s.difficulty::text = p_difficulty)
      and (p_kind is null or p_kind = 'standard')
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', s.topic::text, s.scenario_text)
           ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           escape '\'
      )
    group by s.station_id, s.topic, s.category, s.difficulty, s.uni_tags, s.prep_time_sec

    union all

    select
      'roleplay'::text,
      r.station_id,
      r.title::text,
      r.category::text,
      r.topic::text,
      r.difficulty::text,
      r.uni_tags::text[],
      r.prep_time_sec,
      1::integer
    from public.roleplay_stations r
    where r.status::text = 'published'
      and (p_category is null or r.category::text = p_category)
      and (p_university is null or p_university = any(r.uni_tags::text[]))
      and (p_difficulty is null or r.difficulty::text = p_difficulty)
      and (p_kind is null or p_kind = 'roleplay')
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', r.title::text, r.topic::text, r.opening_line)
           ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           escape '\'
      )
  )
  select *
  from cards
  order by title, station_kind, station_id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
```

- [x] Reconcile the sample casts above with the Task 1 catalog result (especially `uni_tags` and status enums) without changing the declared return columns or assessor-field exclusion boundary. Implement AND-combined filters. Search only public title/topic/scenario-preview fields using escaped `ILIKE`; clamp `p_limit` to `1..50`, clamp offset to non-negative, and return a stable `station_kind, station_id` order after the selected user sort.

- [x] Add `public.get_mmi_station_preview(p_kind text, p_station_id text)` returning:

```sql
(station_kind, station_id, title, category, topic, difficulty,
 university_tags, prep_time_sec, prompt_count, student_brief, opening_line)
```

For standard stations, `student_brief` may contain the published scenario. For role-play, it may contain the student-facing title/brief and `opening_line`; it must never contain `actor_persona` or `background_info`. No sub-question text is returned by the preview API.

- [x] Add `public.get_next_mmi_station_preview(p_kind text, p_station_id text)` using the same safe projection and stable `(title, station_kind, station_id)` ordering. It excludes the current identity, returns the next published card with one wrap at the end, returns no row when no alternative exists, and never creates an attempt. This supports the summary's **Next station** action without becoming an MMI Circuit.

- [x] Add statement-level tests proving `model_answer_cached`, `actor_persona`, `background_info`, rubric text, draft rows, and future prompt text never appear in JSON responses.

- [x] Run:

```bash
MMI_CONTENT_SECURITY_INTEGRATION_REQUIRED=1 npm test -- \
  tests/mmiStudentContentPolicy.test.ts \
  tests/integration/mmiContentSecurity.integration.test.ts
```

#### Task 2 audit record — 2026-08-18

- TDD RED was captured before the migration existed: all five SQL-contract assertions failed, and the disposable pre-Task-2 database failed all seven RPC behavior assertions because the functions were absent. The direct-denial assertion already passed in the local harness; the hosted Task 1 audit remains the evidence that its broader privilege baseline could expose assessor-bearing columns.
- A clean disposable local reset applied migrations through `20260817001000_mmi_student_content_api.sql`. With `MMI_CONTENT_SECURITY_INTEGRATION_REQUIRED=1` preventing a missing-credential false pass, the selected Task 2 suite then passed `14/14`, and the complete Node suite passed `19/19` after an explicit, successful reapplication of the Task 2 migration.
- Authenticated student and admin fixtures were both denied direct base-table reads, guessed-ID reads, hidden-field filters, `select('*')`, and relationship expansion. Anonymous callers were denied all three RPCs. RPC-level `select('*')` returned only the fixed safe tuple, while hidden-field filtering and relationship expansion failed.
- Discovery returns published standard stations with at least one prompt and published role-play stations only. Filters combine with AND semantics; `%` and `_` are treated literally; limit and offset are clamped; card and next-station ordering is stable. Missing, draft, guessed, and unsupported station identities fail closed.
- Response assertions recursively checked both field names and synthetic hidden-value markers. No cached model answer, role-play persona/background, rubric marker, draft content, current prompt, or future prompt appeared in a card or preview response.
- The migration was reviewed as a privilege-hardening change: it contains no table drop, truncation, content-row update/delete, secret value, dependency, or lockfile change. It was not applied to hosted Supabase, and no function, secret, or external resource was deployed or modified.

---

### Task 3: Add versioned rubrics, attempts, prompt results, and scoring claims

**Files:**

- Create: `supabase/migrations/20260817002000_mmi_practice_persistence.sql`
- Create: `tests/mmiPracticePersistencePolicy.test.ts`
- Create: `tests/integration/mmiAttemptPersistence.integration.test.ts`

**Purpose:** The MMI lifecycle needs its own persistence and authorization model. Client roles receive read-only access to their own safe results; Edge Functions make all state changes with service credentials after JWT authorization.

- [x] Write RED tests for schema invariants:

  - exactly one rubric target: standard sub-question or role-play station;
  - one active rubric version per target;
  - five dimension weights, each `0..1`, with applicable weights summing to `1`;
  - exactly one station target per attempt;
  - one persisted result per `(attempt_id, prompt_order)`;
  - one claim per `(user_id, idempotency_key)`;
  - no backward progression or completion before every expected prompt is scored;
  - the next prompt is not current until the student explicitly acknowledges feedback;
  - cross-user reads and all direct client writes are denied.

- [x] Create these enums:

```sql
create type public.mmi_station_kind as enum ('standard', 'roleplay');
create type public.mmi_attempt_status as enum ('in_progress', 'completed', 'abandoned');
create type public.mmi_attempt_phase as enum ('preparing', 'prompt_active', 'awaiting_continue', 'final_feedback');
create type public.mmi_claim_status as enum ('claimed', 'completed', 'retryable_failure');
create type public.mmi_rubric_status as enum ('draft', 'active', 'retired');
create type public.mmi_transcript_retention_mode as enum ('account_lifetime', 'fixed_days');
```

- [x] Create `mmi_scoring_rubrics` with:

```text
id uuid PK
standard_sub_q_id text nullable FK -> mmi_sub_questions.sub_q_id
roleplay_station_id text nullable FK -> roleplay_stations.station_id
version integer > 0
status mmi_rubric_status
criteria jsonb
dimension_weights jsonb
safety_critical_items jsonb
clinician_reviewed_at timestamptz nullable
clinician_reviewed_by uuid nullable FK -> profiles.id
created_at / updated_at timestamptz
```

Use a CHECK for exactly one target, require both clinician-review fields before `active`, add target-specific unique indexes on `(standard_sub_q_id, version)` and `(roleplay_station_id, version)`, and add partial unique indexes so only one `active` rubric exists per target. Validate each safety item as `{ id, assessor_criterion, student_feedback }`, where only `student_feedback` may be copied into a student result. Once a rubric is active or retired, a trigger prevents edits to its criteria, weights, safety items, target, or version; correction requires a new version. Direct client access is denied.

- [x] Create `mmi_attempts` with:

```text
id uuid PK
user_id uuid FK -> profiles.id ON DELETE CASCADE
station_kind mmi_station_kind
standard_station_id text nullable FK -> mmi_stations.station_id
roleplay_station_id text nullable FK -> roleplay_stations.station_id
status mmi_attempt_status
phase mmi_attempt_phase
preparation_ends_at timestamptz
current_prompt_order integer >= 1
expected_prompt_count integer >= 1
content_snapshot jsonb
privacy_notice_version text
privacy_notice_acknowledged_at timestamptz
started_at / completed_at / abandoned_at timestamptz
overall_pct numeric nullable CHECK 0..100
```

Use a CHECK for exactly one station target. `content_snapshot` contains only IDs, content versions, and student-safe display text; never copy hidden actor context or rubric instructions into this client-readable row.

- [x] Create `mmi_prompt_attempts` with a duplicated `station_kind`, the discriminated prompt identity, nullable reviewed transcript, validated public dimension-result JSON (`applicable` but no exact weights), persisted feedback, pinned rubric ID/version, global scoring-contract version, score percentage, `free_text_purged_at`, and timestamps. Add `UNIQUE (id, station_kind)` to `mmi_attempts` and a composite FK `(attempt_id, station_kind)` so the local CHECK can require `standard_sub_q_id` only when `station_kind = 'standard'` and require it to be null for role-play. Do not attempt a cross-table lookup from a PostgreSQL CHECK; the completion RPC separately verifies the snapshot/attempt relationship while holding the attempt lock. The persistence trigger also fails closed if result identity, rubric provenance, or scoring-contract version differs from the pinned snapshot.

- [x] Create service-readable/student-safe `mmi_privacy_notices` with immutable `version`, processor name, notice text, `retention_mode`, nullable positive `retention_days`, `published_at`, and one active version. The active CHECK requires days only for `fixed_days`. Expose it through `public.get_active_mmi_privacy_notice()` with a fixed return type of `(version, processor_name, notice_text, retention_mode, retention_days)`; clients cannot insert/update the table. The RPC returns no row when release privacy configuration is absent, which makes starting an attempt fail closed.

- [x] Create service-only `mmi_attempt_prompt_snapshots` rows at attempt start, keyed by `(attempt_id, prompt_order)`. Each row pins the prompt identity/text, timing, hidden reference/actor context, rubric ID/version, rubric criteria/weights/safety items, content version, global scoring-contract version, and exact immutable global contract/schema snapshot used for that attempt. Revoke all client access so future prompt text, scorer instructions, and assessor context cannot be selected even by the attempt owner.

- [x] Create `mmi_scoring_claims` with `user_id`, `attempt_id`, `idempotency_key uuid`, prompt identity, `request_digest`, status, `lease_token uuid`, `lease_expires_at`, provider-attempt count, safe error code, timestamps, and nullable `prompt_attempt_id`. Never store the raw transcript or provider response body in a claim. Purge expired completed/failed claims after 30 days, after the attempt-level one-submission constraint is authoritative.

- [x] Create service-only `mmi_transcription_events` with `user_id`, `attempt_id`, byte count, MIME type, safe outcome code, and timestamp. It exists only for rate limiting/cost auditing and contains no audio URI, bytes, transcript, or provider body.

- [x] Add service-only `claim_mmi_transcription_attempt(p_user_id uuid, p_attempt_id uuid, p_byte_count integer, p_mime_type text)`. It takes a transaction-scoped per-user advisory lock, atomically enforces both count/byte windows across all the user's attempts, and inserts the event before returning its ID. A companion `complete_mmi_transcription_attempt(p_event_id uuid, p_safe_outcome_code text)` records only a safe outcome. Add a cross-attempt concurrency test at the limit boundary.

- [x] Create `purge_expired_mmi_private_text()` as a service-only function and schedule it daily with Supabase Cron. It joins each attempt to the immutable notice version that user acknowledged. In `fixed_days` mode it nulls the reviewed transcript and transcript-derived free text (evidence, strengths, improvements, tips) after that notice's configured period while retaining numeric scores and setting `free_text_purged_at`; in `account_lifetime` mode the existing profile cascade is the deletion mechanism. The same job deletes scoring claims and transcription events older than 30 days. Tests must cover both modes and prove no audio was ever present to purge.

- [x] For every function added in this migration, set a fixed `search_path` and explicitly revoke default execution from `PUBLIC`. Grant `get_active_mmi_privacy_notice()` only to `authenticated`; grant purge/maintenance functions only to `service_role` (the Cron job owner may execute as database owner). Add negative normal-JWT invocation tests.

- [x] Enable RLS. Grant authenticated clients `SELECT` only on their own `mmi_attempts` and `mmi_prompt_attempts`. Add no direct client `INSERT`, `UPDATE`, or `DELETE` policy. Rubrics, prompt snapshots, scoring claims, and transcription events remain service-role only.

- [x] Add deterministic aggregate SQL used at completion:

```sql
round(sum(overall_pct)::numeric / nullif(count(*), 0), 1)
```

Dimension aggregates average only non-null scores. Do not call an LLM for the summary.

- [x] Rerun the persistence tests for GREEN and confirm migrations apply cleanly from an empty local database.

#### Task 3 audit record — 2026-08-20

- TDD RED was captured before implementation: all seven SQL-policy assertions failed because the migration was absent, and the disposable Task 2 database failed setup with `PGRST205` because `mmi_privacy_notices` did not exist.
- After security review, new RED policy assertions drove exact allowlists, NULL-safe snapshot identity, exact `1..N` prompt membership, insert-time result provenance, append-only results, snapshot deletion protection, same-attempt claim foreign keys, lifecycle enforcement, database-normalized retention timestamps, a score-preserving canonical purge transition, purge-state consistency, and indexed bounded retention batches.
- A clean disposable Task 2 database accepted `20260817002000_mmi_practice_persistence.sql`; the Task 3 integration suite passed `8/8`, the complete Node suite passed `34/34`, and an explicit reapplication of the final migration completed successfully.
- Database-backed counterexamples reject terminal attempt inserts, cross-attempt completed-claim links, malformed feedback arrays, mismatched discriminated identities, backward progression, incomplete completion, post-completion result edits, future retention timestamps, pre-set or score-changing purge markers, purged-text reintroduction, cross-user reads, direct client writes, and normal-JWT maintenance calls.
- Retention tests invoke the same function Cron calls and prove fixed-day transcript-derived text is purged while numeric history remains, account-lifetime text remains for profile-cascade deletion, and expired claims/events are deleted. Separate manual catalog inspection found one active daily Cron definition owned by `postgres`; no test claims to have observed a scheduler tick.
- Catalog inspection confirmed RLS on all seven tables, no client privileges on private tables, authenticated `SELECT` only on attempts/results, fixed-search-path RPCs with the intended execution grants, and no `CREATE` privilege on `public` for `anon`, `authenticated`, or `service_role`. No privacy notice or rubric content was seeded, so release remains fail closed pending approved content.
- `npx tsc --noEmit` remains red only on pre-existing app, admin import, UI token, RadarChart, and Deno typing failures; no Task 3 file appears in the final diagnostic list.
- The migration contains no table/schema/database drop, truncation, unscoped content mutation, secret value, dependency, or lockfile change. It was not applied to hosted Supabase, and no function, secret, deployment, or external resource was modified.

---

### Task 4: Define pure MMI contracts, rubric validation, aggregation, and lifecycle transitions

**Files:**

- Create: `src/features/mmi/types.ts`
- Create: `src/features/mmi/machine.ts`
- Create: `src/features/mmi/aggregation.ts`
- Create: `supabase/functions/_shared/mmiContracts.ts`
- Create: `supabase/functions/_shared/mmiScoringContract.ts`
- Create: `tests/mmiContracts.test.ts`
- Create: `tests/mmiMachine.test.ts`
- Create: `tests/mmiAggregation.test.ts`

**Purpose:** Keep business rules testable without React Native, Supabase, or a provider. Client and server types mirror the shared contracts at the top of this plan.

- [x] Write `mmiContracts.test.ts` first. Cover valid standard and role-play identities and reject blank IDs, unexpected keys, transcripts shorter than 20 or longer than 12,000 Unicode code points, invalid UUID idempotency keys, invalid weights, unknown/duplicated safety-critical omission IDs, and malformed model output. The internal provider result may contain rubric safety-item IDs; the public `MmiAssessment` must contain only mapped student-safe feedback, never `assessor_criterion` or raw rubric text.

- [x] Implement a strict parser that constructs a new object and rejects unknown provider keys rather than spreading untrusted JSON:

```ts
export function parseProviderAssessment(
  value: unknown,
  rubric: MmiRubric,
): ProviderAssessment {
  // Validate every field, discard nothing silently, and do not accept overallPct.
}
```

- [x] Write `mmiAggregation.test.ts` first for zero-weight dimensions, rounding, all-N/A rejection, and alternate weight distributions.

- [x] Implement server-owned percentage calculation:

```ts
export function calculateOverallPct(
  scores: Record<MmiDimension, MmiScore | null>,
  weights: Record<MmiDimension, number>,
): number {
  const weightedFivePointScore = MMI_DIMENSIONS.reduce((sum, dimension) => {
    const weight = weights[dimension];
    const score = scores[dimension];
    if (weight === 0) return sum;
    if (score === null) throw new Error(`Missing applicable score: ${dimension}`);
    return sum + score * weight;
  }, 0);

  return Math.round(weightedFivePointScore * 200) / 10;
}
```

This preserves the existing Interview Station convention documented in `score-answer`: a weighted 1–5 score maps to 20–100% via `score × 20`.

- [x] Write `mmiMachine.test.ts` first for this explicit lifecycle:

```text
idle -> loadingAttempt -> preparing -> readyToRecord -> recording
recording -> transcribing -> reviewingTranscript -> submitting
submitting -> feedback -> readyToRecord | summary
any network action -> recoverableError -> its prior retryable state
in-progress state -> abandoned
```

- [x] Implement pure `transition(state, event): State` using immutable objects. Reject invalid actions, especially `feedback -> submitting`, `feedback -> recording`, and any transition that would resubmit an already scored prompt.

- [x] Keep the copies in `src/features/mmi/types.ts` and `_shared/mmiContracts.ts` structurally identical. Add a compile-time fixture in the test so drift fails typecheck.

- [x] Define `MMI_SCORING_CONTRACTS` as an immutable version-keyed registry in `_shared/mmiScoringContract.ts`, initially containing `'2026-08-17.1'` with its UK medical-school assessor instructions and strict response schema/parser version. Attempt creation copies that exact contract into the service-only prompt snapshot. Scoring uses the snapshot plus the matching retained parser; changing instructions/schema requires a new registry entry and eval baseline, and entries referenced by persisted attempts are never overwritten or deleted. Add a compatibility test proving a version-1 attempt still scores after a synthetic version-2 entry becomes current.

- [x] Run:

```bash
npm test -- --run tests/mmiContracts.test.ts tests/mmiMachine.test.ts tests/mmiAggregation.test.ts
```

#### Task 4 audit record — 2026-08-20

- Fresh TDD RED mutations first proved that the unsafe provider boundary accepted provider prose, rejected the intended score/code/span shape, and required hidden inputs for public mapping. Subsequent independent-review mutations covered Task 3 persistence drift, caller-forged percentages, N/A score coupling, hostile Unicode, mutable allowlists and snapshots, retained-version catalog expansion, and schema/catalog framework mismatches.
- `ProviderAssessment` now contains only strict dimension scores, one transcript code-point evidence reference per applicable dimension, clinician-rubric strength/improvement codes, safety-item omission IDs, and an approved framework enum. Exact-key parsers reject prose, extra fields, unknown or duplicate codes, invalid spans, zero-weight scores, and semantically unusable transcripts.
- `MmiAssessment` is constructed only through an unforgeable server context. Evidence is sliced from the reviewed transcript; strengths, improvements, safety guidance, and framework tips resolve from clinician-approved, version-pinned templates. Provider prose, hidden context, rubric criteria, internal codes/IDs, vocal-delivery claims, and caller-supplied percentages have no public output field or mapping path.
- Public dimension results serialize exactly as Task 3 requires: `{ score, applicable, evidence, improvement }`. Safety guidance uses the existing student-safe `improvements` field, and the overall percentage is computed internally from validated scores and snapshotted weights.
- Rubric code/dimension/kind/template mappings live in the already-snapshotted rubric criteria JSON. The immutable `'2026-08-17.1'` scoring snapshot pins its response schema, retained parser, template texts, template kinds, and framework tips. Synthetic later versions prove that adding a new template or changing wording cannot rewrite or invalidate a retained v1 attempt; parser-compatible schemas must have an own pinned tip for every selectable framework.
- Lifecycle and aggregation stay pure and immutable. Tests explicitly reject `feedback -> submit`, `feedback -> startRecording`, scored resubmission, non-null zero-weight scores, invalid scores, non-unit weight totals, invalid retry provenance, and unsafe prompt progression.
- Final verification passed: the complete Node suite reported `35/35` passing with three environment-gated Supabase suites visibly skipped; the focused Task 4 suite reported `23/23`; native coverage reported `98.52%` lines, `84.63%` branches, and `98.82%` functions; and the explicit eight-file TypeScript gate produced no diagnostics.
- A new independent correctness/security review resolved every finding and returned READY with no CRITICAL, HIGH, MEDIUM, or LOW findings. GitNexus reports aggregate CRITICAL blast radius because the eight implementation files introduce foundational contract/registry/lifecycle flows; its refreshed change report is confined to the expected Task 4 symbols and flows.
- Task 4 changed only its eight declared implementation/test files plus this ledger update. It added no dependency or lockfile change, no secret, and no Task 5 file. Existing dependency advisories and full-repository TypeScript/module-mode warnings are pre-existing and were not changed or suppressed.

---

### Task 5: Harden the reusable scoring-provider boundary without changing the AI-key contract

**Files:**

- Create: `supabase/functions/_shared/aiProvider.ts`
- Create: `supabase/functions/_shared/providerUrl.ts`
- Create: `supabase/functions/_shared/http.ts`
- Modify: `supabase/functions/score-answer/index.ts`
- Create: `tests/aiProviderSecurity.test.ts`
- Create: `tests/edgeHttp.test.ts`
- Modify: `tests/integration/aiKeyContract.integration.test.ts`

**Purpose:** MMI scoring will reuse provider configuration, so existing weaknesses must not be copied: redirect following, hostname-only private-address checks, provider error leakage, and permissive output parsing.

- [ ] Before editing `score-answer`, run GitNexus impact analysis on its handler and on every extracted existing symbol. Report the blast radius and stop for confirmation if risk is HIGH/CRITICAL.

- [ ] Write RED tests proving:

  - `localhost`, literal private/link-local/loopback addresses, and hostnames resolving to them are rejected;
  - a public hostname absent from the server-owned provider allowlist is rejected;
  - redirects are rejected rather than followed;
  - credentials and untrusted prompt text are delimited and never placed in thrown/loggable errors;
  - non-2xx provider response bodies are not returned to clients;
  - legacy `score-answer` still reads `ai_api_key` only through the server-side config loader.

- [ ] Implement `assertSafeProviderUrl(url, allowedHosts, resolveDns)` with HTTPS-only production URLs, exact hostname membership in `AI_PROVIDER_ALLOWED_HOSTS`, explicit port policy, IP classification for IPv4/IPv6, `Deno.resolveDns` checks for A/AAAA records, and dependency injection for deterministic Vitest coverage. Default only to the hostnames already required by the built-in provider types; a custom OpenAI-compatible host must be explicitly added as an Edge secret before use.

- [ ] Implement scoring-provider requests with `redirect: 'error'`, `AbortSignal.timeout(60_000)`, generic safe error codes, and no raw provider-body logging. Add a contract test that the 60-second provider timeout remains comfortably below the 180-second scoring-claim lease.

- [ ] Implement shared browser/native HTTP handling. For requests with an `Origin`, reflect `Access-Control-Allow-Origin` only when it exactly matches a comma-separated `APP_ALLOWED_ORIGINS` entry and add `Vary: Origin`; reject a disallowed browser origin with `403` before business logic. Requests without `Origin` remain valid for native clients. Handle `OPTIONS` without business logic, allow only `POST, OPTIONS`, allow only `authorization, x-client-info, apikey, content-type`, expose `Retry-After`, and apply the same headers to success and error responses. Every new Phase 4 function must use this helper.

- [ ] Extract the existing provider call behind:

```ts
export interface AiProviderRequest {
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}

export async function callConfiguredProvider(
  config: AiConfig,
  request: AiProviderRequest,
): Promise<unknown>;
```

- [ ] Preserve the legacy response contract of `score-answer`; do not silently change its five required dimensions in this task.

- [ ] Run the new security tests plus every existing AI-key test:

```bash
npm test -- --run tests/aiProviderSecurity.test.ts tests/edgeHttp.test.ts tests/aiConfig.test.ts tests/aiKeyWriteOnlyPolicy.test.ts tests/integration/aiKeyContract.integration.test.ts
```

---

### Task 6: Implement authenticated attempt creation and safe restoration

**Files:**

- Create: `supabase/migrations/20260817002500_mmi_attempt_rpcs.sql`
- Create: `supabase/config.toml`
- Create: `supabase/functions/start-mmi-attempt/index.ts`
- Create: `supabase/functions/get-mmi-attempt/index.ts`
- Create: `supabase/functions/reveal-mmi-prompt/index.ts`
- Create: `supabase/functions/abandon-mmi-attempt/index.ts`
- Create: `src/features/mmi/api.ts`
- Create: `tests/integration/mmiAttemptLifecycle.integration.test.ts`

**Purpose:** The server pins content/rubric versions and reveals one current prompt. The browser never downloads the station's complete prompt sequence.

- [ ] Write RED integration tests for unauthenticated requests, draft/missing stations, missing active rubrics, guessed cross-user attempt IDs, role-play identity, and future-prompt non-disclosure.

- [ ] Add local Supabase configuration declaring `verify_jwt = true` for existing `score-answer`/`manage-ai-key` and every new Phase 4 function. Add a text-contract assertion so a missing function section or false JWT setting fails tests; never deploy with `--no-verify-jwt`.

- [ ] Add service-only `create_mmi_attempt(p_user_id uuid, p_station_kind mmi_station_kind, p_station_id text, p_privacy_notice_version text)`, `reveal_mmi_first_prompt(p_user_id uuid, p_attempt_id uuid)`, and `abandon_mmi_attempt(p_user_id uuid, p_attempt_id uuid)` RPCs. They make attempt + snapshot creation, preparation reveal, and abandonment transactional. Give all three `SECURITY DEFINER SET search_path = public, pg_temp`; revoke their exact signatures from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`. The abandon RPC locks the row, changes only `in_progress` attempts to `abandoned`, stamps `abandoned_at`, and is idempotent. Tests call them with a normal JWT and prove direct invocation is denied.

- [ ] Implement `POST /start-mmi-attempt` with:

```ts
type StartMmiAttemptRequest =
  | { stationKind: 'standard'; stationId: string; privacyNoticeVersion: string }
  | { stationKind: 'roleplay'; stationId: string; privacyNoticeVersion: string };

interface StartMmiAttemptResponse {
  attempt: SafeMmiAttempt;
}
```

It must authenticate the JWT, require the submitted privacy-notice version to equal the currently active notice, load only published content, require an active clinician-reviewed rubric for every expected prompt, create the prompt snapshots, record notice acknowledgement, set `phase = 'preparing'`, calculate `preparation_ends_at` from trusted server time, and return the safe station brief without any sub-question text.

- [ ] Implement authenticated `POST /reveal-mmi-prompt`. It locks the caller's attempt, requires `phase = 'preparing'` and `now() >= preparation_ends_at`, changes the phase to `prompt_active`, and returns only prompt order `1`. An early request returns safe `409 preparation_in_progress` plus trusted `remainingSeconds`; a repeated request after transition returns the same current prompt without changing order.

- [ ] Implement `POST /get-mmi-attempt` accepting `attemptId`. Return only the caller's attempt. When `phase = 'preparing'`, return the safe brief and trusted remaining time but no prompt; when `phase = 'awaiting_continue'`, return the persisted current feedback and no next prompt; when `phase = 'final_feedback'`, return the final persisted feedback plus summary availability; when `phase = 'prompt_active'`, return only the current prompt. Return the same generic not-found response for missing and other-user IDs.

- [ ] Implement authenticated `POST /abandon-mmi-attempt` and call only the service RPC after verifying ownership. It returns `204` for both first and repeated abandonment, rejects completed attempts, and never deletes persisted scores.

- [ ] For standard attempts, order by `order_num` and create the exact sequence in service-only `mmi_attempt_prompt_snapshots`. Pin question text, timing, hidden reference material, and the then-active rubric version. Do not place future prompt text in a client-readable row.

- [ ] For role-play, synthesize a single safe prompt from the student brief/opening line, keep `expected_prompt_count = 1`, and never emit `actor_persona` or `background_info`.

- [ ] Implement `src/features/mmi/api.ts` as typed wrappers around `supabase.functions.invoke`. Convert server codes into user-safe errors and never serialize an auth token into logs.

- [ ] Run the lifecycle integration test and a response snapshot assertion that recursively rejects hidden field names.

---

### Task 7: Implement idempotent, rubric-driven MMI scoring and atomic progression

**Files:**

- Create: `supabase/migrations/20260817003000_mmi_submission_rpcs.sql`
- Create: `supabase/functions/score-mmi-prompt/index.ts`
- Create: `supabase/functions/continue-mmi-attempt/index.ts`
- Create: `supabase/functions/_shared/mmiScoring.ts`
- Create: `tests/mmiScoring.test.ts`
- Create: `tests/integration/mmiScoringContract.integration.test.ts`

**Purpose:** A single successful submission must create one assessment, advance once, and replay safely without another paid provider call.

- [ ] Write pure RED tests for the system prompt. It must contain the attempt's pinned rubric snapshot, dimension weights, safety-critical items, hidden reference material, a warning that the transcript is untrusted data, and a strict JSON schema. It must state that `model_answer_cached` is reference material, not the only acceptable answer.

- [ ] Write integration RED tests for mismatched attempt/station/prompt identity, stale prompt order, cross-user attempts, invalid rubric, missing optional cached model answer, malformed provider output, prompt-injection text, duplicate sequential requests, concurrent duplicates, stale-lease recovery, changed-transcript idempotency conflict, provider failure followed by retry, and durable per-user rate limiting.

- [ ] Add service-only RPCs:

```sql
claim_mmi_scoring_submission(
  p_user_id uuid,
  p_attempt_id uuid,
  p_idempotency_key uuid,
  p_prompt_kind text,
  p_station_id text,
  p_sub_question_id text,
  p_request_digest text
)

complete_mmi_scoring_submission(
  p_claim_id uuid,
  p_lease_token uuid,
  p_transcript text,
  p_assessment jsonb,
  p_rubric_id uuid,
  p_rubric_version integer
)

fail_mmi_scoring_submission(
  p_claim_id uuid,
  p_lease_token uuid,
  p_safe_error_code text
)

advance_mmi_attempt_after_feedback(
  p_user_id uuid,
  p_attempt_id uuid
)
```

Define each mutation RPC as `SECURITY DEFINER SET search_path = public, pg_temp`, schema-qualify every object, and close PostgreSQL's default function privilege immediately:

```sql
revoke all on function public.claim_mmi_scoring_submission(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_mmi_scoring_submission(uuid, uuid, text, jsonb, uuid, integer) from public, anon, authenticated;
revoke all on function public.fail_mmi_scoring_submission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.advance_mmi_attempt_after_feedback(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_mmi_scoring_submission(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.complete_mmi_scoring_submission(uuid, uuid, text, jsonb, uuid, integer) to service_role;
grant execute on function public.fail_mmi_scoring_submission(uuid, uuid, text) to service_role;
grant execute on function public.advance_mmi_attempt_after_feedback(uuid, uuid) to service_role;
```

Add a text-contract test that fails if any service-only function lacks the revoke/grant/search-path trio.

The claim RPC first takes a transaction-scoped per-user advisory lock derived from the user UUID, then locks the attempt row. This serializes rate checks across different attempts owned by the same user. It requires `phase = 'prompt_active'`, validates current prompt identity and rate limits, and binds the idempotency key to a SHA-256 digest of the normalized identity plus reviewed transcript. Reuse with a different digest returns `409 idempotency_conflict`. A new claim receives a random lease token expiring after 180 seconds; an unexpired claim returns `409 submission_in_progress`, while an expired/retryable claim can be leased again and increments the provider-attempt counter. Completion/failure require the current lease token, so a late worker cannot overwrite a newer lease. The completion RPC inserts exactly one prompt attempt, marks the claim complete, and sets `phase = 'awaiting_continue'` when more prompts remain. On the last prompt it sets `status = 'completed'`, `phase = 'final_feedback'`, and aggregates the station so refresh still restores final feedback. The advance RPC is the only operation that increments `current_prompt_order`; it requires saved feedback for the current prompt and runs only after the explicit Continue action.

- [ ] Implement `score-mmi-prompt` in this order:

  1. Verify JWT and parse `SubmitMmiPromptRequest` strictly.
  2. Hash the normalized request, then claim the idempotency key and 180-second lease before any provider request.
  3. Return the saved result immediately if the claim is already complete.
  4. Fetch the attempt's current immutable prompt/rubric snapshot server-side; do not switch an in-flight attempt to a newly activated rubric.
  5. Delimit the transcript as untrusted content and call the configured provider.
  6. Strictly parse the provider JSON; compute `overallPct` on the server.
  7. Complete atomically through the RPC without advancing to a future prompt.
  8. On a technical failure, call the failure RPC with the lease token and a safe error code so the same digest/key is retryable.

- [ ] Return:

```ts
interface SubmitMmiPromptResponse {
  assessment: MmiAssessment;
  attemptStatus: 'in_progress' | 'completed';
  hasNextPrompt: boolean;
  replayed: boolean;
}
```

Do not return the next prompt in the scoring response. Implement authenticated `continue-mmi-attempt` only for an in-progress attempt with another prompt: **Continue to next prompt** invokes `advance_mmi_attempt_after_feedback` and returns only the newly current prompt. Refreshing before Continue must restore feedback rather than expose the next prompt. After the final score, the function rejects continuation because **View station summary** reads the already persisted summary instead.

- [ ] Enforce fixed per-user limits from `mmi_scoring_claims`, not the existing `answers` count: at most 20 real provider attempts in a rolling 60 minutes and 60 completed prompt submissions in a rolling 24 hours. Replays and concurrent callers waiting on the same claim consume neither allowance. Return safe `429 rate_limited` with `Retry-After`. Purge claims older than 30 days with the scheduled privacy/maintenance job. Add a concurrency test that submits different attempts for one user at the boundary and proves the advisory lock admits only the remaining allowance.

- [ ] Verify hidden context, prompt templates, API keys, provider bodies, and future questions are absent from responses and safe errors.

---

### Task 8: Add provider-isolated audio transcription and ephemeral recording validation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `supabase/functions/transcribe-mmi-audio/index.ts`
- Create: `supabase/functions/transcribe-mmi-audio/deno.json`
- Create: `supabase/functions/_shared/audioValidation.ts`
- Create: `supabase/functions/_shared/transcriptionProvider.ts`
- Create: `tests/audioValidation.test.ts`
- Create: `tests/integration/mmiTranscriptionContract.integration.test.ts`

**Purpose:** Voice is the answer-entry experience, but scoring remains transcript-only. The transcription key and audio lifecycle are isolated from the existing scoring key.

- [ ] Run `npm audit --omit=dev` and save the before-state in the execution notes. Do not run `npm audit fix --force`.

- [ ] Add the SDK with Expo-compatible resolution:

```bash
npx expo install expo-audio
```

Verify the manifest resolves to `"expo-audio": "~55.0.16"` and review the lockfile diff before continuing.

- [ ] Write RED unit tests for MIME allowlist, container magic bytes, actual byte length, 12 MiB maximum, parsed media duration outside the station/10-minute bound, reported-versus-parsed duration mismatch, missing multipart fields, zero-byte audio, absent/unparseable duration, and sanitized errors. Treat `durationMs` as untrusted metadata, never as the duration authority.

- [ ] Write RED integration tests for missing JWT, another user's attempt, absent/stale privacy acknowledgement, unsupported MIME, oversized/over-duration uploads, rate-limit exhaustion, provider failure, and absence of audio/provider payloads from persisted tables.

- [ ] Implement `transcribe-mmi-audio` to accept authenticated `multipart/form-data` fields:

```text
audio: Blob
attemptId: UUID
promptKind: standard | roleplay
stationId: string
subQuestionId: string only for standard
durationMs: positive integer
```

- [ ] Pin `music-metadata@11.8.3` in the function-local `deno.json`. Load the attempt/current prompt server-side and require its recorded privacy-notice acknowledgement. Verify the container signature matches the normalized MIME allowlist, then parse the Blob with `parseBlob(blob, { duration: true, skipCovers: true })`. Fail closed when duration is missing/non-finite. Reject actual duration above `min(prompt.time_limit_sec, 600) + 2` seconds; the two-second allowance covers recorder/container rounding, not extra answer time. Keep the actual 12 MiB Blob limit and durable per-user transcription rate limit as independent cost controls.

- [ ] After local validation and before the provider call, invoke the atomic transcription-claim RPC. Enforce at most 30 real provider attempts per user in a rolling 60 minutes, 90 in a rolling 24 hours, and 300 MiB of accepted audio in a rolling 24 hours. Every accepted outbound attempt, including provider failures, consumes the allowance; invalid pre-provider uploads do not. Return safe `429 rate_limited` with `Retry-After`.

- [ ] Forward an in-memory `FormData` request to the fixed `https://api.openai.com/v1/audio/transcriptions` endpoint with `redirect: 'error'`, `AbortSignal.timeout(120_000)`, `model = 'whisper-1'`, `response_format = 'verbose_json'`, and `TRANSCRIPTION_API_KEY`. Do not use `app_config` or `ai_api_key`; return only generic safe codes on provider errors.

- [ ] Strictly validate the provider's `duration` and `text`. Require finite decoded duration, reject the response when decoded duration exceeds `min(prompt.time_limit_sec, 600) + 2`, and reject when local-versus-provider duration differs by more than 2 seconds. The provider-decoded duration is authoritative for acceptance; the 12 MiB and durable attempt/byte limits remain the pre-call cost boundaries. Test adversarial files whose container metadata under-reports their decoded duration.

- [ ] Return only:

```ts
interface TranscriptionResponse {
  text: string;
  warning?: 'low_signal' | 'possibly_truncated';
}
```

Complete the claimed event with a safe success/failure code after the provider attempt. Never store the Blob, temporary URI, provider body, waveform, or unreviewed transcript. Let all in-memory references fall out of scope after the response. Do not log audio or transcript text.

- [ ] Rerun `npm audit --omit=dev` and deliberately compare the dependency finding delta. If Expo Audio introduces a new finding, document it; do not force-upgrade Expo SDK.

---

### Task 9: Build the typed station-library data layer and filters

**Files:**

- Create: `src/features/mmi/stations.ts`
- Create: `tests/mmiStations.test.ts`

**Purpose:** Centralize safe query parameters and pagination before connecting UI, so search can never target assessor fields.

- [ ] Write RED tests for filter normalization, AND composition, empty strings, category/university/difficulty/kind combinations, stable pagination, maximum page size, and SQL-wildcard characters in search input.

- [ ] Implement:

```ts
export interface MmiStationFilters {
  category: string | null;
  university: string | null;
  difficulty: string | null;
  search: string;
  kind: 'standard' | 'roleplay' | null;
}

export interface MmiStationPage {
  items: MmiStationCard[];
  nextOffset: number | null;
}

export async function listMmiStations(
  filters: MmiStationFilters,
  offset: number,
  limit = 20,
): Promise<MmiStationPage>;
```

- [ ] Call only `list_mmi_station_cards`; never query the base tables from client code. Sanitize user input for display, pass filter values as RPC parameters, and return new immutable arrays/objects.

- [ ] Treat role-play as a discriminated card type so it can show a distinct label without exposing hidden scenario fields.

- [ ] Add deterministic fixtures that include multiple universities, categories, difficulty values, and both station kinds. Verify no fixture needs a model answer to render a card.

---

### Task 10: Build the dedicated MMI client state engine

**Files:**

- Create: `src/stores/mmiPracticeStore.ts`
- Create: `tests/mmiStore.test.ts`

**Purpose:** Screens issue domain commands instead of setting arbitrary flags. This enforces one submission and one forward path across browser and native platforms.

- [ ] Write RED store tests for the standard happy path, role-play path, reconnect restoration, microphone denial with typed fallback, transcription retry, scoring retry with the same idempotency key, duplicate Submit taps, immutable state, and clearing feedback before the next prompt.

- [ ] Implement a Zustand store whose public commands are:

```ts
startAttempt(identity)
restoreAttempt(attemptId)
revealFirstPromptAfterPreparation()
startRecording()
stopRecording(recording)
transcribeRecording()
updateReviewedTranscript(text)
submitCurrentPrompt()
continueForward()
abandonAttempt()
resetTransientError()
```

- [ ] Generate one UUID idempotency key when entering transcript review. Reuse it for every technical retry and discard it only after a persisted successful assessment or abandonment.

- [ ] Discard recording URIs/Blob references immediately after successful transcription (and on abandonment); retain them only while a transcription retry is possible. Freeze the reviewed transcript when the first scoring request begins so every scoring retry has the same digest/key; retain it on retryable failure. After successful scoring, expose no retry/resubmit command. Mid-station `continueForward()` calls the server-owned continue operation and returns only the next prompt; final feedback exposes only summary navigation.

- [ ] Persist only `attemptId` for reconnect recovery. Do not persist raw audio, reviewed transcript drafts, hidden content, auth tokens, or feedback duplicated from Supabase.

- [ ] `abandonAttempt()` calls the authenticated Edge Function before clearing local state and always invokes recorder cleanup. If the network call fails, keep the attempt ID and show a retryable leave error rather than pretending the server abandoned it.

- [ ] Keep `src/stores/practiceStore.ts` untouched unless a later isolated progress integration requires a read-only import.

---

### Task 11: Replace the Questions placeholder with the MMI station library

**Files:**

- Create: `src/features/mmi/components/StationCard.tsx`
- Create: `src/features/mmi/components/StationFilters.tsx`
- Create: `src/features/mmi/components/StationListState.tsx`
- Modify: `app/(tabs)/questions.tsx`
- Create: `e2e/mmi-station-library.spec.ts`

**Purpose:** Turn the existing placeholder into the approved Phase 4 entry point without adding MMI Circuit or changing Tutor.

- [ ] Before editing `QuestionsScreen`, run GitNexus upstream impact analysis and report the tab/navigation blast radius.

- [ ] Write browser E2E tests first against mocked safe RPC responses. Cover:

  - initial loading and published results;
  - category, university, difficulty, kind, and text filters combined with AND semantics;
  - clear-all filters;
  - empty catalog, no-results, recoverable error, and pagination states;
  - standard and role-play cards navigating to their own detail identity;
  - no MMI Circuit option and Tutor still showing Coming soon.

- [ ] Build accessible controlled filters with visible labels and deterministic test IDs. Debounce text search by 250 ms and cancel/ignore stale results.

- [ ] Render cards from the safe DTO only: title/topic, category, difficulty, university tags, station kind, preparation duration, and prompt count. Navigate with Expo Router's pathname/params form so text business IDs are encoded safely:

```ts
router.push({
  pathname: '/mmi/stations/[stationKind]/[stationId]',
  params: { stationKind, stationId },
});
```

Test IDs containing spaces, `/`, `?`, `#`, Unicode, and percent signs. Never infer assessor information from hidden fields.

- [ ] Preserve the existing tab route and icon so deep links/bookmarks do not break.

---

### Task 12: Add voice recording, transcript review, and the standard-station route flow

**Files:**

- Create: `src/features/mmi/useMmiAudioRecorder.ts`
- Create: `src/features/mmi/audioRecordingSession.ts`
- Create: `src/features/mmi/components/RecordingControls.tsx`
- Create: `src/features/mmi/components/TranscriptReview.tsx`
- Create: `src/features/mmi/components/MmiPrivacyNotice.tsx`
- Create: `app/mmi/_layout.tsx`
- Create: `app/mmi/stations/[stationKind]/[stationId].tsx`
- Create: `app/mmi/attempts/[attemptId]/prepare.tsx`
- Create: `app/mmi/attempts/[attemptId]/response.tsx`
- Modify: `app/_layout.tsx`
- Modify: `src/components/ui/TimerRing.tsx`
- Create: `tests/audioRecorder.test.ts`
- Create: `tests/TimerRing.test.tsx`

**Purpose:** Deliver the voice-first student experience while keeping a typed transcript fallback for permissions/accessibility and keeping audio transient.

- [ ] Before editing the root layout or `TimerRing`, run GitNexus upstream impact analysis on their exported symbols and report affected routes/components.

- [ ] Write RED tests against the dependency-injected pure `audioRecordingSession.ts` controller for permission granted/denied, unsupported web recording, interruption, manual stop, timer stop, cleanup after transcription, cleanup on abandonment, and cleanup after an error. Keep the React hook as a thin Expo binding; verify that binding with browser E2E and the manual device matrix rather than importing React Native hooks into node-only Vitest.

- [ ] Wrap Expo Audio behind a custom React hook so Expo's `useAudioRecorder` and `useAudioRecorderState` obey the Rules of Hooks:

```ts
export interface MmiRecording {
  uri: string;
  mimeType: string;
  durationMs: number;
}

export interface MmiAudioRecorderController {
  requestPermission(): Promise<'granted' | 'denied'>;
  start(maxDurationMs: number): Promise<void>;
  stop(): Promise<MmiRecording>;
  discard(recording: MmiRecording): Promise<void>;
}

export function useMmiAudioRecorder(): MmiAudioRecorderController;
```

The hook owns `useAudioRecorder`, `useAudioRecorderState`, `RecordingPresets.HIGH_QUALITY`, and station-limit cleanup. `response.tsx` calls the hook and dispatches plain recording events into Zustand; the store and ordinary modules never call React hooks. Map web/native output MIME types to the transcription allowlist.

- [ ] Build the route sequence:

```text
/mmi/stations/:stationKind/:stationId     unambiguous safe preview and Start
/mmi/attempts/:attemptId/prepare          student brief and prep countdown
/mmi/attempts/:attemptId/response         current prompt, recording, transcription, review, submit
```

- [ ] Keep route params to safe IDs only. Validate `stationKind` as `standard | roleplay` before fetching; the extra segment prevents equal text IDs in the two source tables from colliding. Each attempt route restores state from the server rather than trusting serialized prompt/rubric data in URL params.

- [ ] Before the Start action can create an attempt or request microphone permission, render the active notice's exact processor, audio-handling statement, transcript/feedback retention mode, deletion behavior, and version. Require an explicit acknowledgement checkbox/button; pass that version to `start-mmi-attempt`. If no active notice exists, disable Start with a configuration error. Browser E2E must prove the permission/recording path is unreachable before acknowledgement.

- [ ] The station preparation timer runs once. At expiry, call `reveal-mmi-prompt`; do not keep the first prompt in client state before that response. Each response timer then stops the recorder exactly once and transitions to transcription. On denied permission or unsupported recording, show a plain typed-answer fallback that still enters the same review/submit path.

- [ ] Make the transcript editable before submission and immutable afterward. Label it clearly: “AI feedback is based on this transcript, not your vocal delivery.”

- [ ] Add screen-reader announcements for timer thresholds, recording state, transcription completion/failure, and feedback availability. Honor reduced motion.

- [ ] Intercept in-app back/tab navigation while an attempt is `in_progress` and show a confirmation that progress on the current unsubmitted prompt will be lost. Confirm calls `abandonAttempt()`; cancel stays on the screen. A hard browser close uses `beforeunload` warning only and leaves the server attempt restorable because async abandonment is not reliable during unload. Add browser tests for cancel, confirmed abandonment, network failure, refresh restoration, hard-close restoration, and recorder cleanup.

- [ ] Add `mmi` to the root stack without changing auth/onboarding guard order.

---

### Task 13: Add immediate feedback, sole forward progression, summary, and single-turn role-play

**Files:**

- Create: `src/features/mmi/components/MmiDimensionBreakdown.tsx`
- Create: `src/features/mmi/components/MmiFeedbackView.tsx`
- Create: `app/mmi/attempts/[attemptId]/feedback.tsx`
- Create: `app/mmi/attempts/[attemptId]/summary.tsx`
- Modify: `src/features/mmi/api.ts`
- Modify: `src/stores/mmiPracticeStore.ts`
- Create: `tests/mmiFeedbackPresentation.test.ts`
- Create: `tests/mmiSummary.test.ts`
- Create: `e2e/mmi-station-practice.spec.ts`

**Purpose:** Complete the approved learning loop: one answer, immediate evidence-based feedback, then one forward action. Role-play uses the same pipeline but ends after its single response.

- [ ] Before modifying MMI API/store symbols, run GitNexus upstream impact analysis and report their screen/test consumers.

- [ ] Write RED presentation tests proving:

  - only applicable non-null dimensions render;
  - evidence and improvements are labelled as transcript-based;
  - a successful result has no Retry, Record again, Edit, or Submit again action;
  - the only mid-station prompt action is **Continue to next prompt**;
  - the only final-prompt/role-play action is **View station summary**;
  - summary numbers come from persisted attempts, not a new provider request.

- [ ] Implement the feedback route using `MmiAssessment`. Reuse `ScoreDimensionBar`; do not force N/A dimensions into the legacy five-axis `RadarChart`.

- [ ] Implement `continueForward()` through `continue-mmi-attempt` only for an in-progress attempt: the server acknowledges feedback, advances once, returns only the next current prompt, and the client enters `readyToRecord` directly; station preparation is not repeated. Completed standard/role-play attempts render **View station summary**, which navigates to the already persisted summary without invoking the continue RPC.

- [ ] Build a deterministic summary containing overall percentage, applicable-dimension aggregates, prompt-by-prompt feedback links, completion time, and station metadata. Add **Next station** (safe next preview, no auto-start), **Return to station library**, and **View progress** actions. Do not call an AI provider.

- [ ] Model retained history separately from a fresh `MmiAssessment`: when `free_text_purged_at` is set, preserve numeric scores, show “Detailed transcript feedback expired under your acknowledged retention policy,” and omit transcript/evidence links. Never synthesize deleted feedback from an LLM.

- [ ] Use the same screens for role-play with `stationKind = 'roleplay'`, one prompt, the student-facing opening line, and hidden actor context fetched only inside scoring. Do not add chat bubbles, simulated actor turns, streaming conversation, or an MMI Circuit queue.

- [ ] Implement full mocked browser E2E coverage:

```text
library -> standard preview -> prepare -> record/transcribe -> edit transcript
-> submit once -> immediate feedback -> continue -> next prompt
-> final feedback -> summary
```

Also cover permission denial with typed fallback, transcription retry, scoring technical retry without duplication, double-click Submit, refresh/restore, timer expiry, and the single-turn role-play path.

---

### Task 14: Integrate completed MMI history into Progress without disturbing free practice

**Files:**

- Create: `supabase/migrations/20260817004000_mmi_progress_api.sql`
- Create: `src/features/mmi/progress.ts`
- Modify: `app/(tabs)/progress.tsx`
- Create: `tests/mmiProgress.test.ts`
- Create: `tests/integration/mmiProgressSecurity.integration.test.ts`
- Modify: `e2e/onboarding-practice.spec.ts`

**Purpose:** Make completed station work discoverable while retaining the legacy answers/scores flow.

- [ ] Before editing `ProgressScreen`, run GitNexus impact analysis and report affected tab/process paths.

- [ ] Write RED tests for no MMI history, mixed free-practice/MMI history, role-play labels, deterministic ordering, applicable-dimension averages, and cross-user isolation.

- [ ] Add `public.list_completed_mmi_attempts(p_limit integer default 20, p_before_completed_at timestamptz default null, p_before_id uuid default null)` as a fixed-return-type `SECURITY INVOKER` RPC. It filters with `user_id = auth.uid()` plus completed status, projects only safe persisted summary fields, clamps the limit to `1..50`, and paginates by `(completed_at, id) DESC`. Revoke default execution and grant only `authenticated`; underlying own-row RLS remains active.

- [ ] Write integration tests proving another student's cursor/attempt IDs cannot reveal rows, `select('*')` is impossible through the fixed return type, assessor fields are absent, expired free text stays absent, and anonymous calls are denied.

- [ ] Implement `listCompletedMmiAttempts()` using only that RPC. Return only persisted summary data and its stable next cursor.

- [ ] Add a distinct “MMI Stations” history section to Progress. Keep existing free-practice stats and queries intact rather than folding incompatible score records together.

- [ ] Extend the existing onboarding/free-practice E2E only with regression assertions. Do not rewrite it around MMI fixtures.

---

### Task 15: Run security, integration, coverage, export, and release-readiness gates

**Files:**

- Create: `docs/testing/phase-4-voice-device-matrix.md`
- Create: `docs/security/2026-08-17-npm-production-audit.md`
- Create: `tests/evals/mmiScoring.eval.test.ts`
- Create: `tests/evals/fixtures/launch-mmi-eval.json`
- Create: `tests/evals/fixtures/approved-baseline.json`
- Modify: `README.md`
- Modify: `vitest.config.mts`
- Modify: relevant plan/spec status sections only after gates pass

**Purpose:** Verify the feature as a cross-platform, security-sensitive workflow before asking for deployment permission.

- [ ] Run all unit and text-contract tests:

```bash
npm test -- --run
```

- [ ] Run coverage and enforce at least 80% for new pure MMI modules and Edge shared modules. Expand `vitest.config.mts` coverage includes to:

```ts
[
  'src/features/mmi/**/*.ts',
  'supabase/functions/_shared/**/*.ts',
]
```

Then run:

```bash
npm run test:coverage -- --run
```

- [ ] Run typecheck and web export:

```bash
npx tsc --noEmit
npx expo export --platform web
```

- [ ] Run integration tests against an isolated Supabase project/local stack with seeded synthetic content only. Prove:

  - non-admin and admin clients cannot read assessor fields;
  - neither role can write `ai_api_key` directly;
  - admin key replacement and legacy scoring still satisfy the existing contract;
  - attempt rows/results are owner-readable and client-write-denied;
  - duplicate idempotency keys create one score;
  - current-prompt APIs never return future prompts;
  - transcript is persisted but audio is not;
  - fixed-day retention purges transcript-derived free text on schedule while retaining numeric history;
  - account-lifetime retention cascades on account deletion;
  - no attempt/transcription starts without acknowledgement of the currently active privacy-notice version.

- [ ] Run Playwright:

```bash
npm run test:e2e
```

- [ ] Run an unmocked browser-origin integration against locally served Edge Functions. From an allowed test origin, verify preflight and authenticated POST responses for all seven Phase 4 functions; from a disallowed origin, verify `403` and no CORS authorization. This gate must exercise real `OPTIONS` handling rather than Playwright route mocks.

- [ ] Complete the manual matrix on Chrome, Safari, Firefox, iOS, and Android for microphone permission, maximum-duration cutoff, interruption recovery, browser refresh, keyboard-only completion, screen-reader announcements, and reduced motion.

- [ ] Verify the scheduled `purge_expired_mmi_private_text()` job in the isolated database by advancing fixture timestamps, invoking the same function Cron calls, and inspecting Cron job configuration/run history. Production release remains blocked until the user approves the notice wording and retention mode/value.

- [ ] Run a deliberate production audit and document findings by direct dependency, transitive path, reachability, Expo compatibility, mitigation, and upgrade owner:

```bash
npm audit --omit=dev
```

Then run `npm explain` once for each reported package name and record its complete transitive path.

The refreshed 2026-08-17 production baseline is 31 findings (1 critical, 20 high, 9 moderate, 1 low), but rerun rather than assuming it is unchanged after `expo-audio`. Review compatible leaf candidates separately: `@babel/core`, `shell-quote`, `@xmldom/xmldom`, `brace-expansion`, `js-yaml`, `node-forge`, `picomatch`, `nanoid`, `ws`, and `yaml`. Inspect each parent semver range and lockfile diff; do not blindly add overrides. The remaining Expo config/CLI/Metro/PostCSS chain requires the separately approved Expo SDK 57 migration. The React Native/Worklets/Metro `image-size` chain requires coordinated Expo/RN compatibility work; reject npm audit's incompatible RN/Worklets downgrade suggestions. Apply only the compatible set under TDD after the current dirty dependency work is isolated, rerun typecheck/unit/export/E2E/audit, and never use `npm audit fix --force`.

Do not run `npm audit fix --force`. Keep the Expo SDK 57 migration as a separately approved breaking upgrade.

- [ ] Run a final security review focused on JWT verification, service-role isolation, `SECURITY DEFINER` search paths/grants, RLS, prompt injection, provider URL SSRF/redirects, input limits, error/log leakage, idempotency, and transcript/audio privacy.

- [ ] After clinicians supply and sign off the synthetic, non-personal cases in `launch-mmi-eval.json`, run the real configured scorer at deterministic settings three times per case and evaluate the median. Each fixture declares prompt/rubric version, answer, allowed overall/dimension ranges, acceptable alternative-answer rationale, required safety-item IDs, and whether unsafe advice must cap the result. The release gate is: 100% strict-schema success; 100% of safety-critical cases identify every required omission and stay at/below the clinician-set maximum; at least 90% of all cases fall inside clinician ranges; and no alternative-valid case falls below its clinician-set minimum.

- [ ] Compare the run with `approved-baseline.json`. Any missed safety-critical item, any newly leaked rubric/reference text, an overall gate below 90%, or mean absolute overall-score drift above 5 percentage points blocks release and triggers rollback to the previously approved prompt/rubric/provider version. Do not weaken expected ranges to make a failing model pass; rubric/eval changes require renewed clinician review.

- [ ] Run `gitnexus_detect_changes({scope: 'all'})` and compare every affected symbol/process with the planned blast radius. Review `git diff --check` and `git diff --stat`.

- [ ] Update README setup with the new local migration/function names and secret names, but do not add secret values. Document that audio is transient and grading is transcript/rubric based.

- [ ] Stop and present the complete local verification report. Request explicit permission separately for each external action: remote migrations, Edge secrets, function deployment, and any commit/push.

## Conditional deployment sequence — not authorized by this plan

Only after the user reviews local results and explicitly authorizes production changes:

1. Back up/audit the remote schema and apply migrations in timestamp order.
2. Configure `TRANSCRIPTION_API_KEY`, the audited `AI_PROVIDER_ALLOWED_HOSTS`, and the approved `APP_ALLOWED_ORIGINS` value as Edge secrets.
3. Deploy `start-mmi-attempt`, `get-mmi-attempt`, `reveal-mmi-prompt`, `abandon-mmi-attempt`, `score-mmi-prompt`, `continue-mmi-attempt`, and `transcribe-mmi-audio` with JWT verification enabled.
4. Seed only clinician-approved active rubrics through an admin/service workflow; never ship draft fixture rubrics.
5. Run production-safe smoke tests with a dedicated test user and synthetic answer.
6. Confirm `score-answer` and `manage-ai-key` remain active and that `ai_api_key` remains unreadable.

## Official implementation references

- Expo Audio SDK 55: <https://docs.expo.dev/versions/v55.0.0/sdk/audio/>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
- Supabase Edge Function dependency management: <https://supabase.com/docs/guides/functions/dependencies>
- Supabase Cron: <https://supabase.com/docs/guides/cron>
- OpenAI audio transcription API: <https://platform.openai.com/docs/api-reference/audio/createTranscription>
- OpenAI Whisper model: <https://developers.openai.com/api/docs/models/whisper-1>
- OpenAI API data controls: <https://platform.openai.com/docs/models/default-usage-policies-by-endpoint>
- `music-metadata` duration parsing: <https://www.npmjs.com/package/music-metadata>

## Definition of done

- Students can browse published standard and role-play stations using all approved filters.
- Standard attempts reveal and assess sub-questions one at a time; role-play is one recorded response.
- Recording works on supported web/iOS/Android targets, with an accessible typed fallback.
- The reviewed transcript is the only answer artifact sent to scoring and the only student-answer artifact persisted.
- Feedback is immediate, rubric-driven, strictly validated, and shown only for applicable dimensions.
- Successful prompts cannot be retried; technical failures can retry idempotently; forward progression is explicit.
- Final summaries are deterministic and appear in Progress without changing legacy practice.
- Hidden assessor content, provider prompts/errors, all credentials, and future prompts remain server-side.
- AI-key write-only tests, legacy practice tests, typecheck, 80%+ coverage, web export, integration tests, E2E, audit review, and manual device matrix all pass.
- Phase 5 MMI Circuit and Phase 6 Tutor remain deferred.
- No remote change, commit, push, or deployment occurs without explicit permission.
