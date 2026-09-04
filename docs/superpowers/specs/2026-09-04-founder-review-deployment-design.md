# Founder Review Deployment Design

**Date:** 2026-09-04
**Status:** Approved design; implementation pending
**Runtime:** Protected Vercel Preview plus isolated Supabase project
**Public candidate release:** Remains disabled

## Context

The 11-minute candidate MMI experience is implemented in
`app/practice/mmi-station.tsx`, but it is not available through the stable
`mmi-hazel.vercel.app` experience shown in the reported screenshots. The
screenshots use the legacy `/practice/session` route, which displays one
question and an immediate text box. The candidate route is exposed only when
the global `normalized_mmi_station_enabled` flag is true.

That global flag is also enforced by every candidate Supabase RPC. The
isolated preview correctly keeps it false because candidate-release gates are
unfinished: the approved candidate privacy notice is absent, clinician-reviewed
rubrics are `0/775`, and candidate scoring is not configured. Consequently,
the current architecture cannot let a founder inspect the real flow without
also turning on the candidate-release switch.

This conflates two different decisions:

1. whether named founders may review work in an isolated environment; and
2. whether the candidate feature is ready for candidate use.

The repair is to create a separate, account-scoped founder-review lane. It
must exercise the real Vercel client, Supabase timing, persistence, refresh,
and microphone-transcript flow without manufacturing privacy or clinical
approval and without exposing the feature to other authenticated users.

## User Decision

Active application work must be available through Vercel and an isolated
Supabase environment unless the user explicitly says otherwise. A task must
not be described as implemented or ready to view merely because it exists in
a local worktree or remote Git branch.

For deployable application work, the default completion evidence is:

- exact Git commit SHA;
- protected Vercel Preview deployment for that SHA;
- isolated Supabase project reference and applied migration/function version;
- proof that the Vercel Preview points to that isolated Supabase project;
- an authenticated smoke result for the changed flow; and
- a clear list of any behavior intentionally unavailable in review mode.

Documentation-only work may be committed without a runtime deployment, but it
must not be presented as a deployed product change.

## Goals

- Allow only explicitly authorized founder/cofounder accounts to open and run
  the real 11-minute station while the candidate release flag remains false.
- Preserve the exact 60-second read-only scenario followed by five ordered
  120-second response windows.
- Exercise browser speech-to-text, editable transcript fallback, checkpoint
  persistence, refresh/resume, deadline finalization, and completion UI.
- Keep microphone audio outside application storage. Store transcript text
  only after an explicit internal-review disclosure.
- Make missing clinician-reviewed rubrics and scoring configuration truthful:
  review sessions finish with scoring marked unavailable/pending rather than
  fake scores or placeholder rubrics.
- Deploy the exact implementation commit to a protected Vercel Preview wired
  only to isolated Supabase project `obfwfoykalvoxqdnosus`.
- Record the new preview-by-default development rule in both authoritative
  release runbooks.

## Non-goals

- Enabling `normalized_mmi_station_enabled` for candidate users.
- Promoting the work to the stable public Vercel alias.
- Creating placeholder candidate privacy approval, clinician identity,
  clinician-reviewed rubrics, or AI-provider configuration.
- Allowing founder-review access based only on a client environment variable,
  URL parameter, email string, or hidden navigation link.
- Relaxing normalized-content table RLS or granting browser roles direct table
  access.
- Adding camera, video, audio recording, or audio storage.
- Changing the 660-second station schedule or scoring rubrics.

## Considered Approaches

### 1. Account-scoped founder-review lane — chosen

Supabase derives an authenticated account's access mode. Candidate release
continues to use the global flag; founder review uses a separate service-owned
allowlist. Review sessions carry explicit internal-review provenance and are
ineligible for AI scoring.

This is the only approach that provides a real hosted flow without weakening
candidate controls or inventing approvals.

### 2. Turn on the global candidate flag — rejected

This would expose the chooser to every authenticated account in the preview.
Station start would still fail without an active privacy notice, and scoring
would remain incomplete without reviewed rubrics and provider configuration.
Adding placeholders to bypass those failures would create false governance
evidence.

### 3. Frontend-only demonstration — rejected

A static or mocked Vercel page could show the timer and microphone interface,
but it would not verify Supabase authorization, persistence, refresh/resume,
deadline finalization, or cleanup. It also conflicts with the requirement that
active product work run on both Vercel and Supabase.

## Access Model

### Access modes

The server defines exactly three modes:

- `disabled`: neither candidate release nor founder review is available;
- `founder_review`: the caller is present in the active founder-review
  allowlist while the candidate flag remains false; and
- `candidate`: the global candidate flag is true and release preconditions are
  satisfied.

Supabase is authoritative. The client may display an access result but may not
construct or override one.

### Allowlist

Create `public.candidate_mmi_founder_reviewers` with:

- `user_id UUID PRIMARY KEY REFERENCES public.profiles(id)`;
- `granted_at TIMESTAMPTZ NOT NULL`;
- `expires_at TIMESTAMPTZ NOT NULL`;
- `revoked_at TIMESTAMPTZ NULL`; and
- `granted_by UUID NOT NULL REFERENCES public.profiles(id)`.

An active entry requires `revoked_at IS NULL` and `clock_timestamp() <
expires_at`. Use short-lived access with an explicit expiry rather than a
permanent role.

Enable RLS and grant no direct table privilege to `PUBLIC`, `anon`,
`authenticated`, or `service_role`. The migration owner retains access.
Allowlist changes occur only through an explicitly approved administrative
operation against the isolated project. Never infer an account email from a
local file path or source workbook.

### Access RPC

Create `public.get_candidate_mmi_access()` as an authenticated,
`SECURITY DEFINER` fixed-shape RPC with a fixed safe search path. It returns:

```json
{
  "mode": "disabled | founder_review | candidate",
  "reviewDisclosureVersion": "string | null",
  "reviewDisclosureText": "string | null",
  "scoringAvailable": false
}
```

Before candidate release, `scoringAvailable` is false for founder review. The
RPC reveals no allowlist rows, profile details, emails, expiry values, feature
configuration values, or release-gate internals.

The existing direct client read of `app_config` is replaced by this RPC. A
malformed response, request error, missing authentication, expired grant, or
revoked grant fails closed to `disabled`.

## Session Provenance

Extend `public.candidate_mmi_station_sessions` with:

- `access_mode TEXT NOT NULL` constrained to `candidate` or
  `founder_review`;
- `review_disclosure_version TEXT NULL`; and
- `review_disclosure_acknowledged_at TIMESTAMPTZ NULL`.

Enforce exactly one provenance branch:

- candidate session: `access_mode='candidate'`, approved
  `privacy_notice_version IS NOT NULL`, and both review-disclosure fields are
  null;
- founder-review session: `access_mode='founder_review'`,
  `privacy_notice_version IS NULL`, and both review-disclosure fields are
  non-null.

The internal-review disclosure is not inserted into
`mmi_privacy_notices` and is never labeled approved candidate privacy text.
Its version and exact text are pinned by the migration and returned through
the access RPC. It must state that:

- the environment is an internal product review;
- browser/platform speech services may process microphone audio;
- the application does not record or store audio;
- editable transcript text is stored in isolated Supabase for QA;
- AI scoring is disabled until clinical review is complete; and
- review transcript text is purged within 24 hours.

The start button must explicitly acknowledge this disclosure. A route visit,
microphone test, or hidden default cannot count as acknowledgment.

## Server Authorization

Introduce private SQL helpers that derive the current access mode and verify
session ownership plus matching mode. Revoke their execution from all runtime
roles; public RPCs call them under their fixed security-definer owner.

Replace repeated global-flag checks in these authenticated RPCs with the
central access/session check:

- `start_candidate_mmi_station_session()`;
- `get_candidate_mmi_station_session(UUID)`;
- `checkpoint_candidate_mmi_station_response(UUID, SMALLINT, TEXT, BIGINT)`;
- `finalize_candidate_mmi_station_response(UUID, SMALLINT, UUID)`;
- `get_candidate_mmi_station_feedback(UUID)`; and
- `abandon_candidate_mmi_station_session(UUID)`.

Starting a founder-review session requires:

1. an authenticated user;
2. an active, unexpired allowlist entry;
3. the candidate feature flag still false;
4. the exact current review-disclosure version supplied by the client;
5. explicit disclosure acknowledgment; and
6. a published normalized station with exactly five ordered prompts.

Starting a candidate session continues to require the global flag and an
approved active privacy notice. Strengthen candidate start to require active,
clinician-reviewed rubrics for all five selected prompts before creating the
session.

Every restored or mutated session is authorized against its stored
`access_mode`. Revoking a founder grant prevents new calls and new sessions;
it does not silently convert a founder-review session into a candidate
session.

## Scoring Behavior

Founder-review sessions must never call the AI provider, claim a scoring
lease, or create a scored assessment. Their prompt snapshots store null rubric
and scoring-contract snapshots even if partial rubrics later exist.

At each two-minute boundary, the client still freezes, checkpoints, and
finalizes the transcript so timing and persistence are real. It skips the Edge
scoring invocation when `accessMode === 'founder_review'`.

After minute 11, the completion screen shows all five response positions and
the explicit status:

> Scoring is pending clinician review. This founder-review session tested the
> station timing, microphone transcript, saving, and recovery only.

Candidate sessions retain per-response scoring initiation and end-of-station
feedback display. A separate product decision is required if scoring must
instead be one holistic assessment initiated only after all five responses.

## Transcript Retention

Update the purge function so founder-review free text does not depend on a
candidate privacy-notice join. For sessions with
`access_mode='founder_review'`:

- purge finalized transcript text 24 hours after finalization;
- purge draft transcript text 24 hours after last acceptance; and
- leave aggregate timing/status provenance intact.

Candidate-session retention continues to use the approved notice's fixed-day
policy. The existing hourly Cron remains the only operator. The migration
must prove the job is present exactly once and runtime roles cannot execute
the purge function.

## Client Behavior

### Practice chooser

The Practice screen calls `get_candidate_mmi_access()` after authentication.
It renders:

- only legacy modes for `disabled`;
- an `11-minute founder review` option for `founder_review`; and
- the candidate station option for `candidate`.

The founder option is visibly labeled internal review and cannot be confused
with candidate readiness.

### Setup and station

The founder-review setup screen includes the internal disclosure, microphone
preflight, and an acknowledgment control. The timer starts only after the
acknowledgment and start action succeeds on Supabase.

The station retains the existing behavior:

- 60-second scenario-only read phase;
- no answer field and no question during that phase;
- a visible server-anchored countdown;
- five sequential 120-second question/response phases;
- browser speech transcription when supported;
- editable typing/dictation fallback;
- checkpoint persistence and refresh/resume; and
- automatic freeze/finalize at every deadline.

Direct navigation to `/practice/mmi-station` repeats the access RPC and fails
closed. A URL parameter cannot enable founder mode.

## Vercel and Supabase Deployment Contract

### Supabase

- Apply the reviewed migration only to isolated project
  `obfwfoykalvoxqdnosus`.
- Never apply it to shared project `tliwifhnsytxpcynuwsy`.
- Keep `normalized_mmi_station_enabled=false`.
- Deploy the candidate scoring function only when its provider configuration
  and rubric dependencies are ready; it is not required for founder-review
  mode.
- Grant one short-lived founder-review entry only after resolving the exact
  invited profile and receiving action-time confirmation for any account
  invitation or email transmission.

### Vercel

- Build the exact committed branch SHA with locked dependencies.
- Preview-scoped `EXPO_PUBLIC_SUPABASE_URL` and anon key must target only the
  isolated project.
- Keep Vercel deployment protection and application authentication enabled.
- Do not promote or alias this build to the stable public URL.
- Record the deployment ID, exact SHA, isolated project reference, and smoke
  timestamp without logging secrets or personal data.

### Ongoing default

For subsequent active application work, push the reviewed branch and create
or refresh its protected Vercel Preview. Apply any required additive database
migration or Edge function to the branch's isolated Supabase environment in
the same work cycle. If a change cannot be safely deployed, report it as
`local only — not ready to view` and explain the blocker; never silently leave
it local.

## Error Handling

- Access RPC error or malformed response: show legacy modes and a safe
  `Founder review unavailable` notice.
- Expired/revoked access: stop new persistence and return to Practice without
  revealing allowlist state.
- Missing disclosure acknowledgment: reject start without creating a session.
- Candidate flag accidentally true during founder start: reject founder mode;
  do not silently switch modes.
- Missing candidate privacy/rubric readiness: reject candidate start before
  any session or snapshot insert.
- Checkpoint/network failure: retain the editable local transcript, display a
  retry state, and never claim it was saved.
- Scoring request in founder-review mode: reject safely at both client and
  database boundaries.
- Deployment target mismatch: abort before build promotion or hosted SQL.

## Testing Strategy

### Unit and contract tests

- Parse only the three exact access modes and reject extra/malformed fields.
- Fail closed on access read failure.
- Render founder review only for `founder_review`.
- Require acknowledgment before start.
- Preserve 60/120/120/120/120/120 timing and future-prompt hiding.
- Skip scoring calls in founder review and show the pending-clinician message
  only after completion.

### Database policy tests

- Assert table ownership, RLS, revokes, fixed search paths, exact signatures,
  and no dynamic SQL.
- Prove ordinary authenticated users cannot discover allowlist membership or
  start/restore/mutate founder sessions.
- Prove active, non-expired, non-revoked reviewers can run only their own
  founder-review sessions while the candidate flag is false.
- Prove candidate mode still fails while the flag is false.
- Prove candidate start fails without one approved notice and five reviewed
  rubrics.
- Prove founder-review prompt snapshots contain no rubric/contract snapshot
  and cannot be claimed for scoring.
- Prove review transcripts purge after 24 hours independently of candidate
  notice retention.

### Hosted verification

- Preflight the exact isolated project and migration history.
- Apply only the new additive migration and verify catalog/ACL postconditions.
- Confirm the global feature flag remains false.
- Confirm the allowlisted account sees the founder option while a control
  authenticated account does not.
- Run the complete station through its real 660-second schedule once.
- Check the brief contains only scenario text and no response input.
- Check all five deadlines, microphone permission allow/deny behavior,
  transcript persistence, refresh/resume, and completion state.
- Confirm no Edge scoring invocation or assessment row occurs.
- Confirm no audio or unexpected sensitive data is stored or transmitted by
  the application.

## Rollback

1. Revoke or expire the founder-review allowlist row immediately.
2. Keep the candidate flag false.
3. Redeploy the last verified protected Preview if the client is faulty.
4. Repair forward with an additive migration; do not delete review sessions or
   transcript records manually.
5. Let the retention job purge free text, then verify aggregate counts.

Rollback never promotes the legacy stable alias as evidence that the candidate
flow works.

## Acceptance Criteria

- A named authorized founder can open the protected Vercel Preview and see the
  founder-review station option while the candidate flag is false.
- A different authenticated account cannot see or access the founder route.
- The founder sees a 60-second brief containing scenario only, no question and
  no response box, with a visible countdown.
- Five 120-second response windows follow automatically, with only the current
  prompt visible.
- Microphone speech becomes editable transcript text when supported; audio is
  never stored by the application.
- Refresh/resume uses Supabase state and server time without resetting the
  station.
- Completion occurs at 660 seconds and truthfully reports that scoring awaits
  clinician-reviewed rubrics.
- Founder-review sessions cannot reach the AI scoring provider.
- Review transcript text is purged within 24 hours.
- The exact Git SHA is deployed to protected Vercel Preview and wired only to
  isolated Supabase.
- Both runbooks state that active application work is deployed to Vercel plus
  isolated Supabase by default unless the user explicitly opts out.
- The stable public alias and candidate release flag remain unchanged.
