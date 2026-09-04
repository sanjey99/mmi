# Pre-Closed-Round Deployment

This is the deployment and QA runbook for moving the single MMI station from local verification to a hosted, invitation-only review. It follows the product contract in [Before Cofounder Viewing](./BEFORE-COFOUNDER-VIEWING.md).

## Fixed targets

- Git branch: `feat/cofounder-ui-reliability`
- Frontend: protected Vercel Preview built from an exact commit SHA
- Backend: isolated Supabase project `obfwfoykalvoxqdnosus` (`mmi-cofounder-preview`)
- Forbidden target: shared Supabase project `tliwifhnsytxpcynuwsy`
- Access: invited, signed-in accounts only; public signup remains disabled

Reviewable work is deployed to Vercel and isolated Supabase unless the product owner explicitly says otherwise.

## Release behavior

- One 11-minute station: 60 seconds of `mmi_stations.scenario_text`, then five 120-second `mmi_sub_questions.question_text` records ordered by `order_num`.
- Browser speech transcription is optional and editable; typing is the fallback.
- Transcript text is stored privately for recovery and scoring. Raw audio is not stored by the app.
- Server timing controls every transition and hides future questions.
- AI scoring starts only after the full station completes.
- The scoring function loads the finalized prompt/transcript and versioned scoring criteria from server-owned code/state.
- Provider or validation failure preserves completion and exposes retry without fabricating a score.
- Camera/webcam behavior is outside this release.

## Deployment sequence

### 1. Prepare and verify the exact Git revision

- [ ] Fetch current `origin/main` and integrate it without discarding unrelated local work.
- [ ] Run unit, integration, Edge-handler, type, build, and relevant browser tests.
- [ ] Run dependency/security checks and inspect the final diff for secrets or unintended files.
- [ ] Record `git rev-parse HEAD` as the release SHA.
- [ ] Push `feat/cofounder-ui-reliability` and create or update its pull request.

### 2. Deploy the isolated Supabase backend

- [ ] Confirm the CLI target is exactly `obfwfoykalvoxqdnosus` before any write.
- [ ] Compare local and remote migration history.
- [ ] Dry-run the pending database migration.
- [ ] Apply `20260904000000_single_mmi_station.sql` forward-only.
- [ ] Verify exactly 155 published stations, 775 ordered questions, and five questions per station.
- [ ] Verify `scenario_text` is the station brief and `question_text` is the ordered response question.
- [ ] Verify all station RPCs require authentication and enforce session ownership.
- [ ] Verify transcript tables remain private and raw-audio storage objects do not exist.
- [ ] Deploy `score-candidate-mmi-response` with JWT verification to this project.
- [ ] Confirm server-only provider/model/key configuration exists without printing secret values.
- [ ] Request one completed response score and verify a real schema-valid assessment is persisted and returned.

### 3. Deploy the exact Vercel Preview

- [ ] Set Preview-only `EXPO_PUBLIC_SUPABASE_URL` to the isolated project URL.
- [ ] Set Preview-only `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the isolated project's public anon key.
- [ ] Never place a service-role key or AI provider key in Vercel public variables.
- [ ] Build and deploy the recorded Git SHA.
- [ ] Record the protected Preview URL and deployment ID.
- [ ] Confirm the deployment reports the same Git SHA used for verification.

### 4. Hosted smoke test

- [ ] Sign in with an invited test account; public signup remains unavailable.
- [ ] Start a station and confirm the 60-second brief has no response control.
- [ ] Complete Q1–Q5 in order, each with a visible 120-second timer.
- [ ] Confirm browser speech writes only transcript text and manual typing remains usable.
- [ ] Refresh during a timed phase and confirm the server-owned session resumes safely.
- [ ] Confirm the completed screen begins AI evaluation only after Q5 closes.
- [ ] Confirm all five feedback records remain in station order.
- [ ] Cause or simulate a scoring failure, confirm no fake score appears, then use **Retry AI scoring** successfully.
- [ ] Sign out and confirm another account cannot restore or read the prior session.

### 5. Manual device, accessibility, and privacy QA

Record tester, date, device/OS, browser/version, result, and issue link for each row.

| Check | Required evidence | Status |
| --- | --- | --- |
| Microphone allowed | Permission prompt, live transcript, editable text | Pending |
| Microphone denied | Typing remains available; station continues | Pending |
| Unsupported browser speech | Clear fallback message and usable typing | Pending |
| Speech interruption/restart | Committed words preserved | Pending |
| Refresh/resume | Same session and trusted remaining time | Pending |
| All deadline transitions | Brief, Q1–Q5, then completion in order | Pending |
| Keyboard only | Every control reachable with visible focus | Pending |
| Screen reader | Prompt, timer status, errors, and controls announced meaningfully | Pending |
| Mobile keyboard/viewport | Timer, prompt, transcript, and actions remain visible/usable | Pending |
| Reduced motion | No required information depends on motion | Pending |
| Sensitive-data inspection | No raw audio, secrets, transcripts, or provider payloads in public logs/URLs/analytics | Pending |

These rows remain pending until someone performs them on real browsers/devices. Automated coverage supports them but does not replace them.

### 6. Review decision

- [ ] All automated and manual evidence points to the same Git SHA, Vercel deployment, and Supabase project.
- [ ] No unresolved severity-1 or severity-2 issue remains in the station, authentication, privacy, or scoring path.
- [ ] Cofounder completes the hosted review and records signoff.

## Rollback and failure behavior

- If the frontend is unsuitable, restore the last known-good protected Vercel deployment.
- Database changes are forward-only; do not delete stations, prompts, transcripts, or migration-history rows as an improvised rollback.
- If AI scoring is unavailable, keep completed sessions intact, show the retry state, and repair the server-side provider configuration.
- Never redirect the preview to the shared Supabase project.
- Do not claim successful scoring unless a schema-valid hosted assessment was actually returned.

## Evidence record

Fill this in during deployment:

- Release SHA:
- Pull request:
- Supabase project: `obfwfoykalvoxqdnosus`
- Applied migration versions:
- Edge function version:
- Vercel Preview URL:
- Vercel deployment ID:
- Hosted smoke tester/date:
- Manual QA evidence:
- Cofounder decision/date:
