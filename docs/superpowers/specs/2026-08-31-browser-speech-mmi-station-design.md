# Browser Speech MMI Station Design

**Date:** 2026-08-31

**Status:** Approved in conversation; awaiting written-spec review

## Objective

Complete the existing server-timed 11-minute candidate MMI station with free browser speech recognition, an editable transcript, a universal manual fallback, deadline-safe transcript persistence, and transcript-only feedback.

The station remains one 60-second preparation phase followed by five 120-second response phases. It stores no audio and never uses a camera.

## Success Criteria

- The microphone is inactive during the preparation phase.
- Each response phase starts browser speech recognition when the browser supports it and the user has granted permission.
- Final recognition fragments appear in an editable transcript while the response window is open.
- Recognition restarts after an unexpected `end` event only while the same response remains active.
- Unsupported, denied, or unavailable recognition never blocks the station; typing and operating-system dictation remain available without penalty.
- The transcript freezes at the server-authoritative deadline and cannot be changed afterward.
- A refresh restores only the authenticated user's current in-progress transcript and current safe station projection.
- Finalization and scoring retries are idempotent and cannot create duplicate logical responses or duplicate score claims.
- Feedback evaluates transcript content only. It never evaluates or implies conclusions about accent, tone, pace, hesitation, confidence, fluency, appearance, or nonverbal behavior.
- The application never records, uploads, persists, or serves audio.

## Non-Goals

- Camera preview, video recording, video storage, or visual assessment.
- Audio recording with `MediaRecorder`, audio blobs, upload endpoints, Storage buckets, or retained microphone artifacts.
- Guaranteed automatic recognition in every browser. Browsers without a usable Speech Recognition API receive the manual transcript and operating-system dictation fallback.
- Offline model downloads, Whisper, Vosk, Sherpa, Google Cloud Speech-to-Text, or another paid speech API.
- Modifying the legacy written-practice `score-answer` contract or persistence model.
- Scoring delivery characteristics or inferring protected, clinical, or personality traits from speech.

## Product Experience

### Entry and disclosure

Before the timer starts, the station explains that:

- speech recognition is optional assistance for producing text;
- supported browsers may send microphone input to their browser or platform speech service;
- InterviewStation receives transcript text but does not record or store audio;
- typing or operating-system dictation can be used instead;
- the transcript can be edited only during the active two-minute response window; and
- feedback is based only on the finalized transcript.

The user explicitly starts the station. Permission prompts must be caused by that user gesture rather than page load.

Before starting the timer, the entry screen offers an explicit “Enable speech recognition” action. It starts and stops a preflight recognition session, discards all preflight results, and records only a safe supported/denied/unavailable status. The timed station starts after preflight succeeds or the user deliberately selects manual transcript mode. If a browser later refuses an automatic restart without another user gesture, the response remains editable and presents a “Resume microphone” action without pausing or extending the server timer.

### Preparation phase

The prompt is visible for 60 seconds. Speech recognition is stopped and the transcript editor is unavailable. The user may leave or abandon the station through the existing confirmation flow.

### Response phase

At the server-authorized response boundary:

1. The UI creates a response identity from the session ID and prompt order.
2. The transcript editor becomes available.
3. The browser speech port starts recognition when supported.
4. Interim text may be displayed separately as provisional text; only final recognition fragments enter the editable draft.
5. Manual edits always take precedence over previously recognized text.
6. Final browser fragments received after an edit append deterministically without overwriting user changes.
7. The UI checkpoints bounded canonical transcript text while the response window remains open.

If recognition ends unexpectedly, the port restarts it only when all of the following remain true:

- the response identity has not changed;
- the server projection still reports an active response;
- the deadline has not passed;
- the feature flag remains enabled;
- the user has not left or abandoned; and
- the previous end was not caused by an explicit stop or fatal permission error.

### Deadline and transition

At zero remaining seconds, the runner stops recognition exactly once, freezes the editor, flushes the last eligible checkpoint, and requests finalization. The finalized request contains a session ID, prompt order, and idempotency key; it does not contain new transcript text.

If no valid transcript was checkpointed, finalization creates one immutable `no_response` outcome rather than a scoreable response. This outcome advances the station, does not call the scoring provider, and is presented as an unanswered prompt rather than a low assessment.

A bounded transport grace permits retrying finalization after the deadline, but it never permits checkpointing changed text after the deadline. The next prompt is not revealed from an unpersisted client draft. If finalization temporarily fails, the UI remains in a read-only “Saving response” state and offers a safe retry.

After finalization succeeds, scoring begins without delaying the next timed prompt. At station completion, the feedback view shows completed results and fixed safe statuses for any response still processing or retryable.

## Client Architecture

### Speech recognition port

Add a browser-only speech port behind the existing candidate media boundary. The port detects `window.SpeechRecognition` first and `window.webkitSpeechRecognition` second. An unsupported environment returns an explicit capability result rather than throwing.

The port exposes a small lifecycle:

- `start(responseIdentity, callbacks)` starts recognition for one active response;
- `stop(responseIdentity)` deliberately stops the matching response;
- `abort()` terminates recognition and invalidates all outstanding callbacks; and
- `getCapability()` reports supported, unsupported, or unavailable.

The implementation uses continuous and interim results where available, but correctness never depends on either property. It tolerates browsers that end recognition sessions early by using the guarded restart rules above.

The port emits only normalized final text fragments and safe status codes. It does not expose confidence, alternatives, raw error payloads, microphone metadata, or audio.

### Transcript composition

The screen owns the editable draft. Recognized final fragments are appended through a pure transcript-composition function so tests can prove that browser event ordering does not erase manual changes or duplicate fragments.

Interim recognition text is presentation-only. It is never checkpointed, finalized, or scored. Empty or punctuation-only finalized transcripts do not become valid answers.

### Runner integration

The candidate runner continues to treat the server station projection as the source of truth for phase, prompt order, and deadline. It adds explicit states for checkpointing, finalizing, and save retry. A stale timer, recognition event, checkpoint response, or finalize response is ignored when its response identity no longer matches the current projection.

Feature disable, sign-out, leave, abandon, unmount, or completion invokes `abort()` and prevents automatic recognition restart.

## Server Persistence

Create a new forward-only migration rather than editing the committed station migration.

### Private transcript draft

A private draft record is unique per candidate session and prompt order. It contains canonical transcript text, owner identity derived from the authenticated session, server timestamps, and the last accepted digest. Direct browser table access is revoked.

`checkpoint_candidate_mmi_transcript(session_id, prompt_order, transcript)`:

- derives the user from the authenticated request;
- verifies session ownership and feature availability;
- locks or otherwise serializes the current station state;
- verifies that the requested prompt is the current response prompt;
- verifies that the server deadline has not passed;
- canonicalizes and bounds the transcript;
- applies a bounded checkpoint rate limit; and
- upserts the caller's private current draft.

It rejects future prompts, prior prompts, abandoned sessions, disabled sessions, other users, expired writes, oversized text, unsafe Unicode/control content, and unexpected input fields.

### Immutable finalized response

A finalized response is unique per candidate session and prompt order. It contains the frozen transcript, transcript digest, prompt/rubric/scoring-contract identity, finalization timestamps, and an idempotency identity.

`finalize_candidate_mmi_transcript(session_id, prompt_order, idempotency_key)`:

- accepts no transcript input;
- derives the caller and server timing state;
- copies only the last accepted pre-deadline draft;
- creates one immutable logical response or `no_response` outcome;
- returns the existing result for a repeated matching idempotency request; and
- rejects conflicting reuse, unauthorized access, and invalid phase transitions.

The safe station projection may return only the caller's current draft, current finalized status, and fixed public feedback status. It never returns future prompts, private rubric instructions, provider output, other users' data, or raw errors.

## Transcript-Only Scoring

Add a candidate-specific authenticated scoring function. Do not modify or reuse the legacy `score-answer` endpoint because its input, ownership, rubric, and persistence semantics differ.

The function claims one server-owned finalized response, reads its immutable prompt/rubric/contract snapshot, and invokes the project's existing configured text-scoring provider. The client cannot supply the transcript, prompt, rubric, provider instructions, score, or ownership identity to this function.

Each scoreable prompt must reference an explicitly approved rubric snapshot before the feature can expose automatic feedback. The implementation does not synthesize a generic rubric at runtime. A prompt without an approved rubric finalizes normally but receives the fixed `feedback_unavailable` status and makes no provider call. This keeps the speech workflow independently releasable while preventing unreviewed assessment behavior.

Scoring is independently idempotent per finalized response. A lease prevents concurrent duplicate provider calls. Success persists a validated public result; retryable failure releases or expires the lease safely; permanent failure stores only a fixed safe status. Provider responses are parsed through a dedicated versioned candidate transcript contract before any result is persisted or shown.

The public scoring contract explicitly prohibits evaluating delivery, voice, fluency, accent, tone, hesitation, confidence, or nonverbal behavior. Evidence references must resolve to the finalized transcript.

Browser speech recognition itself adds no project API charge. The existing configured text-scoring provider retains its existing cost and operational requirements.

## Error and Recovery Model

Safe client recognition statuses are:

- `idle`
- `listening`
- `restarting`
- `unsupported`
- `permission_denied`
- `unavailable`

Recognition errors never delete transcript text, assign a low score, or prevent manual entry. Unsupported and unavailable states explain how to type or use the operating system's dictation control. Permission denial is recoverable through browser settings but does not trigger repeated permission prompts.

Checkpoint errors retain the local draft and visibly report that recovery is pending. Finalization errors freeze the draft and allow idempotent retry without reopening recognition. Scoring errors do not block later prompts and expose only fixed retryable, processing, unavailable, or complete states.

Refresh recovery uses the server projection. Recognition restarts only when the restored projection still represents an active response. A restored finalized or expired response is read-only.

## Security and Privacy

- No `MediaRecorder`, audio blobs, audio upload, Storage bucket, camera, or media URL is introduced.
- Speech recognition starts only after explicit user action and only during response phases.
- The disclosure does not claim all processing is on-device. A supported browser may use its platform recognition service.
- Server authorization derives identity from the authenticated request and never trusts client user IDs.
- Transcript writes are current-prompt, ownership, deadline, size, rate, and exact-shape validated.
- Draft and final tables deny direct browser writes; fixed-path security-definer functions own state transitions.
- Error responses use a fixed safe allowlist and do not expose provider, database, rubric, or internal timing details.
- The feature remains behind the existing fail-closed station flag and preserves the existing kill switch.

## Testing Strategy

### Unit tests

- Detect unprefixed, prefixed, and unsupported recognition constructors.
- Start only for an active response and stop exactly once at its end.
- Restart after an unexpected end only while the same response remains active.
- Never restart after deliberate stop, permission denial, leave, disable, or identity change.
- Merge final fragments deterministically without erasing manual edits.
- Keep interim text out of checkpoints and finalized transcripts.
- Preserve text through no-speech, network, unavailable, and audio-capture errors.
- Prove no production import or call uses `MediaRecorder`, camera, Storage, or an audio upload path.

### Runner and API tests

- Checkpoint only the current response and ignore stale completions.
- Finalize once per response identity and retry with the same idempotency key.
- Hold a read-only saving state until persistence succeeds.
- Restore only the current owned draft after refresh.
- Reject malformed safe projections, future prompt data, private rubric fields, and raw provider fields.

### Disposable local integration tests

- Reject direct table access and other-user access.
- Reject preparation, future, prior, expired, abandoned, and disabled transcript writes.
- Accept a pre-deadline checkpoint and finalize it after the deadline without accepting new post-deadline text.
- Prove unique response, digest, idempotency, lease, and scoring-claim constraints.
- Prove duplicate retries return one logical result while conflicting retries fail closed.
- Prove scoring reads only server-owned finalized content and cannot reveal a future prompt.
- Finalize empty or punctuation-only drafts as one idempotent `no_response` outcome without a provider claim.
- Refuse automatic feedback for a prompt without an approved rubric snapshot.

### Browser E2E tests

Use an injected fake recognition constructor; automated tests never request a real microphone.

- Supported recognition with live final and interim results.
- Explicit permission preflight and a later user-gesture resume path.
- Early-end automatic restart.
- Unsupported manual fallback.
- Permission-denied manual fallback.
- Manual edit followed by a later recognized fragment.
- Deadline freeze, finalization retry, and next-prompt transition.
- Refresh restoration of only the current draft.
- Feature disable and leave cleanup.
- No media upload, Storage, or camera network path.

## Release and Rollback

The feature remains disabled by default until local verification and hosted gates pass. Enabling it requires the existing deployment approval process and a named-account hosted smoke.

Release evidence must cover:

- the full 60 + 5 × 120 second schedule;
- desktop Chrome automatic recognition;
- Safari behavior or manual fallback;
- Firefox manual/operating-system dictation fallback;
- mobile keyboard/dictation fallback;
- permission denial and recovery guidance;
- refresh, deadline, retry, and abandonment behavior;
- one successful finalized transcript and candidate feedback result;
- ordinary-user authorization denial;
- feature-flag disable behavior; and
- restoration of the preserved hardened-compatible rollback deployment.

Rollback first disables the fail-closed station flag. The legacy written-practice route remains available. Database changes are forward-only and additive so disabled application code does not depend on destructive rollback.

## Expected Code Surface

Existing files likely modified during implementation:

- `app/practice/mmi-station.tsx`
- `src/features/candidateMmi/types.ts`
- `src/features/candidateMmi/mediaPort.ts`
- `src/features/candidateMmi/runner.ts`
- `src/features/candidateMmi/api.ts`
- `tests/candidateMmiApi.test.ts`
- `tests/mmiCandidateSchedule.test.ts`
- `tests/candidateMmiUiContract.test.ts`
- `tests/integration/candidateMmiStation.integration.test.ts`
- `e2e/cofounder-preview.spec.ts`
- `docs/BEFORE-COFOUNDER-VIEWING.md`

Expected additions:

- a browser-only speech recognition port and its unit tests;
- a forward-only candidate transcript/response/scoring migration and disposable-local integration tests;
- an authenticated candidate response scoring Edge function;
- dedicated versioned candidate transcript scoring contract/parser tests; and
- release-runbook evidence for the supported and fallback browser paths.

Before any existing symbol is edited, implementation must run fresh upstream GitNexus impact analysis and report HIGH or CRITICAL blast radius. Before commit, implementation must run GitNexus change detection and the repository's full verification suite.
