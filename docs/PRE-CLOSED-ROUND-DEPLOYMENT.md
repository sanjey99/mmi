# Pre-Closed-Round Deployment

**Goal:** Evolve the approved cofounder preview into a sustainable, secure invite-only round of approximately 100 people without exposing unfinished MMI functionality or trusting client-owned scoring state.

**Entry condition:** Every release gate in [Before Cofounder Viewing](./BEFORE-COFOUNDER-VIEWING.md) is complete and evidenced.

## Current checkpoint — 25 August 2026

- The cofounder-preview implementation exists locally on `feat/cofounder-ui-reliability`; no hosted preview migration, Edge deployment, secret/configuration change, role change, or hosted application-row mutation has been performed.
- Local preview verification passes: 35 Node tests, 190 Vitest tests, both coverage systems exceed 80% for lines/branches/functions, TypeScript (including the Edge handler), production web export, and 2/2 fully intercepted Playwright journeys.
- Cross-account feedback restoration renders a privacy-minimal unavailable state without prior answer/feedback text; its complete partner journey passed 10/10 under three concurrent workers before the final 2/2 suite passed sequentially.
- Default test and coverage commands exclude all integration paths even when credential-shaped environment variables are present. The dedicated mutating command requires an explicit acknowledgement, an HTTP loopback Supabase URL, and local credentials, and otherwise fails before test collection.
- Account-switch isolation clears cached practice and profile data and epoch-binds every asynchronous session, restoration, scoring, progress, profile read/write, and auth-loading completion. The auth subscription returns synchronously and defers profile API calls outside auth-js's exclusive lock. The browser harness rejects non-local app hosts and every real Supabase project hostname.
- The final independent security re-review reports no Critical, High, or Medium cofounder-preview finding after the Edge, migration, account-profile isolation, and auth callback-lock remediations. Fresh local Edge-runtime evidence is complete; hosted execution remains approval-gated and a release blocker.
- The final independent static database review reports no blocking finding. Its only residual Low is optional function-body hash pinning against privileged out-of-band replacement; function signatures, uniqueness, owner, language, security-definer state, search path, and grants are already checked.
- The one-time Impeccable detector returned no findings and the `$un-vibecode` audit passes R01–R22. Mobile login Lighthouse scores 100 for accessibility and best practices.
- The read-only dependency audit reports 17 high, 9 moderate, and 1 low advisory, with no critical finding. The paths are concentrated in Expo/Metro/build tooling and require a supported compatibility review; force-fixing is prohibited.
- Expo SDK-55 patch versions are behind the current supported set, and `react-native-worklets` is ahead of Expo's expected version. Resolve this through a dedicated compatibility change with full regression testing.
- Hosted public signup is disabled and verified (`disable_signup=true`); email sign-in remains enabled, anonymous sign-ins remain disabled, and email confirmation remains enabled. The approximately 100-person round still requires an operational invite/allowlist workflow.
- The versioned migration chain applies cleanly from an empty disposable local database and its effective ACL/RLS state is verified, including canonical authenticated non-secret `app_config` access and minimal service-role column grants. The authenticated local Edge-runtime smoke passed every HTTP boundary and the expected safe provider-failure path.
- A fresh unlinked contract-level clone reproduced every observed hosted fact consumed by the scripts. Hosted-only reconciliation, additive migrations `000`/`010`/`020`, and revised cutover `040` passed without row-count changes. Effective service privilege on `questions`/`answers`/`scores`/`mock_sessions` moved from 16/44 checks to 0/44, while exact scoring RPC execution and minimal profile/config columns remained.
- The fresh hosted SELECT-only snapshot completed at `2026-08-25 05:59:23.339506 UTC` with catalog MD5 `0811d9d73c003ea1daba2efd2058c136`. It confirmed the staged legacy schema/policy/grant assumptions and absent preview objects; `migration_relation` and `cron_relation` were both `null`, so no conditional follow-up was required or run. No hosted mutation occurred.
- Hosted public-schema default ACLs are broad. The reconciliation removes current browser and service-role assessor access at table and column scope, but every future hosted object must receive an explicit ACL review; changing default ACLs is a separately approved hardening decision.
- The scoring Edge smoke was repeated after that service-role reduction: it returned safe `502 provider_failed`, persisted one failed claim/attempt, released the lease, and wrote no answer or score. No direct service privilege on the four legacy tables was required.
- The final unlinked runtime fixture created one local smoke user/admin/session, one failed claim, and one failed attempt; it persisted zero answers and scores, released the claim lease, stopped both disposable stacks with volumes preserved, and never contacted hosted Supabase.
- The preview SQL is split into a hosted-only reconciliation artifact, three additive migrations, and one final privilege cutover. The versioned chain was executed only on a fresh disposable local stack; none has been executed remotely.
- Terms and Privacy operational drafts exist, but controller identity, contact, legal bases, transfers, retention, and final wording require qualified review before the approximately 100-person round.

## Product boundary for the 100-person round

- Invite/allowlist enrollment only; no public account creation.
- Stable web deployment on Vercel; Supabase remains Auth/Postgres/Edge backend.
- Legacy free/timed practice is the default student experience until Phase 4 passes its own gates.
- Founder/system admin, content editor, and tester/student are separate roles.
- Content editors can manage questions but cannot change roles, AI credentials, providers, allowlists, retention, or deployments.
- Tutor, MMI Circuit, and unfinished Phase 4 station UI remain hidden.
- AI output is formative practice feedback, not clinical, admissions, or professional advice.

## Capacity assumptions to record before launch

Replace each planning bound with a measured/approved value before go-live:

- Invited accounts: approximately 100.
- Expected daily active users and peak concurrent users.
- Answers per active user per day.
- Average and p95 answer length.
- AI model cost per accepted answer and maximum monthly spend.
- Supabase database, Auth, Edge invocation, and egress quotas.
- Vercel bandwidth/function assumptions; this application uses static hosting, not Render.
- Support hours and target response time by severity.
- Data-retention volume, backup frequency, restore target, and deletion turnaround.
- Named incident commander, deployment owner, security owner, and rollback authority.

## Security and privacy gates

### Identity and roles

- [ ] Implement invite/allowlist enrollment and disable public signup.
- [ ] Configure production-grade custom SMTP; verify invite, confirmation, password reset, expiry, and abuse limits.
- [ ] Add founder/system-admin, content-editor, and tester roles with least-privilege RLS/RPC checks.
- [ ] Require MFA or an equivalent stronger control for founder/system-admin accounts.
- [ ] Audit role grants and role changes; no self-promotion path.
- [ ] Review all Supabase Auth redirect and Site URL settings for the stable domain only.

### Data authorization

- [ ] Reconcile migration history without pretending unapplied effects exist.
- [ ] Remove authenticated direct reads from all assessor-bearing MMI tables, including auxiliary marking/end/domain/response-rule tables.
- [ ] Expose active student questions through a safe projection that excludes guidance/assessor fields.
- [ ] Prevent direct authenticated score insertion and cross-user streak mutation.
- [ ] Move direct authenticated `mock_sessions` insertion behind a bounded, rate-limited creation RPC with strict legacy-session fields; self-ownership RLS alone does not prevent storage abuse.
- [ ] Keep attempt/results owner-readable and client-write-denied.
- [ ] Review every `SECURITY DEFINER` function for fixed `search_path`, exact signature revokes, least-privilege grants, caller binding, and row locking.
- [ ] Run adversarial RLS tests with anonymous, ordinary tester, content editor, founder, and service roles in an isolated project.

### Privacy and governance

- [ ] Approve privacy notice, terms, processor disclosure, AI-provider disclosure, retention period, account deletion, data export, and support contact.
- [ ] State clearly what answer/transcript content is sent to the configured AI provider.
- [ ] Do not persist raw audio. If Phase 4 voice launches, only the user-reviewed transcript may enter scoring/persistence.
- [ ] Do not claim vocal-delivery assessment; the scoring boundary is text/rubric based.
- [ ] Define account-deletion and fixed-retention behavior before enabling any Cron/purge job.
- [ ] Validate deletion/retention against an isolated fixture database before any hosted schedule is approved.
- [ ] Keep screenshots, access tokens, answer text, transcripts, rubric text, provider bodies, and secrets out of analytics/error logs.

### AI and cost controls

- [ ] Persist scoring through an authenticated, atomic, idempotent server workflow.
- [ ] Rate-limit durable provider attempts per user and per rolling time window.
- [ ] Add daily per-user quota, project budget alert, and a global scoring kill switch.
- [ ] Keep provider hostnames exact-allowlisted, HTTPS-only, DNS-checked, private-network rejected, redirect-rejected, and time-bounded.
- [ ] Keep provider/key configuration server-side and `ai_api_key` unreadable to every client.
- [ ] Add a clinician-reviewed evaluation set for unsafe advice, alternative valid answers, missing critical actions, and prompt injection.
- [ ] Require strict output-schema success, safety-critical omission detection, acceptable score ranges, and an approved drift threshold before treating scores as trustworthy.

## Content operations

- [ ] Single-question create/edit/preview/publish/deactivate flow.
- [ ] Bulk CSV validation before mutation with exact headers, RFC 4180 behavior, field/file/row bounds, enums, duplicate policy, and row-level errors.
- [ ] Draft and published states; importing must not make content instantly student-visible.
- [ ] Creator/updater identity, timestamps, and publication audit history.
- [ ] Add caller-generated request IDs or an equivalent durable deduplication key so retries cannot duplicate question batches or feedback reports after ambiguous network results.
- [ ] Content editor cannot access AI credentials or security configuration.
- [ ] Student-safe projections exclude `guidance_notes`, cached model answers, actor details, rubrics, drafts, inactive rows, and future prompts.
- [ ] Clinician/content review owner and documented publication checklist.

## Reliability and operations

- [ ] Client/server error monitoring with aggressive sensitive-field scrubbing.
- [ ] Dashboard/alerts for authentication failures, Edge error rate and latency, database saturation, rate limits, provider failures, and AI spend.
- [ ] Synthetic uptime check for login and a non-mutating authenticated health path.
- [ ] Support triage, severity definitions, incident response, status communication, and rapid-disable runbook.
- [ ] Backup/restore and forward-fix rollback procedures; rehearse on an isolated project.
- [ ] Preserve prior Vercel releases and document instant rollback.
- [ ] Define feature flags/kill switches for scoring, authoring, feedback, and Phase 4.
- [ ] Run a 100-account synthetic load/concurrency exercise using isolated synthetic users and content only.
- [ ] Verify rate limits and idempotency under concurrency, provider timeout, retry, and partial failure.

## Quality gates

- [ ] Unit tests for pure validation, parsing, lifecycle, aggregation, navigation, storage, and state transitions.
- [ ] Integration tests against a local/disposable Supabase stack only.
- [ ] Browser E2E for invite/login/reset, onboarding, practice, scoring, progress, question authoring, feedback, role denial, deep links, refresh, and sign-out.
- [ ] Re-run the local Edge-runtime smoke for the closed-round release commit. The cofounder-preview baseline passed on 25 August 2026 for JWT, CORS preflight, allowed/disallowed origins, method/content-type/body limits, safe errors, and terminal provider-failure persistence.
- [ ] At least 80% lines, functions, branches, and statements for changed/new logic.
- [ ] Typecheck and static web export pass.
- [ ] Chrome, Safari, Firefox, iOS-width, Android-width, keyboard-only, screen-reader, contrast, reduced-motion, and slow-network QA pass.
- [ ] `$un-vibecode` and the one-time Impeccable final detector pass against real copy and all empty/error/loading states.
- [ ] Independent security review reports no unresolved Critical/High finding.
- [ ] `npm audit --omit=dev` findings are classified by direct dependency, transitive path, runtime reachability, compatible mitigation, and owner. Never use `npm audit fix --force`.

## Phase 4 MMI roadmap

### Completed locally and merged

1. Canonical MMI content schema capture.
2. Student-safe station discovery/current-prompt APIs.
3. Versioned rubrics, attempts, prompt results, scoring claims, and retention model.
4. Pure MMI contracts, rubric validation, aggregation, and lifecycle transitions.
5. Hardened reusable scoring-provider and CORS/HTTP boundary.
6. Authenticated attempt creation, safe restoration, prompt reveal, and abandonment.

These migrations/functions are not thereby authorized for hosted deployment. The live schema is partially/manual and must be reconciled first.

### Remaining before Phase 4 can be exposed

7. Idempotent rubric-driven scoring and atomic progression.
8. Provider-isolated audio transcription and ephemeral recording validation.
9. Typed station-library data layer and filters.
10. Dedicated MMI client state engine.
11. Student station library replacing the hidden Questions placeholder.
12. Voice recording, transcript review, typed fallback, and standard-station route flow.
13. Immediate feedback, explicit sole forward progression, deterministic summary, and single-turn role-play.
14. Separate completed MMI history in Progress without changing legacy aggregates.
15. Full security, integration, coverage, export, Edge-runtime, browser, device, privacy, and clinician-evaluation release gates.

### Preserved Phase 4 contracts

- Legacy questions and MMI content remain separate domains.
- One station per Phase 4 attempt; Circuit is deferred.
- Standard stations use ordered sub-questions; role-play uses one recorded response, not a live AI actor.
- The server pins station content, rubric version, scoring contract, privacy-notice version, and timing at attempt creation.
- Preparation reveals no prompt until trusted server time allows it.
- The client receives only the current prompt and never future prompts or hidden assessor context.
- The user reviews the transcript before scoring; raw audio is transient and never persisted.
- Applicable dimensions are structure, ethics, communication, reflection, and NHS awareness; zero-weight dimensions are N/A.
- Server code computes overall percentage. Provider output cannot supply it authoritatively.
- Successful scoring is idempotent and cannot be pedagogically retried; technical retries reuse the same logical request.
- Feedback is restored after refresh. The next prompt appears only after explicit **Continue to next prompt**.
- Final summaries are deterministic from persisted prompt results and make no extra AI call.
- Hidden model answers, rubric instructions, criteria, actor persona/background, prompts, provider bodies, and credentials stay server-only.

## Hosted Supabase drift and reconciliation

### Current read-only classification

- Early legacy schema and initial RLS are substantially present but migration history is empty.
- AI-key read protection exists, but function-only write hardening is not fully represented.
- Base MMI content tables exist without the complete local reconciliation constraints/indexes/role-play additions.
- Student-safe MMI projection RPCs and later attempt persistence/RPCs are absent.
- Additional assessor-bearing tables exist outside the migration chain.
- Hosted policies currently expose hidden MMI/role-play/auxiliary assessor content to authenticated users.
- `update_streak` can be invoked without adequate caller binding.
- Authenticated users can insert scores for their own answers.
- Legacy question reads include inactive rows and `guidance_notes`.

### Safe reconciliation method

1. Complete the fresh snapshot gate: `supabase/reconciliation/20260825_hosted_catalog_snapshot.sql` returned at `2026-08-25 05:59:23.339506 UTC` with catalog MD5 `0811d9d73c003ea1daba2efd2058c136`. `migration_relation` and `cron_relation` were `null`, so no conditional follow-up ran; compare this retained SELECT-only evidence with every fail-closed script precondition.
2. Prove `supabase/reconciliation/20260825_cofounder_preview_security.sql` against a disposable clone of the observed live schema. It uses exact `ALTER POLICY` operations and privilege revocation and must never enter `db push`.
3. Prove additive migrations `20260825000000`, `20260825001000`, and `20260825002000` from an empty local database and after that reconciliation. Completed for the 25 August 2026 preview commit; repeat for a changed release commit.
4. Verify the created tables/RPCs, security-definer ownership/search paths, service-only storage, RLS, and exact function grants.
5. Deploy and smoke-test the hardened Edge functions and Vercel client before revoking the legacy browser surface.
6. Prove and separately approve final cutover `20260825004000`, which rewrites exact ownership policies, removes table/column grant drift, disables direct score/streak/question access, and restores only the minimum safe browser grants.
7. Run independent database/security review and retain its findings with the release evidence.
8. Present migration-history reconciliation, every SQL stage, secrets, function deployment, roles, and content inserts as separate exact approval requests.
9. Re-audit hosted state after each approved operation before moving to the next.

Never mark a migration applied until its complete reviewed effect exists. Never run the current `db push`, broad `migration repair`, or any Cron/purge operation against hosted Supabase without exact approval.

## Deployment sequence

### Local and disposable verification — no hosted mutation

1. Freeze the release commit and dependency lockfile.
2. Run unit, coverage, typecheck, build, local Edge-runtime smoke, isolated Supabase integration, E2E, browser/accessibility, load, audit, and independent security gates.
3. Produce exact reviewed SQL diffs, function list, secret names (never values), allowed origins, and rollback plan.
4. Confirm the preview and Phase 4 deployment scopes are not mixed.

### Approval-gated production stages

1. Audit the hosted schema and repair only a separately proven migration-history baseline; never claim unapplied effects.
2. Separately apply the hosted-only reconciliation artifact outside `db push`.
3. Separately apply only additive preview migrations `000`–`020`, then re-audit all objects and grants.
4. Configure exact public origins, provider host allowlist if needed, provider/model/key, and later transcription key only if that feature is approved.
5. Deploy only reviewed JWT-verified Edge functions and the hardened Vercel client; complete bounded smoke while the legacy client surface still exists.
6. Separately apply final privilege cutover `040`, then prove every policy, table/column privilege, and function grant postcondition.
7. Insert only approved privacy/rubric/content rows through an audited workflow.
8. Create a dedicated synthetic smoke user and run bounded production-safe checks.
9. Verify client bundles contain no secret, RLS denies adversarial paths, and old deployments can be restored.
10. Invite users in small cohorts; watch errors, latency, rate limits, spend, and support load before expanding to 100.

## Rollback and stop conditions

Stop or disable the affected feature on any of these:

- Cross-user data access or mutation.
- Hidden assessor, rubric, future-prompt, credential, provider-body, or token exposure.
- Duplicate paid scoring under replay/concurrency.
- Unsafe advice escaping clinician-set evaluation bounds.
- Unbounded provider cost or persistent rate-limit failure.
- Migration drift, failed forward-only schema change, or inability to restore service.
- Error monitoring captures sensitive answer/transcript/auth material.
- Critical/High security finding without a verified fix.

Rollback uses a previously verified **hardened-compatible** Vercel deployment plus server-side feature/kill switches. The archival pre-redesign client is not a safe rollback after backend privilege revocation unless it has separately passed compatibility testing. Database rollback is forward-fix only unless a separately reviewed reversible operation exists; never delete user data as an improvised rollback.

## Authoritative external references

- Expo web deployment: <https://docs.expo.dev/distribution/publishing-websites/>
- Expo Audio: <https://docs.expo.dev/versions/v55.0.0/sdk/audio/>
- Supabase Auth production checklist: <https://supabase.com/docs/guides/auth/going-into-prod>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
- Supabase Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase Cron: <https://supabase.com/docs/guides/cron>
- Vercel static deployment configuration: <https://vercel.com/docs/projects/project-configuration>
- WCAG 2.2: <https://www.w3.org/TR/WCAG22/>
- OWASP ASVS: <https://owasp.org/www-project-application-security-verification-standard/>
- OpenAI audio transcription API: <https://platform.openai.com/docs/api-reference/audio/createTranscription>

## Closed-round release gate

Launch only after all applicable checkboxes have dated evidence, capacity/cost/retention/ownership values are approved, hosted reconciliation is complete, and the independent final review has no unresolved Critical or High finding.
