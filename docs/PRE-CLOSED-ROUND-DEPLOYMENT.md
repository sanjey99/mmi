# Pre-Closed-Round Deployment

**Goal:** Evolve the approved cofounder preview into a sustainable, secure invite-only round of approximately 100 people without exposing unfinished MMI functionality or trusting client-owned scoring state.

**Entry condition:** Every release gate in [Before Cofounder Viewing](./BEFORE-COFOUNDER-VIEWING.md) is complete and evidenced.

## Current checkpoint — 25–26 August 2026

- The import-idempotency database capability is hosted, while its client workflow remains local on `feat/cofounder-ui-reliability` and is not deployed to Vercel. During this current phase, the separately approved `040` and `050` were applied as recorded below; beyond them, no workbook import, secret/configuration change, row DML, Cron, migration-history, or role mutation was performed.
- Earlier separately approved operations applied the hosted-only reconciliation, additive migrations `20260825000000`, `20260825001000`, and `20260825002000`, final cutover `20260825004000`, and import-capability migration `20260825005000` on 26 August 2026; `score-answer` is v4 ACTIVE and `manage-ai-key` remains v3. Both workbook imports remain separately approval-gated. The stable Vercel production alias is live at `https://mmi-hazel.vercel.app` from commit `dd0c60b2e6a18bac3494a26a494b1d06a88b2249`; it does not include the client import workflow.
- Latest local preview verification passes: 35 Node tests; 213 Vitest tests; Node coverage 98.52% lines, 84.63% branches, 98.82% functions; Vitest coverage 95.95% lines, 87.24% branches, 97.27% functions; TypeScript including the Edge handler; Expo web export; and 4/4 fully intercepted local Playwright tests, including station-overlap geometry and Profile → `/admin/questions` direct routing.
- Cross-account feedback restoration renders a privacy-minimal unavailable state without prior answer/feedback text; its complete partner journey passed 10/10 under three concurrent workers before the final 2/2 suite passed sequentially.
- Default test and coverage commands exclude all integration paths even when credential-shaped environment variables are present. The dedicated mutating command requires an explicit acknowledgement, an HTTP loopback Supabase URL, and local credentials, and otherwise fails before test collection.
- Account-switch isolation clears cached practice and profile data and epoch-binds every asynchronous session, restoration, scoring, progress, profile read/write, and auth-loading completion. The auth subscription returns synchronously and defers profile API calls outside auth-js's exclusive lock. The browser harness rejects non-local app hosts and every real Supabase project hostname.
- The prior independent readiness audit and the follow-up independent read-only audit of this diff are closed with no unresolved Critical or High finding in their respective reviewed scopes. Hosted `040` and `050` are complete; exact-content approvals remain hard-gated.
- Residuals are not fixed by this diff: Medium — the existing 10 Expo configuration-chain advisories and the CI/CD/analytics wider-release operational gate; Low — malformed CSV structural quoting/extra cells, distinct concurrent source-correction last-writer-wins behavior requiring operator serialization, and optional function-body hash pinning against privileged out-of-band replacement. Function signatures, uniqueness, owner, language, security-definer state, search path, and grants are already checked.
- The one-time Impeccable detector returned no findings and the `$un-vibecode` audit passes R01–R22. Mobile login Lighthouse scores 100 for accessibility and best practices.
- Before SDK-55 patch alignment, `npm audit --omit=dev` reported 27 findings, including 17 high. After alignment and a non-force audit fix, it reports 10 moderate, 0 high, and 0 critical; Expo dependency checking and `npm ls` are clean. `npm audit fix --force` was not used and is not advised. The remaining Expo config/xcode/uuid chain has no safe non-breaking audit remedy.
- Hosted public signup is disabled and verified (`disable_signup=true`); email sign-in remains enabled, anonymous sign-ins remain disabled, and email confirmation remains enabled. The approximately 100-person round still requires an operational invite/allowlist workflow.
- The versioned migration chain applies cleanly from an empty disposable local database and its effective ACL/RLS state is verified, including canonical authenticated non-secret `app_config` access and minimal service-role column grants. The authenticated local Edge-runtime smoke passed every HTTP boundary and the expected safe provider-failure path.
- A fresh unlinked contract-level clone reproduced every observed hosted fact consumed by the scripts. Hosted-only reconciliation, additive migrations `000`/`010`/`020`, and revised cutover `040` passed without row-count changes. Effective service privilege on `questions`/`answers`/`scores`/`mock_sessions` moved from 16/44 checks to 0/44, while exact scoring RPC execution and minimal profile/config columns remained.
- The fresh hosted SELECT-only snapshot completed at `2026-08-25 05:59:23.339506 UTC` with catalog MD5 `0811d9d73c003ea1daba2efd2058c136`. It confirmed the staged legacy schema/policy/grant assumptions and absent preview objects; `migration_relation` and `cron_relation` were both `null`, so no conditional follow-up was required or run. No hosted mutation occurred.
- Hosted public-schema default ACLs are broad. The reconciliation removes current browser and service-role assessor access at table and column scope, but every future hosted object must receive an explicit ACL review; changing default ACLs is a separately approved hardening decision.
- The direct-provider scoring fix lets pinned OpenAI/Anthropic endpoints run without `Deno.resolveDns`; custom `openai_compatible` endpoints retain exact allowlisting and dual DNS revalidation, and server logs retain only safe stages. It is live in `score-answer` v4 ACTIVE. A post-v4 hosted scoring-success smoke remains unverified; the previously recorded `openai`/`gpt-4o-mini` smoke returned `provider_failed` and is not post-v4 success evidence.
- The final unlinked runtime fixture created one local smoke user/admin/session, one failed claim, and one failed attempt; it persisted zero answers and scores, released the claim lease, stopped both disposable stacks with volumes preserved, and never contacted hosted Supabase.
- The preview SQL is split into a hosted-only reconciliation artifact, three additive migrations, final privilege cutover `040`, and import-capability migration `050`. The reconciliation, additive migrations `000`/`010`/`020`, `040`, and `050` were applied under exact approvals. Beyond the separately approved `040`/`050`, no workbook import, secret/configuration change, row DML, Cron, migration-history, or role mutation occurred during the current local import-idempotency phase.
- **Hosted `040` execution evidence:** `supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql` (SHA-256 `123406ce32d2f211d90095ff57d56d80e7efa9dad5c6413481e9898d4049f493`) was applied on `2026-08-26` to PostgreSQL 17.6 through Supabase Management API `database/query`, with no migration-history, Cron, or role change. Preflight/postflight rows were unchanged: `questions` 2, `profiles` 1, `answers` 1, `scores` 1, `mock_sessions` 11. All `handle_new_user()`, `is_admin()`, and `update_streak(uuid)` EXECUTE checks were false for PUBLIC, `anon`, `authenticated`, and `service_role`; fixed search paths count 3; enabled `auth.users` triggers count 1; assessor service table/column grants 0; exact scoring RPCs remained service-only and question RPCs authenticated-only. `migration_relation` and `cron_relation` remained `null`; broad default ACLs are unchanged.
- An initial `supabase db query --linked` SELECT preflight path attempted a temporary `cli_login_postgres` ALTER and received permission denied before the requested SELECT or `040` SQL ran; it was abandoned and made no role change. Direct Management API read-only preflight, exact-file apply (response `[]`), and read-only postflight then succeeded.
- **Hosted `050` execution evidence:** `supabase/migrations/20260825005000_cofounder_question_import_idempotency.sql` (SHA-256 `f9f0c7bd5256327e447998d3549093febcdb60cc32e7ee34b56c9ff7d06596c8`) was applied on `2026-08-26` to PostgreSQL 17.6 through direct Supabase Management API `database/query`; the exact-file response was `[]`. Preflight confirmed source columns, ledger, and import RPC absent; `040` question runtime table/column grants and helper EXECUTE grants were 0; baseline rows were `questions` 2, `profiles` 1, `answers` 1, `scores` 1, `mock_sessions` 11; and `migration_relation`/`cron_relation` were `null`. Postflight found two nullable source columns with zero existing source rows; the provenance constraint present and validated; the unique valid index with predicate requiring both source fields non-null; a zero-row private ledger owned by `postgres`, RLS enabled, zero policies, zero runtime table/column grants, and zero PUBLIC ACL; and the import RPC owned by `postgres`, `plpgsql`, `SECURITY DEFINER`, fixed-path, executable only by `authenticated` (not PUBLIC/`anon`/`service_role`). The manual RPC retained the same grant matrix; question runtime table/column grants and helper grants remained 0; rows were unchanged and import batches 0. `migration_relation`/`cron_relation` remained `null`; broad default ACLs are unchanged. No workbook import, row DML, secret/configuration, Cron, migration-history, or role operation occurred; the Vercel client import workflow was not deployed.
- A local-only workbook artifact v2 stages 785 inactive compatible drafts (500/285) from the approved workbook/source-revision SHA `903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`; criteria, model answers, and panel notes are excluded. That value is the RPC/CSV `source_manifest_sha256`, despite its historical field name. Each ignored CSV also carries source namespace `med_interview_question_bank`, a stable source ID, and a stable batch ID. Operator artifact verification is separate: part CSV SHA-256 values are `33769d18edf3872fc0b2b43fa957ed309715067a777607388d6c92f851f77c30` and `738ba2beca271c1c44f751446c02be930b79e304369a16a81b6e37d937857f0e`; the `manifest.json` artifact SHA is `959cbefcd557fe8833cc4e913241f45043a956cdd1b2884a24ab788e78478e98`. Migration hashes are applied `040` `123406ce32d2f211d90095ff57d56d80e7efa9dad5c6413481e9898d4049f493` and `050` `f9f0c7bd5256327e447998d3549093febcdb60cc32e7ee34b56c9ff7d06596c8`. Its private RLS ledger records a server-computed SHA-256 payload fingerprint; an exact retry returns existing IDs, altered reuse fails closed, and later corrections retain question UUID/performance/publication state. Fresh preserved container `mmi_question_import_proof_20260825_e` passed fixture → reconciliation → `000`/`010`/`020` → `040` → `050` plus full runtime proof, including 64-hex fingerprints and PostgreSQL 17 `MAINTAIN` ACL closure. The payloads remain local ignored/private proof and are not hosted or imported. Hosted `040` and `050` are complete; each exact import operation remains separately approval-gated.
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
- [x] Added a durable source-key batch ledger and exact-payload retry boundary for workbook imports; source IDs are unique while manual/seed questions remain unkeyed.
- [ ] Keep the two workbook-derived hosted question batches blocked until each exact import operation is separately approved. The Question Desk accepts only provenance-bearing source batches; manual one-question authoring remains on its separate RPC.
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
- [x] The follow-up independent read-only audit of this diff is closed with no unresolved Critical/High finding; the prior independent readiness audit remains closed for its reviewed scope. Residual Medium/Low release follow-ups remain documented above; hosted `040` and `050` are complete, while exact-content approvals remain hard-gated.
- [x] `npm audit --omit=dev` findings are classified by direct dependency, transitive path, runtime reachability, compatible mitigation, and owner: 10 Expo configuration dependency advisories remain a Medium follow-up. Never use `npm audit fix --force`.

## CI/CD and analytics plan — planned, not implemented

No tracked CI workflow or analytics integration exists at this checkpoint. Neither is authorized for deployment until this plan has an approved implementation and dated evidence.

### CI/CD release controls

- [ ] Add a required CI workflow for every pull request and the production branch. It must use the locked dependencies (`npm ci`) and pass `npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` before a release candidate can advance.
- [ ] Require CI to check the committed pull-request range with `git diff --check "$(git merge-base origin/<protected-branch> HEAD)" HEAD` (or `git show --check <commit>` for a single-commit release), plus a reviewed secret scan and security review. A developer may separately run `git diff --check` for uncommitted work. Classify the output of `npm audit --omit=dev`; do not auto-remediate and never use `npm audit fix --force`.
- [ ] Protect the production branch: require the named checks and an approving reviewer, disallow direct pushes and force-pushes, and record any administrator bypass with a release reason.
- [ ] Keep Vercel Preview and Production deployments distinct. Preview must use non-production Supabase, provider, and analytics credentials; no production secret, user data, or hosted mutation may be reachable from Preview.
- [ ] Retain release evidence for each promoted commit: commit SHA, lockfile digest, CI logs/results, scanned artifact or `dist/` digest, Vercel deployment URL, and the known-good hardened-compatible rollback deployment.
- [ ] CI may validate and create Preview artifacts only. Every hosted Supabase mutation and every Vercel Production mutation remains a separate manual approval: show the exact target, command or console change, reviewed diff, expected effect, rollback, and read-only post-check before executing it. This includes reconciliation, migrations, Edge deployments, secret/Auth/role changes, and Production promotion.

### Privacy-safe analytics plan

- [ ] Select an analytics provider only after legal/privacy, data-processing, transfer, consent, retention, and access reviews are approved. Provider choice is intentionally undecided; do not add an SDK, provider environment variable, or collection endpoint before explicit approval.
- [ ] Use an allowlist of exactly these low-cardinality product events: `page_view`, `onboarding_completed`, `practice_started`, `practice_completed`, `feedback_submitted`, and `scoring_outcome`. Each event may contain only its event name, timestamp, deployment environment, canonical route identifier (for `page_view`), a documented enum/boolean outcome where applicable, and optional ephemeral `analytics_session_id`; additions require renewed approval.
- [ ] If used, `analytics_session_id` must be a random analytics-only value, rotate on sign-out and browser-session expiry, never persist in Supabase, and never be joined to an account ID or other identifier. Never send answers, prompts/question text, rubrics, feedback text, emails, names, Supabase user IDs, free-form fields, URLs/query strings, screenshots, transcripts, provider payloads, access tokens, API keys, or other secrets to analytics. Disable autocapture, session replay, DOM/text capture, and IP/geolocation enrichment; require provider-level raw-IP truncation or non-retention unless a separately approved review changes this rule.
- [ ] Set and approve a finite provider retention period, least-privilege analytics access roles, and a periodic access review before collection begins.
- [ ] Keep Preview and Production analytics data, projects/collections, credentials, and retention policies separate. Any browser-visible analytics write key must be environment-specific, treated as non-secret only after review, and introduced through the approved build environment; no server-side analytics secret may enter an `EXPO_PUBLIC_*` variable.
- [ ] Before enabling analytics, approve the provider domain in CSP/`connect-src`, test the consent and opt-out path, inspect captured events in a non-production collection, and verify the network payload contains only the allowlisted schema. Preserve this verification evidence with the release.
- [ ] Provide an owner-operated analytics kill switch that disables client initialization/collection, document provider-side collection disablement and deletion/retention handling, and rehearse rollback by disabling collection and restoring the prior hardened-compatible deployment. Analytics must remain disabled until these controls and explicit approval are complete.

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

### Observed prior hosted snapshot classification

- This classification records what the prior SELECT-only snapshot showed; it does not describe the current state after separately approved operations.
- The prior snapshot showed an early legacy schema and initial RLS substantially present but migration history empty.
- The prior snapshot showed AI-key read protection, but function-only write hardening was not fully represented.
- The prior snapshot showed base MMI content tables without the complete local reconciliation constraints/indexes/role-play additions.
- The prior snapshot showed student-safe MMI projection RPCs and later attempt persistence/RPCs absent.
- The prior snapshot showed additional assessor-bearing tables outside the migration chain.
- The prior snapshot showed hosted policies exposing hidden MMI/role-play/auxiliary assessor content to authenticated users.
- The prior snapshot showed `update_streak` invocable without adequate caller binding.
- The prior snapshot showed authenticated users able to insert scores for their own answers.
- The prior snapshot showed legacy question reads including inactive rows and `guidance_notes`.

### Safe reconciliation method

1. Complete the fresh snapshot gate: `supabase/reconciliation/20260825_hosted_catalog_snapshot.sql` returned at `2026-08-25 05:59:23.339506 UTC` with catalog MD5 `0811d9d73c003ea1daba2efd2058c136`. `migration_relation` and `cron_relation` were `null`, so no conditional follow-up ran; compare this retained SELECT-only evidence with every fail-closed script precondition.
2. The hosted-only reconciliation was earlier applied under an exact approval, outside `db push`. Re-audit before any additional hosted operation.
3. Additive migrations `20260825000000`, `20260825001000`, and `20260825002000` and final cutover `20260825004000` were applied under exact approvals. Retain the recorded `040` Management API postflight evidence and re-prove changed release commits locally.
4. Verify the created tables/RPCs, security-definer ownership/search paths, service-only storage, RLS, and exact function grants.
5. `score-answer` is v4 ACTIVE, `manage-ai-key` remains v3, and the stable Vercel production alias is live at commit `dd0c60b2e6a18bac3494a26a494b1d06a88b2249`; the client import workflow is not deployed. Complete a bounded hosted smoke before any further promotion.
6. Final cutover `20260825004000` is complete; it rewrote exact ownership policies, removed table/column grant drift, disabled direct score/streak/question access, and restored only the minimum safe browser grants. Retain the recorded preflight/apply/postflight evidence.
7. Import-capability migration `20260825005000_cofounder_question_import_idempotency.sql` is complete after `040`. It added nullable source identity, a private RLS ledger, and a fixed-path authenticated-admin RPC, and performed no workbook import. Retain its recorded unique-index, ledger ACL/RLS, owner/security-definer/search-path, and direct-table-denial postflight evidence before content is considered.
8. Present part 1 (500) and part 2 (285) as independent exact RPC operations, each with the approved workbook/source-revision SHA passed as `source_manifest_sha256`, batch ID, row count, and expected result. Separately verify the operator artifacts: `manifest.json` SHA and the corresponding part CSV SHA-256. Do not alter or rename an ambiguous retry: resend exactly the same identity and payload, or use a separately approved correction batch.
9. Rollback is forward-only: do not delete imported rows to undo a batch. Preserve records and use a separately approved source correction/deactivation operation if review finds an error. Broad default ACLs remain a future-object hazard and are unchanged by this work.
10. Run independent database/security review and retain its findings with the release evidence.
11. Re-audit hosted state after each approved operation before moving to the next.

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
6. Final privilege cutover `040` is complete; retain the recorded postflight proof for every policy, table/column privilege, and function grant postcondition.
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
