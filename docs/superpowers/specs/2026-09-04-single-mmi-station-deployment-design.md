# Single MMI Station Deployment Design

**Date:** 4 September 2026

**Status:** Approved in chat; awaiting written-spec review

**Replaces:** The previous allowlist and approval-gated scoring designs

## Decision

Interview Station will have one MMI practice experience for every invited,
signed-in user. There is no candidate release flag, founder-only lane,
cofounder allowlist, human approval gate, or separate review mode.

The product presents the question bank directly through the real 11-minute
station. The AI grades completed responses using a built-in, versioned scoring
contract. A separate person does not have to approve scoring criteria before a
user can start, finish, or score a station.

## User experience

The Practice screen presents one option named **11-minute MMI station**.
User-visible copy must not describe the station as candidate-only, founder
review, internal review, or approval-pending.

Each station follows one fixed schedule:

1. A 60-second preparation phase displays only the station scenario. It does
   not display the first question, an answer box, scoring guidance, model
   answers, or assessment criteria.
2. Five response phases follow in order. Each response phase lasts 120
   seconds and displays one question.
3. During a response phase, the user may answer with microphone transcription
   or typed text. Typed input remains available when speech recognition is
   unsupported, denied, interrupted, or deliberately not used.
4. When a deadline expires, the current response is finalized and the station
   advances automatically. Refreshing or reopening the app restores the
   server-owned phase and deadline rather than restarting time.
5. After the fifth response ends, the station moves to evaluation. No scores
   or coaching appear during the timed station.

Old links to the untimed response page must not expose a second practice
experience. They redirect into the single 11-minute station entry flow while
preserving authentication and ownership checks.

## Access model

Access is controlled only by the app's existing invitation and authentication
rules:

- a signed-out visitor cannot start or read a station;
- an invited, signed-in user can start a station;
- a user can read and modify only their own active session and results; and
- administrative question-management permissions remain separate from
  practice access.

There is no product configuration value that enables or disables the station,
and there is no account list that grants a different MMI experience to
founders or cofounders.

Vercel deployment protection and Supabase authentication remain infrastructure
and account security controls. They are not product release flags.

## Question content

The existing 155 stations and 775 prompts are the single question source.
Question publication state still controls whether content is eligible for
selection. The runtime projection exposes only the scenario and the current
question; it never exposes private scoring instructions, future questions, or
model answers.

Question availability does not depend on rows in a review table. No reviewer
identity, attestation, approval spreadsheet, or per-prompt activation is
required.

## AI evaluation

The AI is the assessor. Evaluation begins after the complete timed station,
using the five finalized response transcripts, their questions and scenarios,
and one built-in versioned scoring contract.

The scoring contract defines the dimensions and the strict response schema.
It is application configuration shipped and tested with the scorer, not a
placeholder and not a human approval artifact. The current dimensions remain:

- structure;
- ethics;
- communication;
- reflection; and
- NHS awareness.

The server, not the browser, obtains the saved station content and transcripts
and calls the configured AI provider. The client cannot submit its own scores,
criteria, provider instructions, or hidden answer material.

The provider response must pass the existing strict schema and range checks
before any result is stored or shown. The application must never manufacture
fallback numbers, copy a canned assessment, or treat an invalid provider
response as a real score.

The deployed Supabase environment must include working AI-provider
configuration. Successful hosted AI scoring is part of the acceptance test,
not a later human-gated task.

## Scoring failure behavior

A provider timeout, invalid response, missing secret, or temporary outage is a
technical failure—not evidence that somebody has not approved something.

When scoring cannot complete:

- the completed station and five finalized transcripts remain saved;
- the results screen says that scoring could not complete and offers a retry;
- no numeric score, chart, or written assessment is shown as if it were real;
- retrying uses the same finalized responses and cannot change station timing;
  and
- server logs record a safe error stage without transcripts, prompts, provider
  bodies, credentials, or other sensitive text.

The user is never sent back through the timed station because the scorer had a
temporary problem.

## Speech, transcript, and privacy behavior

The setup screen clearly states that microphone speech is transcribed for AI
evaluation, the browser or operating system may use its speech-recognition
provider, transcript text is saved for station recovery and scoring, and this
application does not record or store raw audio.

Starting a session requires the user to acknowledge that disclosure. This is
one product disclosure for every user; it is not an approved-notice gate or a
separate founder/candidate policy.

The app stores only transcript text and typed text. It must not create audio
files, upload audio blobs, place transcript text in URLs or analytics, or log
answer content. Existing private retention and deletion behavior continues to
apply to saved transcript text.

Webcam capture is outside this change and remains a later feature.

## Removal of the old split

Implementation removes the active `normalized_mmi_station_enabled` contract
from both sides of the system:

- remove client reads, redirects, and Practice-screen branches based on the
  flag;
- replace current Supabase RPC definitions so they do not check the flag;
- remove the live configuration row in a forward-only migration;
- remove candidate/founder/review access modes and allowlist proposals;
- remove the runtime dependency on `mmi_scoring_rubrics` and review
  provenance; and
- rename user-visible labels to neutral MMI station language.

Historical migration files remain unchanged as an audit trail. A new forward
migration removes their current effect. The obsolete flag must not be renamed
or replaced by another switch.

Internal source modules may be renamed from candidate-specific terminology to
neutral station terminology where doing so prevents two active contracts.
Database objects that are costly to rename may retain historical names only if
their behavior is single-flow and no user-visible or operational split remains.

## Deployment contract

Work is not considered available for review merely because it exists in a
local worktree or Git branch.

Every reviewable change must be:

1. committed and verified at an exact Git SHA;
2. pushed to the feature branch;
3. deployed to a protected Vercel Preview;
4. connected only to the isolated Supabase preview project;
5. migrated and configured in that same isolated Supabase project;
6. smoke-tested through an invited authenticated account; and
7. handed to the user as a working URL with the deployed SHA recorded.

The shared Supabase project is not modified by this preview workflow. Promotion
to a stable or public alias is a separate deliberate deployment action.

## Verification

Automated tests must prove:

- the Practice screen exposes the 11-minute station without a release flag;
- old untimed-session links cannot expose a competing flow;
- preparation lasts 60 seconds and displays no question or answer controls;
- exactly five 120-second response phases follow;
- typed input works independently of microphone support;
- microphone allow, deny, interruption, and restart preserve typed fallback;
- refresh and resume use server deadlines and do not grant extra time;
- each deadline finalizes at most one response and advances once;
- evaluation does not start before all five responses are finalized;
- the AI receives server-owned content and returns schema-validated results;
- invalid or failed AI output never becomes a displayed score;
- a completed station can retry scoring without rerunning the station;
- raw audio is never persisted; and
- one user cannot access another user's session, transcript, or result.

Hosted verification must additionally prove:

- the exact Vercel deployment uses the isolated Supabase project;
- an invited account completes the full schedule;
- both microphone transcription and typed fallback reach evaluation;
- a real provider response produces and persists a valid result;
- refresh/resume works during an active hosted station; and
- the deployed client and current RPCs contain no candidate release gate.

## Acceptance criteria

This design is complete when an invited user can open the supplied Vercel URL,
sign in, choose **11-minute MMI station**, see a one-minute scenario-only brief,
answer five two-minute questions, and receive real AI-generated feedback after
the station.

No reviewer action, founder designation, feature flag, approval spreadsheet,
or placeholder scoring data may be required anywhere in that path. If the AI
provider fails, the user sees an honest retryable technical error and never a
fabricated assessment.
