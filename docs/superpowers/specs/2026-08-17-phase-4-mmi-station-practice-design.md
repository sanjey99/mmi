# Phase 4 MMI Station Practice Design

## Status

Approved by the user for implementation planning. Implementation and production release remain gated by the schema/content audit, clinician-reviewed rubrics/evals, privacy-retention decision, verification, and explicit permission for remote changes.

## Goal

Replace the Questions tab's placeholder with a student-facing MMI station library that supports filtered discovery, spoken answers, transcript review, rubric-driven AI assessment, immediate feedback after every sub-question, and a final station summary.

Phase 4 covers one station at a time. Phase 5 MMI Circuit remains deferred, and Tutor remains “coming soon.”

## Product Decisions

- `mmi_stations` and their ordered `mmi_sub_questions` are the canonical source for standard MMI practice.
- `roleplay_stations` is a distinct station type in the same library.
- The legacy `questions` table remains the source for simple free practice. Phase 4 does not migrate or merge it with the MMI tables.
- Students answer by voice, review the transcript, and submit the reviewed transcript for assessment.
- Raw audio is not persisted by default. The reviewed transcript and assessment are persisted.
- Transcript-based assessment does not claim to measure vocal pace, tone, confidence, hesitation, or prosody.
- Every sub-question receives immediate feedback.
- Feedback offers one forward action to the next ordered prompt; there is no retry or resubmission within the attempt.
- After the last prompt, students receive a station summary with aggregate results and links to each prompt's feedback.
- The AI API key remains write-only to all clients. Transcription and scoring occur behind authenticated Edge Functions.

## Scope

### Included

- Browse published standard MMI and role-play stations.
- Filter by station type, category/topic, university tag, difficulty, and text.
- View a student-safe station preview.
- Run a preparation timer using `prep_time_sec`.
- Present standard-station prompts in `order_num` order.
- Run each prompt's `time_limit_sec` timer.
- Capture a spoken response, transcribe it server-side, and allow transcript correction before submission.
- Grade each reviewed transcript against a global UK MMI assessment contract plus station-specific context.
- Show immediate prompt feedback and advance to the next prompt.
- Show and persist a final station summary.
- Include a single-turn role-play practice flow based on the station brief and opening line.

### Excluded

- Multi-station timed circuits.
- Live, multi-turn AI role-play actors.
- Tutor booking or marketplace behavior.
- Persisted raw voice recordings or vocal-delivery scoring.
- Replacing the legacy free-practice flow.
- Re-importing the original Excel workbook.
- Exposing cached model answers, actor-only instructions, AI prompts, or API keys to clients.
- Treating generated model answers as the sole rubric or medical ground truth.

## Existing Content Model

```text
mmi_stations.station_id
  └── mmi_sub_questions.station_id (ON DELETE CASCADE)
        ├── order_num
        ├── question_text
        ├── time_limit_sec
        └── model_answer_cached

roleplay_stations
  ├── actor_persona
  ├── background_info
  └── opening_line

questions
  └── independent legacy free-practice content
```

The implementation must not infer a relationship between `questions` and the MMI tables because the database declares none.

## Student Experience

### 1. Station Library

The Questions tab becomes an MMI station library. It displays published content only.

Each card shows student-safe metadata:

- Station type: standard or role-play.
- Category or topic.
- Difficulty.
- Relevant university tags.
- Preparation time.
- Number of sub-questions and estimated response time for standard stations.
- A short scenario/title preview that does not reveal assessor guidance.

Filters combine with AND semantics:

- Station type.
- Category/topic.
- University.
- Difficulty.
- Text search over student-facing title, topic, and scenario fields.

The screen provides loading, error, empty-bank, no-results, clear-filter, and pagination states. Search never covers `model_answer_cached`, actor-only background, or other assessor-only material.

### 2. Standard Station Attempt

```text
Select station
  → station briefing
  → preparation timer
  → ordered sub-question
  → record voice answer
  → receive transcript
  → review/edit transcript
  → submit once
  → immediate AI feedback
  → next sub-question
  → final station summary
```

The student cannot view future sub-questions before reaching them. Leaving an active attempt requires confirmation. A submitted sub-question cannot be retried within that attempt.

### 3. Role-Play Attempt

Phase 4 role-play is single-turn. The client displays only the approved student brief and opening line, captures one spoken response, and uses the same transcript-review and feedback contract.

`actor_persona` and `background_info` are treated as assessor-side by default and are fetched server-side for scoring. A later content audit may explicitly classify safe excerpts as student-facing. Live actor conversation is outside Phase 4.

### 4. Immediate Feedback

Feedback includes:

- Overall percentage for the submitted prompt.
- The applicable parts of the product's five-dimension score display; zero-weight dimensions appear as not applicable rather than receiving an invented score.
- Evidence-based strengths.
- Missing or weak medical, ethical, communication, or reflective points.
- One actionable improvement using an appropriate named framework.
- `Continue to next prompt` when another prompt remains.
- `View station summary` after the final prompt.

Feedback does not expose the model answer, internal rubric text, prompt instructions, or provider response.
Selecting `Continue to next prompt` clears the previous prompt's transient client state and activates the next prompt. It cannot return to, edit, or resubmit the completed prompt.

### 5. Station Summary

The summary shows:

- Station topic and type.
- Completion time.
- Average prompt score.
- Aggregate dimension scores calculated only from prompts where that dimension was applicable.
- A list of sub-questions with their score and a link to their saved feedback.
- Actions for `Next station`, `Return to station library`, and `View progress`.

The summary is derived deterministically from persisted prompt assessments; it does not require a second LLM call.

## Application Architecture

Phase 4 uses a dedicated MMI practice domain rather than extending the single-question Zustand state with conditional MMI behavior.

Proposed boundaries:

- `src/lib/mmiStations.ts`: typed, read-only station discovery and detail queries.
- `src/stores/mmiPracticeStore.ts`: active attempt state, current prompt index, transcript, assessment, and progression.
- New Expo Router screens for station detail, preparation, response, feedback, and summary.
- Shared existing UI components for buttons, timers, cards, score bars, radar charts, and visual feedback patterns.
- The legacy `practiceStore`, `/practice/session`, and `/practice/feedback` remain responsible for free practice.

The MMI store must expose explicit transitions rather than allowing screens to mutate arbitrary state:

```text
idle → preparing → recording → transcribing → reviewing
     → scoring → feedback → next_prompt | complete
```

Invalid transitions fail closed and return the student to the last persisted safe state.

## Persistence Model

The existing `answers.question_id` model is tied to the independent `questions` table and must not be overloaded for MMI content.

Phase 4 should add dedicated attempt records, conceptually:

- `mmi_attempts`: user, station identifier/type, lifecycle status, current prompt, timing, completion, aggregate score.
- `mmi_prompt_attempts`: attempt, sub-question or role-play identifier, reviewed transcript, submitted time, prompt score, structured feedback, prompt version.
- `mmi_scoring_rubrics`: versioned, clinician-reviewed criteria and dimension weights for a sub-question or role-play station.

Exact column names and constraints belong in the implementation plan after a fresh read-only schema check of existing attempt-related tables. Required invariants are:

- An attempt belongs to one authenticated user.
- A prompt attempt belongs to one station attempt.
- A standard prompt identifier must belong to the attempt's station.
- Only one submitted answer exists per prompt per attempt.
- A unique idempotency key identifies a logical submission and returns its original result when retried.
- Prompt order cannot move backward after submission.
- Completion requires every expected prompt exactly once.
- Aggregate station scores are derived from saved prompt scores.
- The attempt snapshots the content and rubric versions used for every assessment.
- Users can read and update only their own attempts through RLS.

All Phase 4 content, attempt, rubric, RLS, view, constraint, and index definitions must exist in checked-in migrations. The remote-only MMI tables are not treated as reproducible until their definitions are captured locally.

## Voice and Transcription Boundary

The client records audio only for the active prompt and sends it to an authenticated transcription Edge Function.

The transcription function must:

- Enforce accepted audio types, maximum bytes, and maximum duration.
- Authenticate the user before processing.
- Rate-limit by user.
- Send audio to a configured speech-to-text provider through a server-side adapter.
- Return text plus a provider-neutral confidence/warning signal when available.
- Avoid logging audio, transcript content, credentials, or provider payloads.
- Delete temporary audio immediately after processing and never persist it by default.
- Disclose the third-party transcription processor and transcript retention behavior before recording.

The student may edit the transcript before scoring. The saved answer is the reviewed transcript, not the raw transcription. Transcript editing is correction, not a second attempt.

The provider choice, supported audio formats, cost controls, and platform support must be resolved in the implementation plan; the client contract must remain provider-neutral.

## Rubric-Driven Scoring Boundary

The client submits only identifiers and the reviewed transcript:

```json
{
  "attemptId": "…",
  "stationId": "…",
  "subQuestionId": "…",
  "transcript": "…",
  "idempotencyKey": "…"
}
```

The scoring Edge Function authenticates the caller and verifies ownership, published status, the station-child relationship, the expected prompt sequence, and the idempotency key. It then fetches server-side:

- Station scenario and metadata.
- Current sub-question or role-play context.
- Optional `model_answer_cached` reference.
- The active clinician-reviewed rubric version and dimension weights.
- Global UK medical-school MMI assessment instructions.
- The versioned response schema and rubric rules.

`model_answer_cached` is optional supporting assessor context, not a rubric or unquestionable ground truth. The prompt instructs the model to evaluate valid alternative reasoning and never penalize wording differences alone. Missing or stale cached answers do not silently change the rubric.

The assessment prompt has two layers:

1. A versioned global contract defining the assessor role, five possible score dimensions, score bounds, required evidence, medical-safety rules, feedback style, and strict structured output.
2. A versioned, clinician-reviewed prompt rubric defining criteria, safety-critical omissions, and weights for the applicable dimensions.
3. Station-specific context describing the scenario, the exact prompt, and optional curated reference answer.

Dimension weights are non-negative and sum to one across applicable dimensions. A zero-weight dimension is returned as not applicable and is excluded from prompt and station aggregates. The server strictly rejects missing applicable scores, unexpected fields, non-finite values, or narrative content that does not cite answer evidence. It calculates `overall_pct` itself from validated weighted scores rather than trusting a provider-supplied percentage.

Successful submission and assessment persistence are idempotent. A duplicate idempotency key returns the original assessment. Provider errors, invalid output, or missing rubric context produce a retryable technical error without consuming the student's one pedagogical attempt or advancing the prompt.

The AI key remains readable only by service-role server code. No response, error, log, or client query may contain the key, model answer, hidden role-play context, or full internal prompt.

## Error Handling and Recovery

- Microphone denied: explain how to enable it; do not start the prompt timer until the student acknowledges the issue.
- Recording interrupted: allow recording the current unsubmitted prompt again.
- Timer expiry stops recording and continues to transcript review; it never skips the student's response or feedback.
- Transcription failure: preserve the local recording for an in-session retry, then discard it when the attempt is abandoned or completed.
- Transcript empty: block scoring and ask the student to record again or type a transcript.
- Scoring failure: retain the reviewed transcript and offer `Try scoring again`; do not create a duplicate prompt attempt.
- Connectivity loss: persist attempt position and submitted feedback server-side; restore the last incomplete prompt after reconnecting.
- Content changed mid-attempt: retain the station/prompt version captured when the attempt began.
- No published stations: show an honest empty state and keep free practice available.

## Security and Privacy

- All content and attempt tables have RLS enabled.
- Students may query published student-facing station fields only.
- Assessor-only fields are never selected directly by client code. Prefer a restricted view or RPC over relying on client discipline with `select('*')`.
- Direct authenticated access to assessor-bearing base tables is revoked where needed; student-safe views/RPCs expose only published fields.
- Attempt creation, prompt progression, and scoring verify authenticated ownership server-side.
- The service-role key and AI/transcription credentials remain Edge Function secrets.
- Raw audio is ephemeral and excluded from analytics, logs, crash reports, and backups.
- Transcript retention follows the existing answer-retention policy and is disclosed to students.
- User-controlled transcript and content fields are treated as untrusted prompt input and clearly delimited from system instructions.
- Custom provider URLs disable redirects, resolve and validate destinations against private/link-local networks, and never forward an AI key to an unvalidated host.
- Rate limits apply separately to transcription and scoring.
- Scoring rate limits count durable server-side submission events rather than client-created answer rows.
- Error responses are generic and never include provider bodies, stack traces, credentials, or hidden assessment context.

## Accessibility

- Voice is the primary input but not the only input: students may type or correct a transcript when microphone use is unavailable.
- Timers expose accessible text and do not rely on color alone.
- Recording state, remaining time, transcription progress, and scoring progress are announced to assistive technologies.
- Keyboard and screen-reader users can complete the entire station flow.
- Motion respects reduced-motion preferences.

## Testing Strategy

### Unit

- Station filters and query construction.
- Ordered-prompt progression and invalid state transitions.
- Aggregate score calculation.
- Transcript size/duration validation.
- Structured AI response validation and server-calculated percentage.
- Per-rubric weight validation and not-applicable dimension behavior.
- Idempotent submission replay.
- Student-safe response shaping that excludes assessor-only fields.

### Supabase Integration

- Students can read published student-safe station data but not drafts or assessor-only context.
- Administrators using student-facing APIs also cannot receive model answers or hidden role-play context.
- Attempts and prompt attempts are isolated by user through RLS.
- A sub-question from another station cannot be submitted to an attempt.
- A submitted prompt cannot be submitted twice.
- Replaying an idempotency key returns the saved result without another provider call.
- Scoring fetches hidden context server-side and never returns it.
- Invalid or missing rubric versions fail closed and do not advance the attempt.
- Prompt advancement occurs only after a persisted successful assessment.
- The AI key remains unreadable to administrators and non-administrators.

### Browser E2E

- Filter the MMI library by category, university, difficulty, station type, and text.
- Start a standard station, complete preparation, provide a mocked transcript, receive feedback, and advance through the sole forward action.
- Complete all prompts and verify the deterministic station summary and Progress entry.
- Recover from a scoring failure without duplicate persistence or prompt advancement.
- Verify timer expiry enters transcript review rather than skipping the prompt.
- Verify typed transcript fallback when microphone access is denied.
- Verify role-play single-turn flow without exposing actor-only context.

### Voice Device Testing

- Web microphone capture in supported desktop and mobile browsers.
- iOS and Android recording permission flows.
- Maximum-duration cutoff and interruption recovery.
- Ephemeral-audio deletion behavior.

## Acceptance Criteria

1. A student can discover published standard and role-play stations using every approved filter.
2. A standard station presents its sub-questions once, in database order, using database time limits.
3. A student can record, review, correct, and submit a transcript for each prompt.
4. Each successful submission produces rubric-driven feedback before the next prompt becomes active.
5. Feedback advances forward only; the completed prompt cannot be retried in the same attempt.
6. A scoring failure does not advance the prompt or duplicate the saved answer.
7. Retrying the same technical submission returns the original result without another AI call.
8. The final summary is computed from persisted prompt assessments without another LLM call.
9. Rubric weights determine applicable dimensions; irrelevant dimensions are not assigned artificial scores.
10. Role-play supports one recorded response and explicitly does not simulate a live actor.
11. Clients cannot read model answers, hidden role-play context, internal prompts, or any AI/transcription credential.
12. Raw audio is not retained after transcription or session abandonment.
13. Feedback makes no claims about tone, pace, confidence, or other vocal characteristics that were not assessed.
14. Free practice continues to work through the legacy `questions` flow.
15. MMI Circuit remains unavailable and Tutor remains “coming soon.”

## Implementation Preconditions

Before implementation planning:

- Use the read-only Supabase connector to inspect any existing attempt/session tables and relevant RLS policies.
- Inspect representative station, sub-question, and role-play rows to classify student-facing versus assessor-only fields.
- Confirm the speech-to-text provider, pricing constraints, maximum recording duration, and supported platforms.
- Define and clinician-review rubric criteria and dimension weights for the launch content; model answers alone are insufficient validation.
- Establish a clinician-reviewed evaluation set with expected scoring bands, safety-critical omissions, and valid alternative answers.
- Define content, rubric, and prompt versioning plus rollback behavior.
- Harden provider URL validation, redirect handling, output validation, and durable rate limiting before reusing the scorer for MMI submissions.
