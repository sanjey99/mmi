# Pre-Closed-Round Deployment

**Goal:** Evolve the approved cofounder preview into a sustainable, secure invite-only round of approximately 100 people without exposing unfinished MMI functionality or trusting client-owned scoring state.

**Entry condition:** Every release gate in [Before Cofounder Viewing](./BEFORE-COFOUNDER-VIEWING.md) is complete and evidenced.

## Current checkpoint — 25 August 2026

- The cofounder-preview implementation exists locally on `feat/cofounder-ui-reliability`; no preview migration, Edge deployment, secret/configuration change, role change, or hosted application-row mutation has been performed.
- Local preview verification passes: 44 Node tests, 145 Vitest tests, both coverage gates above 80%, TypeScript, production web export, and 2/2 fully intercepted Playwright journeys.
- Account-switch isolation clears all cached practice data and epoch-binds every asynchronous session, restoration, scoring, and progress operation. The browser harness rejects non-local app hosts and every real Supabase project hostname.
- The final independent local re-review reports no unresolved Critical, High, or Medium finding in that remediation. Hosted approval-gated findings remain release blockers.
- The one-time Impeccable detector returned no findings and the `$un-vibecode` audit passes R01–R22. Mobile login Lighthouse scores 100 for accessibility and best practices.
- The read-only dependency audit reports 17 high, 9 moderate, and 1 low advisory, with no critical finding. The paths are concentrated in Expo/Metro/build tooling and require a supported compatibility review; force-fixing is prohibited.
- Expo SDK-55 patch versions are behind the current supported set, and `react-native-worklets` is ahead of Expo's expected version. Resolve this through a dedicated compatibility change with full regression testing.
- Hosted public signup was still enabled at the last check. Disabling it is a cofounder-preview blocker and remains mandatory for the 100-person round.
- Local Edge-runtime smoke and disposable Supabase integration tests remain required. Production/shared credentials must never be used for them.
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
- [ ] Local Edge-runtime smoke for JWT, CORS preflight, allowed/disallowed origins, method/content-type/body limits, and safe errors.
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

1. Take a fresh read-only catalog/policy/function/grant/trigger/extension/Cron snapshot and hash the evidence.
2. Prepare a dedicated additive reconciliation branch. Replace destructive policy/trigger patterns with exact additive or `ALTER` operations.
3. Remove seed inserts, content backfills, Cron unscheduling, deletion loops, and unrelated row writes from the production path.
4. Revoke base-table access from all assessor-bearing tables and add safe projections.
5. Repair streak and score integrity before enabling tester traffic.
6. Prove the revised migration chain from an empty local database and from a disposable clone of the observed live schema.
7. Run independent database/security review.
8. Present migration-history repair, schema hardening, secrets, function deployment, and any content inserts as separate exact approval requests.
9. Re-audit hosted state after each approved operation before moving to the next.

Never mark a migration applied until its complete reviewed effect exists. Never run the current `db push`, broad `migration repair`, or any Cron/purge operation against hosted Supabase without exact approval.

## Deployment sequence

### Local and disposable verification — no hosted mutation

1. Freeze the release commit and dependency lockfile.
2. Run unit, coverage, typecheck, build, local Edge-runtime smoke, isolated Supabase integration, E2E, browser/accessibility, load, audit, and independent security gates.
3. Produce exact reviewed SQL diffs, function list, secret names (never values), allowed origins, and rollback plan.
4. Confirm the preview and Phase 4 deployment scopes are not mixed.

### Approval-gated production stages

1. Back up/audit the hosted schema and repair only proven migration-history baselines.
2. Apply the reviewed additive security/reconciliation migrations in timestamp order.
3. Configure exact public origins, provider host allowlist if needed, provider/model/key, and later transcription key only if that feature is approved.
4. Deploy only reviewed JWT-verified Edge functions.
5. Insert only approved privacy/rubric/content rows through an audited workflow.
6. Create a dedicated synthetic smoke user and run bounded production-safe checks.
7. Verify client bundles contain no secret, RLS denies adversarial paths, and old deployments can be restored.
8. Invite users in small cohorts; watch errors, latency, rate limits, spend, and support load before expanding to 100.

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
