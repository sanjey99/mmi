# Before Cofounder Viewing

This is the authoritative release runbook for the private founding-team preview. It replaces the historical implementation plans and security checklist.

## Goal and release scope

Deploy the smallest truthful product slice that lets named cofounders:

- sign in with an issued account;
- complete onboarding;
- run free or eight-minute legacy question practice;
- submit an answer for server-owned AI scoring;
- review feedback and progress;
- create one question or validate a CSV batch from the Question Desk;
- send privacy-minimal product feedback; and
- sign out reliably.

Keep public signup, Tutor, MMI Circuit, the student Questions placeholder, and all unfinished Phase 4 MMI routes hidden. This preview is not the approximately 100-person closed round; that later gate is defined in [Pre-Closed-Round Deployment](./PRE-CLOSED-ROUND-DEPLOYMENT.md).

## Architecture and source state

- Web: Expo Router static export on Vercel.
- Backend: Supabase Auth, Postgres, and Edge Functions.
- Render: not used.
- Active implementation branch: `feat/cofounder-ui-reliability`.
- Branch base: `origin/main` at `9cf4311`.
- Pre-redesign UI backup: local branch `backup/pre-redesign-ui-2026-08-25` at `9cf4311`.
- Approved visual direction: **The Numbered Station Corridor**, composition **Doorway Threshold**.
- Design contract: [PRODUCT.md](../PRODUCT.md) and [surface brief](../.impeccable/surface-brief.md).

The original navy/teal/ecru interface remains recoverable from the backup branch. The active branch uses Barlow Condensed and Source Sans 3 with the deliberate palette `#F7F8F6`, `#25272A`, `#F4C542`, and `#B3342B`.

## Safety boundary

- Treat hosted Supabase as read-only until an exact operation is shown and separately approved.
- Never delete hosted rows or database objects.
- Do not run `supabase db push`, broad migration repair, migrations, function deployments, secret changes, role changes, or row writes without explicit approval.
- Never run credential-gated tests against production or shared data.
- Never put a Supabase secret/service-role key in Vercel or an `EXPO_PUBLIC_*` variable.
- Never print or commit `.env` values.
- Never run `npm audit fix --force`.
- Do not deploy Phase 4 persistence/Cron merely to enable this preview; its retention workflow includes mutations and deletion behavior that requires a separate privacy decision.
- The workbook-derived `questions-part-*.csv` artifacts are local, ignored, private proof only and are not committed or public. Under separate exact import and publication approvals, their 785 provenance-bearing hosted rows are active and candidate-visible; the next hosted content operation remains separately approval-gated and forward-only. Only the converter, manifest, and provenance/count/hash metadata are commit candidates.

## Read-only hosted snapshot facts before approved operations — 25 August 2026

- The remote migration-history table contains none of the local migration versions even though an early schema was manually/partially applied.
- Hosted legacy content contains two active questions: one Ethics and one Motivation. Four categories are empty.
- `app_config` contains provider/model rows; `ai_api_key` and `ai_base_url` were not configured when last inspected.
- `pg_trgm` and `uuid-ossp` are installed; `on_auth_user_created` is enabled.
- Public signup was disabled by the project owner and verified read-only on 25 August 2026: Auth settings returned `disable_signup=true`; email sign-in remains enabled, anonymous sign-ins remain disabled, and email confirmation remains enabled.
- The public Supabase project endpoint is reachable. The prior browser `NetworkError` was a missing or stale client environment configuration, not an outage.
- The fresh read-only snapshot found policies exposing assessor-bearing MMI/role-play content to authenticated users, unsafe legacy question fields, cross-user `update_streak`, and own-answer score insertion. Do not infer the current post-approval state beyond the separately recorded operations below.
- During the current import-idempotency phase, the separately approved `040`, `050`, exact part-1/part-2 workbook RPC imports, and exact publication transaction were applied as recorded below. All 785 workbook rows are active and candidate-visible; the client import workflow remains undeployed to Vercel. Every next content operation remains separately approval-gated and forward-only, as do function deployment, secret/configuration change, user/profile or other application-row DML, Cron, migration-history, and role mutation. This does not establish overall hosted deployment/readiness.

## Implemented locally

### Interface and navigation

- [x] Replaced the prior competitor-adjacent visual world with the researched station-corridor system.
- [x] Added a responsive square-geometry component system, accessible labelled controls, explicit state copy, and no emoji navigation.
- [x] Added deterministic back navigation with safe deep-link fallbacks.
- [x] Fixed the Home **NEXT STATION** overlap and made admin Profile's **Question Desk** route directly to `/admin/questions`. These routing fixes are live in the stable Vercel deployment from `dd0c60b2e6a18bac3494a26a494b1d06a88b2249`.
- [x] Replaced React Native Web `Alert.alert()` flows with rendered confirmation and notice components.
- [x] Added substantive, reachable Terms and Privacy screens labelled for legal review.
- [x] Preserved the legacy `/signup` route as an invitation-only notice with no `auth.signUp()` call.
- [x] Added a final UI policy test covering legal reachability, invitation-only signup, shadows, and stock left-strip treatments.

### Authentication and practice reliability

- [x] Web auth uses guarded `sessionStorage`; refresh in the same tab can restore a session while a new browser session starts without a retained login.
- [x] Sign-out checks the Supabase result, clears local state, and returns to login with retryable feedback on failure.
- [x] Sign-out and account changes clear all account-bound practice state; every in-flight session, restoration, scoring, and progress operation is epoch-bound so an old account cannot repopulate a new account's store or continue navigation.
- [x] Account changes clear the previous profile synchronously; profile reads, writes, and loading completions require the initiating auth epoch and user ID to remain current, so delayed admin-profile data cannot cross a sign-out or account switch.
- [x] The Supabase auth subscription returns synchronously and defers profile API work until after the callback releases auth-js's exclusive lock, preventing sign-in/token-refresh deadlocks.
- [x] Practice availability comes from active server projections rather than a hard-coded default question.
- [x] Empty categories are unavailable and route restoration validates the owned session/question identity.
- [x] Submission shows validation, scoring, retry, saved, and provider-failure states instead of becoming inert.
- [x] A feedback deep link from another account/browser session renders a neutral unavailable state with no prior answer or feedback text, then lets the user explicitly return to Practice.

### Server-owned legacy scoring

- [x] The client no longer inserts authoritative answers/scores, updates session totals, or invokes arbitrary streak mutations.
- [x] The authenticated Edge path loads server-owned state and applies body bounds, durable rate limiting, idempotency, a lease, safe provider errors, and atomic persistence.
- [x] Provider handling retains exact host/origin allowlists, HTTPS, DNS/private-network rejection, redirect rejection, timeouts, strict schema validation, and secret-safe errors.
- [x] Direct-provider scoring fix: pinned OpenAI/Anthropic endpoints no longer require `Deno.resolveDns`; custom `openai_compatible` endpoints retain their exact allowlist and dual DNS revalidation. Only safe stages are recorded in server logs. This is live in `score-answer` v4 ACTIVE; a post-v4 hosted scoring-success smoke remains unverified. The previously recorded hosted smoke returned `provider_failed` with `openai` and `gpt-4o-mini` and must not be treated as post-v4 success evidence.
- [x] Local migration: `20260825000000_cofounder_preview_scoring.sql`.
- [x] Hosted application/deployment remains approval-gated.

### Edge configuration boundary

- [x] `manage-ai-key` now uses the shared exact-origin, method, JSON media-type, streaming body-size, JWT, and live-admin boundary.
- [x] Stored key material is never selected or returned; responses contain only fixed status/error fields.
- [x] Handler behavior is executable under Node tests and included in the default Edge typecheck.
- [x] Every mutating integration suite is excluded from default test/coverage commands and requires an explicit local-mutation acknowledgement, an HTTP loopback URL, and local credentials.
- [x] The dedicated mutation command fails during global setup before test collection when any prerequisite is absent.

### Question Desk and student-safe reads

- [x] Added fixed-shape active question/count/read RPC clients.
- [x] Added single-question authoring and CSV preview with field, row, enum, duplicate, and size validation.
- [x] Draft content stays non-student-visible; admin authorization is enforced by the proposed server boundary.
- [x] Guidance/assessor fields are excluded from student responses.
- [x] Local migration: `20260825001000_cofounder_preview_question_api.sql`.
- [x] Hosted application remains approval-gated.

### Hosted retry-safe import capability; completed workbook publication

- [x] Preserved a local-only compatible-draft import artifact for workbook SHA-256 `903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`: 785 inactive drafts split into 500 and 285 rows.
- [x] Converter artifact v2 adds stable `source_namespace`, `source_id`, approved workbook SHA-256, and batch ID metadata. Artifact SHA-256 values: part 1 `33769d18edf3872fc0b2b43fa957ed309715067a777607388d6c92f851f77c30`; part 2 `738ba2beca271c1c44f751446c02be930b79e304369a16a81b6e37d937857f0e`; manifest `959cbefcd557fe8833cc4e913241f45043a956cdd1b2884a24ab788e78478e98`.
- [x] Added and separately approved hosted migration `20260825005000_cofounder_question_import_idempotency.sql` (SHA-256 `f9f0c7bd5256327e447998d3549093febcdb60cc32e7ee34b56c9ff7d06596c8`): nullable durable question provenance, a private RLS batch ledger with a server-computed SHA-256 payload fingerprint, and an authenticated-admin-only fixed-path `SECURITY DEFINER` import RPC. The migration itself performed no content import. Exact batch retries return existing stable IDs; conflicting payload reuse fails closed; later source batches may update source-controlled fields but preserve the UUID, `times_attempted`, `avg_score`, and publication state. The client workflow remains undeployed; both content batches were later imported through separate approved RPC transactions recorded below.
- [x] Criteria, model answers, and panel notes are excluded. The CSV artifacts remain local ignored/private proof and are not committed or public; their separately approved part-1/part-2 content is active and candidate-visible. The two former legacy live rows were deactivated without physical deletion, preserving historical answer/score references.
- [x] Disposable PostgreSQL 17.6 proof applied fixture → reconciliation → `000`/`010`/`020` → `040` → `050`; proved first import, exact retry, conflicting retry denial, second batch, source correction preserving history/publication, manual authoring, ordinary-user denial, direct question/ledger denial, trigger-created synthetic profiles, and audit retention after profile deletion. Proof containers and volumes were retained.
- [ ] **Hard gate:** the exact publication transaction is complete. Any next hosted content operation, including a correction or deactivation, requires a separate exact approval and must be forward-only; never delete imported rows. No broad hosted default ACL change is included; future-object default ACL drift remains a separately approved hazard.

### Cofounder feedback

- [x] Added structured category, severity, screen, message, app version, reply permission, and founder review UI.
- [x] Screenshots, logs, tokens, answers, and transcripts are not attached.
- [x] Author identity is masked from the review response when reply permission is off.
- [x] Added bounded validation and a durable per-user rate limit.
- [x] Local migration: `20260825002000_cofounder_feedback.sql`.
- [x] Hosted application remains approval-gated.

### Hosted security staging

- [x] Added a hosted-only, separately approved reconciliation artifact at `supabase/reconciliation/20260825_cofounder_preview_security.sql`; it is intentionally outside the automatic migration chain.
- [x] Added the final privilege cutover migration `20260825004000_cofounder_preview_privilege_cutover.sql`.
- [x] The cutover validates the exact legacy policy identities, repairs all seven ownership predicates, removes table and column grant drift, checks preview RPC identity/ACLs, and restores only the minimum browser privileges.
- [x] These scripts contain no top-level row DML, object deletion, Cron operation, or migration-history operation.
- [x] The complete versioned migration chain was executed against a fresh disposable local Supabase database. Earlier exact approvals applied the hosted-only reconciliation, additive migrations `20260825000000`/`01000`/`02000`, final cutover `04000`, import-capability migration `05000`, the separately approved part-1/part-2 imports, and the separately approved publication transaction on 26 August 2026. All 785 workbook rows are active and candidate-visible; any next content operation remains separately approval-gated and forward-only.
- [x] Effective local ACL readback proves `cofounder_feedback` has no direct table privilege for `anon`, `authenticated`, or `service_role`; only the two authenticated security-definer RPCs are executable.
- [x] Fresh-chain privilege normalization gives `authenticated` exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `app_config` behind four canonical non-secret RLS policies. `service_role` has no direct table or column access to `questions`, `answers`, `scores`, or `mock_sessions`; its direct Edge surface is limited to `profiles(id,is_admin)` read access and `app_config(key,value)` read/write access. Scoring-ledger tables retain their separately verified service-only grants.
- [x] Added the metadata-only hosted snapshot script `supabase/reconciliation/20260825_hosted_catalog_snapshot.sql`; it reads system catalogs, hashes function definitions without returning their bodies, reports migration/Cron relation presence before any conditional follow-up, and performs no hosted mutation.
- [x] Ran the fresh hosted snapshot at `2026-08-25 05:59:23.339506 UTC`; catalog MD5: `0811d9d73c003ea1daba2efd2058c136`. It confirmed the exact legacy tables, policies, broad grants/default ACLs, and absent preview objects consumed by the staged scripts. `migration_relation` and `cron_relation` were both `null`, so neither conditional follow-up ran. This was SELECT-only; no hosted mutation occurred.
- [x] The snapshot confirmed broad public-schema default ACLs. Reconciliation now revokes present assessor-table grants for browser and service roles at table and column scope, but future hosted objects still require explicit grant/revoke review. Altering hosted default ACLs is not authorized by this release stage.
- [x] **Hosted `040` execution evidence:** `supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql` (SHA-256 `123406ce32d2f211d90095ff57d56d80e7efa9dad5c6413481e9898d4049f493`) was applied on `2026-08-26` to PostgreSQL 17.6 through Supabase Management API `database/query`, with no migration-history, Cron, or role change. Preflight and postflight row counts were identical: `questions` 2, `profiles` 1, `answers` 1, `scores` 1, `mock_sessions` 11. Postflight found `handle_new_user()`, `is_admin()`, and `update_streak(uuid)` non-executable by PUBLIC, `anon`, `authenticated`, and `service_role`; three fixed function search paths; one enabled `auth.users` trigger; zero assessor service table/column grants; the exact scoring RPCs still service-only; and the question RPCs still authenticated-only. `migration_relation` and `cron_relation` remained `null`; broad default ACLs are unchanged.
- [x] An initial `supabase db query --linked` SELECT preflight path attempted a temporary `cli_login_postgres` ALTER and received permission denied before the requested SELECT or `040` SQL ran; it was abandoned and made no role change. Direct Management API read-only preflight, exact-file apply (response `[]`), and read-only postflight then succeeded.
- [x] **Hosted `050` execution evidence:** `supabase/migrations/20260825005000_cofounder_question_import_idempotency.sql` (SHA-256 `f9f0c7bd5256327e447998d3549093febcdb60cc32e7ee34b56c9ff7d06596c8`) was applied on `2026-08-26` to PostgreSQL 17.6 through direct Supabase Management API `database/query`; the exact-file response was `[]`. Preflight confirmed source columns, ledger, and import RPC absent; `040` question runtime table/column grants and helper EXECUTE grants were 0; baseline rows were `questions` 2, `profiles` 1, `answers` 1, `scores` 1, `mock_sessions` 11; and `migration_relation`/`cron_relation` were `null`. Postflight found two nullable source columns with zero existing source rows; the provenance constraint present and validated; the unique valid index with predicate requiring both source fields non-null; a zero-row private ledger owned by `postgres`, RLS enabled, zero policies, zero runtime table/column grants, and zero PUBLIC ACL; and the import RPC owned by `postgres`, `plpgsql`, `SECURITY DEFINER`, fixed-path, executable only by `authenticated` (not PUBLIC/`anon`/`service_role`). The manual RPC retained the same grant matrix; question runtime table/column grants and helper grants remained 0; rows were unchanged and import batches 0. `migration_relation`/`cron_relation` remained `null`; broad default ACLs are unchanged. No workbook import, row DML, secret/configuration, Cron, migration-history, or role operation occurred; the Vercel client import workflow was not deployed.
- [x] **Hosted workbook part-1 execution evidence:** The exact approved artifact `supabase/imports/20260825_med_interview_question_bank/questions-part-1.csv` (SHA-256 `33769d18edf3872fc0b2b43fa957ed309715067a777607388d6c92f851f77c30`) was imported on `2026-08-26` in one authenticated-admin RPC transaction under namespace `med_interview_question_bank`, source-manifest/workbook SHA `903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`, and batch ID `questions-part-1`. The transaction inserted 500 provenance-bearing, inactive questions and recorded private-ledger payload fingerprint `129b136a6549abdea2cfd09be9fe1f565563bf1098f598903903dbcacceeb0e5`. Its read-only postflight found `questions` 502, `profiles` 1, `answers` 1, `scores` 1, `mock_sessions` 11, and `import_batches` 1; the original two questions were unchanged (fingerprint `778a7743a3961d04019c9c77c93fa3ef`); and the exact comparison was 500 matched, 0 missing, 0 mismatched, and 0 unexpected. At that point the part-2 batch was absent. The final full-staging state is recorded below.
- [x] **Hosted workbook part-2 and full-staging execution evidence:** The exact approved artifact `supabase/imports/20260825_med_interview_question_bank/questions-part-2.csv` (SHA-256 `738ba2beca271c1c44f751446c02be930b79e304369a16a81b6e37d937857f0e`) was imported on `2026-08-26` in one authenticated-admin RPC transaction under namespace `med_interview_question_bank`, source-manifest/workbook SHA `903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71`, and batch ID `questions-part-2`. The transaction inserted 285 inactive provenance-bearing questions and recorded private-ledger payload fingerprint `b3a60ebe44c2bc05dd34496c62558daa65a8d4091ea083c9358ff15c39e8d3c9`. Its staging postflight found `questions` 787, `profiles` 1, `answers` 1, `scores` 1, `mock_sessions` 11, and `import_batches` 2; total source rows 785 with 785 distinct IDs, 785 inactive, and 0 active; and the exact part-2 comparison was 285 matched, 0 missing, 0 mismatched, and 285 distinct IDs. Part 1 remains 500 rows (question fingerprint `fcea2c17fbdcfe28cec421975df80c7d`; ledger fingerprint `129b136a6549abdea2cfd09be9fe1f565563bf1098f598903903dbcacceeb0e5`), while the two legacy rows remained unchanged at that stage (fingerprint `778a7743a3961d04019c9c77c93fa3ef`).
- [x] **Hosted publication execution evidence:** The separately approved transaction on `2026-08-26` physically deleted no rows, deactivated legacy IDs `8ca92227-308f-4930-a742-90b4e0cdc955` and `e5ad4c69-4a26-40e9-87b6-fe81a09ca245`, and activated exactly 785 rows with source namespace `med_interview_question_bank`. Immediate committed proof was `questions` 787; imported active 785/inactive 0; legacy active 0/inactive 2; `answers` 1; and `scores` 1. Later read-only postflight observed concurrent app activity (`profiles` 1, `answers` 2, `scores` 2, `mock_sessions` 12, `import_batches` 2) while proving candidate-visible active total 785; imported count/active/distinct IDs 785; imported content fingerprint excluding `is_active`/`updated_at` `34d702bf767a66af2fca1d78487bb63bc006b238f985b8b4614b77ec5ef925a6`; both exact legacy IDs inactive; legacy answer/score references still 1/1; and both batch ledgers/hashes unchanged. An aggregate-only trace captured `2026-08-26 03:23:14.431763 UTC` confirmed the delta: two answers total, exactly one legacy-question reference and one imported-question reference; two scores; 12 mock sessions; latest new session `03:20:03.247536 UTC` and latest answer/score `03:20:30.5307 UTC`; no answer text or other content was read. Direct question and ledger effective table/column privileges remained false for `anon`, `authenticated`, and `service_role`; `migration_relation` and `cron_relation` remained `null`. Deactivation preserved historical answer/score integrity and was not physical deletion. This records completed candidate-visible publication, but not Vercel import-client deployment or overall hosted deployment/readiness; the next content operation remains separately approval-gated and forward-only.

## Verification evidence — 25–26 August 2026

| Gate | Result |
|---|---|
| Unit and contract tests | 35 Node tests passed |
| Vitest | 213 passed; mutating integration suites are not part of the default command |
| Node coverage | 98.52% lines, 84.63% branches, 98.82% functions |
| Vitest coverage | 95.95% lines, 87.24% branches, 97.27% functions |
| Default-suite isolation | Full tests and coverage passed with fake hosted-looking `SUPABASE_TEST_*` values without collecting an integration test or contacting Supabase |
| Mutating-suite guard | With all mutation prerequisites removed, `npm run test:integration:mutating` exited 1 during global setup before running tests |
| TypeScript | `npm run typecheck` passed, including the Edge handler configuration |
| Production export | `npm run build` passed; static output in `dist/` |
| Isolated browser E2E | 4/4 fully intercepted local Playwright tests passed, including station-overlap geometry and Profile → `/admin/questions` direct routing |
| Empty-database SQL proof | All 13 versioned migrations, including now-hosted import-capability migration `050`, applied in order to a fresh disposable local stack; post-apply feedback/import table/RPC ACLs and RLS matched the fail-closed contract |
| Observed-catalog contract proof | A fresh unlinked local clone reproduced every hosted catalog fact consumed by the scripts: empty migration history; two legacy questions/four config rows; exact four hosted `app_config` policies; nine required RLS tables; legacy role-play shape; seven browser-readable assessor tables; and no preview objects. Reconciliation, additive migrations `000`/`010`/`020`, and revised cutover `040` (`SHA-256 123406ce32d2f211d90095ff57d56d80e7efa9dad5c6413481e9898d4049f493`) all passed without changing row counts. Effective service access on the four legacy tables moved from 16/44 privilege checks before cutover to 0/44 afterward. This is contract-level evidence, not a byte-for-byte hosted dump. |
| Read-only snapshot script | Syntax-executed on the disposable clone after secret-safe Cron redaction and total grant ordering. Its SHA-256 was `1616486887c9d71544af75b18dc5814816f9d6f02e54b93fe742b29343389878`; two immediate runs returned the same timestamp-independent catalog MD5 `824a914fc63f810737e57eafbc2e9bf5`. Local migration history had zero rows and no Cron relation. |
| Edge-runtime smoke | Passed on fresh unlinked local Supabase: Edge Runtime 1.74.3 / Deno 2.1.4; preflight 204; missing JWT 401; disallowed origin 403 without reflection; wrong method 405; invalid media type 415; oversized body 413; AI-key status/replacement/status 200; student-safe question read and owned session insert succeeded; provider failure returned safe 502 `provider_failed`. After the revised service-role cutover, the scoring path again returned safe 502, persisted one failed claim/attempt, released the lease, and wrote zero answers/scores despite zero direct service privilege on the four legacy tables. |
| Browser data isolation | Local app host enforced; only `e2e.supabase.co` is intercepted and every other `*.supabase.co` request fails closed; no production/shared credentials or rows used |
| Mobile login accessibility | Lighthouse accessibility 100; best practices 100 |
| Visual review | Desktop and 390px login/legal renders inspected |
| Impeccable detector | One final invocation returned `[]` |
| `$un-vibecode` | PASS across R01–R22 |
| Independent readiness audits | The prior readiness audit and the follow-up independent read-only audit of this diff are closed with no unresolved Critical or High finding in their respective reviewed scopes. Hosted `040`, `050`, and exact part-1/part-2 content imports are complete; any next content operation remains separately hard-gated and forward-only. |
| Residual release follow-ups | Medium: the existing 10 Expo configuration-chain advisories and the wider-release CI/CD/analytics operational gate. Low: malformed CSV structural quoting/extra cells, distinct concurrent source-correction last-writer-wins behavior requiring operator serialization, and optional function-body hash pinning against privileged out-of-band replacement. These are not fixed by this diff. |
| Dependency audit | Before SDK-55 patch alignment: 27 total, including 17 high. After alignment and a non-force audit fix: 10 moderate, 0 high, 0 critical. `npm audit fix --force` was not used and is not advised; the remaining Expo config/xcode/uuid chain has no safe non-breaking audit remedy. Expo dependency checking and `npm ls` are clean. |

Most verification evidence above is local. The import-idempotency database capability and both separately approved workbook content batches are hosted as active candidate-visible rows, but its Vercel client workflow is not deployed; any next content operation remains separately exact-approval-gated and forward-only. The separately evidenced UI routing fix, direct-provider scoring fix, and dependency alignment are live as described above.

## Remaining P0 blockers before showing cofounders

- [x] Disable **Allow new users to sign up** in Supabase Auth and verify `disable_signup=true`; email sign-in remains available to existing named users.
- [x] Confirm anonymous sign-in is disabled.
- [x] The prior independent readiness audit and follow-up independent read-only audit of this diff are closed with no unresolved Critical/High finding for their reviewed scopes. Residual Medium/Low release follow-ups remain documented above; hosted `040`, `050`, and exact part-1/part-2 imports are complete, while any next content operation remains separately hard-gated and forward-only.
- [x] Stage the hosted-only reconciliation, three additive preview migrations, and final privilege cutover with fail-closed catalog/ACL checks.
- [x] Independent static database review reports no blocking finding after exact ownership-policy repair.
- [x] Run the complete versioned migration chain from an empty isolated local Supabase database and verify effective ACL/RLS postconditions.
- [x] Prove every consumed hosted-catalog contract through the hosted-only reconciliation and subsequent additive/cutover stages in an isolated clone; no production/shared credential was used. A byte-for-byte dump was unavailable, so the fresh hosted snapshot remains a separate gate.
- [x] Take a fresh read-only hosted catalog snapshot immediately before deployment and compare it with the scripts' exact preconditions. Completed `2026-08-25 05:59:23.339506 UTC`, catalog MD5 `0811d9d73c003ea1daba2efd2058c136`; no migration/Cron follow-up was applicable.
- [x] The earlier, separately approved hosted-only reconciliation was applied outside `db push`.
- [x] The earlier, separately approved additive migrations `20260825000000`, `20260825001000`, and `20260825002000` were applied. The separately approved migration `20260825004000` was applied on 26 August 2026 with the recorded postflight evidence above.
- [x] The reviewed JWT-verified `score-answer` Edge function is v4 ACTIVE and `manage-ai-key` remains v3. The direct-provider scoring fix is live in v4, but a post-v4 hosted scoring-success smoke remains unverified.
- [x] Exact `APP_ALLOWED_ORIGINS` for the stable Vercel origin and provider/model/key configuration were earlier completed through the server-only workflow. The previously recorded hosted `openai`/`gpt-4o-mini` smoke returned `provider_failed`; do not treat it as post-v4 success evidence.
- [x] Run the required local Supabase Edge-runtime smoke for allowed/disallowed origins, preflight, JWT, methods, content type, body limits, provider failure, and safe errors.
- [x] Migration `20260825004000` was separately approved and applied on 26 August 2026; its recorded Management API preflight/apply/postflight evidence confirms the required ACL, function, trigger, row-count, and unchanged-default-ACL postconditions.
- [x] Migration `20260825005000` was separately approved and applied on 26 August 2026; its recorded Management API preflight/apply/postflight evidence confirms provenance, ledger, RPC, ACL, unchanged-row, and unchanged-default-ACL postconditions. Both workbook batches are complete as separately approved; any next content operation remains its own exact approval-gated, forward-only operation.
- [x] The separately approved part-1 and part-2 workbook batches were imported on 26 August 2026 through one authenticated-admin RPC transaction each, then separately published by activating all 785 imported rows and deactivating—not deleting—the two legacy rows. The final recorded postflight confirms candidate-visible active total 785, two unchanged ledgers, historical legacy answer/score references, closed direct ACLs, and all expected source IDs. This does not deploy the Vercel import client or establish overall hosted readiness.
- [ ] Put the two public variables in Vercel **Preview and Production**, then create a new deployment:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY` containing the `sb_publishable_...` value
- [ ] The stable Vercel production alias is live at `https://mmi-hazel.vercel.app` from commit `dd0c60b2e6a18bac3494a26a494b1d06a88b2249`; the client import workflow is not part of it. Confirm SPA deep-link rewriting and retain a hardened-compatible rollback deployment before any further promotion.
- [ ] Create/invite only named cofounders and grant admin/content access through exact approved profile operations.
- [ ] Execute one bounded hosted smoke with named accounts only after the database/functions/configuration are approved and deployed.
- [ ] Obtain qualified legal review of the operator identity, contact, legal bases, transfers, retention, and final Terms/Privacy wording before anyone outside the founding team joins.

## Approval-gated Supabase sequence

Each stage is a separate approval. A previous approval does not authorize the next stage.

1. **Auth setting — complete:** new-user signup is disabled; no user row was deleted or edited.
2. **Fresh read-only audit — complete:** `supabase/reconciliation/20260825_hosted_catalog_snapshot.sql` returned at `2026-08-25 05:59:23.339506 UTC` with catalog MD5 `0811d9d73c003ea1daba2efd2058c136`. The exact staged preconditions were compared; both `migration_relation` and `cron_relation` were `null`, so no conditional follow-up ran. The operation was SELECT-only and did not mutate hosted Supabase. Retain the JSON/MD5 as release evidence; Cron command evidence, if a future snapshot exposes it, is digest/length only.
3. **Hosted-only reconciliation — complete:** the separately approved `supabase/reconciliation/20260825_cofounder_preview_security.sql` was applied outside `db push`.
4. **Additive preview objects — complete:** the separately approved migrations `20260825000000`, `20260825001000`, and `20260825002000` were applied.
5. **Read-only verification:** prove the expected tables, functions, RLS, owners, search paths, and ACLs before deploying clients.
6. **Edge deployment — complete:** `score-answer` is v4 ACTIVE and `manage-ai-key` remains v3. The direct-provider scoring fix is live; a post-v4 hosted scoring-success smoke remains unverified. The previously recorded hosted `openai`/`gpt-4o-mini` smoke returned `provider_failed` and is not post-v4 success evidence.
7. **Secrets/config:** present only variable names, target function, and change intent—never values.
8. **Hardened client smoke:** the stable production alias is live at `https://mmi-hazel.vercel.app` from `dd0c60b2e6a18bac3494a26a494b1d06a88b2249`; the client import workflow is not included. Exercise safe RPC/Edge paths with named accounts before another promotion.
9. **Final privilege cutover — complete:** the separately approved `supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql` (SHA-256 `123406ce32d2f211d90095ff57d56d80e7efa9dad5c6413481e9898d4049f493`) was applied on 26 August 2026 through Management API `database/query`; retain the recorded read-only postflight evidence.
10. **Retry-safe import migration — complete:** the separately approved `supabase/migrations/20260825005000_cofounder_question_import_idempotency.sql` (SHA-256 `f9f0c7bd5256327e447998d3549093febcdb60cc32e7ee34b56c9ff7d06596c8`) was applied on 26 August 2026 through Management API `database/query` with response `[]`; it added provenance/ledger/RPC only and performed no content import. Retain the recorded read-only postflight evidence.
11. **Workbook content publication — complete; next content step — pending:** the separately approved part-1 and part-2 RPCs imported all 785 rows from the exact artifacts and source-manifest/workbook SHA recorded above, then the separately approved publication transaction activated all 785 imported rows and deactivated—not deleted—the two exact legacy rows. The later read-only postflight proved candidate-visible active total 785, imported count/active/distinct IDs 785, unchanged ledgers, preserved legacy answer/score references, and closed direct runtime ACLs. This does not deploy the Vercel client or establish overall hosted readiness. Any next hosted content operation requires a new exact approval and must be forward-only: never delete imported rows or retry with altered content/a changed batch ID.
12. **Named accounts/roles and hosted smoke:** present each target and every expected bounded write before running it.

Never mark a migration applied until its complete reviewed effect is present. Never use the historical Phase 4 migration set to shortcut preview reconciliation.

## Vercel deployment contract

- Framework preset: Other.
- Install command: `npm ci` or Vercel default.
- Build command: `npm run build`.
- Output directory: `dist`.
- Client variables: the project URL and publishable key only.
- A local `.env` is ignored by Git and does not configure Vercel.
- Environment-variable changes require a new deployment because Expo inlines `EXPO_PUBLIC_*` values during the build.
- Use the stable Vercel URL in Supabase Site URL/redirect configuration and the Edge origin allowlist.
- The pre-redesign branch is a visual/source backup, not automatically a deployment rollback. After backend privileges are revoked, an older client is safe only if it has been verified against the hardened server contract.
- Preserve a hardened-compatible Vercel deployment before cutover and use server-side scoring disablement as the immediate kill switch; database rollback is forward-fix only.

## Cofounder go/no-go script

- [ ] Named tester signs in and completes onboarding.
- [ ] Public API signup is rejected; `/signup` shows the invitation-only notice.
- [ ] Same-tab refresh restores auth; explicit sign-out returns to login; a new browser session starts signed out.
- [ ] Every visible Back action and protected deep link reaches a safe destination.
- [ ] Ethics and Motivation are available; the four empty categories are visibly unavailable.
- [ ] Practice start, refresh restoration, validation, scoring, failure recovery, feedback, and progress work once each.
- [ ] A retry does not create a duplicate logical submission or paid provider call.
- [ ] An ordinary tester cannot invoke admin, question-write, feedback-read, AI-key, or cross-user operations.
- [ ] An authorized founder creates a draft single question and previews a CSV without ambiguous column mapping.
- [ ] Student responses exclude inactive/draft content, guidance, model answers, actor context, rubrics, and future prompts.
- [ ] Feedback submission stores no screenshot, token, answer, transcript, or browser log.
- [ ] Allowed origin succeeds; disallowed origin and invalid/absent JWT fail safely.
- [ ] Chrome, Safari, Firefox, mobile width, keyboard-only, focus, and reduced-motion checks have dated evidence.
- [x] Edge-runtime smoke and the independent security review are complete.
- [ ] Rollback owner can restore a hardened-compatible Vercel deployment and disable scoring; the owner does not rely on the archival pre-redesign client after privilege revocation.

## Release decision

Do not show the hosted preview to cofounders while any P0 item is unresolved. Local tests prove the proposed code; they do not repair the current hosted policy/function drift.
