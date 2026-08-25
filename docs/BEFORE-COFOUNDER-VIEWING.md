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

## Read-only hosted facts — 25 August 2026

- The remote migration-history table contains none of the local migration versions even though an early schema was manually/partially applied.
- Hosted legacy content contains two active questions: one Ethics and one Motivation. Four categories are empty.
- `app_config` contains provider/model rows; `ai_api_key` and `ai_base_url` were not configured when last inspected.
- `pg_trgm` and `uuid-ossp` are installed; `on_auth_user_created` is enabled.
- Public signup was disabled by the project owner and verified read-only on 25 August 2026: Auth settings returned `disable_signup=true`; email sign-in remains enabled, anonymous sign-ins remain disabled, and email confirmation remains enabled.
- The public Supabase project endpoint is reachable. The prior browser `NetworkError` was a missing or stale client environment configuration, not an outage.
- Hosted policies still expose assessor-bearing MMI/role-play content to authenticated users, allow unsafe legacy question fields, permit cross-user `update_streak`, and permit own-answer score insertion.
- No migration, function deployment, secret update, user/profile mutation, or application-row mutation was performed during this implementation.

## Implemented locally

### Interface and navigation

- [x] Replaced the prior competitor-adjacent visual world with the researched station-corridor system.
- [x] Added a responsive square-geometry component system, accessible labelled controls, explicit state copy, and no emoji navigation.
- [x] Added deterministic back navigation with safe deep-link fallbacks.
- [x] Replaced React Native Web `Alert.alert()` flows with rendered confirmation and notice components.
- [x] Added substantive, reachable Terms and Privacy screens labelled for legal review.
- [x] Preserved the legacy `/signup` route as an invitation-only notice with no `auth.signUp()` call.
- [x] Added a final UI policy test covering legal reachability, invitation-only signup, shadows, and stock left-strip treatments.

### Authentication and practice reliability

- [x] Web auth uses guarded `sessionStorage`; refresh in the same tab can restore a session while a new browser session starts without a retained login.
- [x] Sign-out checks the Supabase result, clears local state, and returns to login with retryable feedback on failure.
- [x] Sign-out and account changes clear all account-bound practice state; every in-flight session, restoration, scoring, and progress operation is epoch-bound so an old account cannot repopulate a new account's store or continue navigation.
- [x] Practice availability comes from active server projections rather than a hard-coded default question.
- [x] Empty categories are unavailable and route restoration validates the owned session/question identity.
- [x] Submission shows validation, scoring, retry, saved, and provider-failure states instead of becoming inert.
- [x] A feedback deep link from another account/browser session renders a neutral unavailable state with no prior answer or feedback text, then lets the user explicitly return to Practice.

### Server-owned legacy scoring

- [x] The client no longer inserts authoritative answers/scores, updates session totals, or invokes arbitrary streak mutations.
- [x] The authenticated Edge path loads server-owned state and applies body bounds, durable rate limiting, idempotency, a lease, safe provider errors, and atomic persistence.
- [x] Provider handling retains exact host/origin allowlists, HTTPS, DNS/private-network rejection, redirect rejection, timeouts, strict schema validation, and secret-safe errors.
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
- [x] No staged SQL has been executed against hosted or local Supabase.

## Verification evidence — 25 August 2026

| Gate | Result |
|---|---|
| Unit and contract tests | 35 Node tests passed |
| Vitest | 177 passed; mutating integration suites are not part of the default command |
| Node coverage | 98.52% lines, 84.63% branches, 98.82% functions |
| Vitest coverage | 94.42% lines, 89.47% statements, 85.26% branches, 96.80% functions |
| Default-suite isolation | Full tests and coverage passed with fake hosted-looking `SUPABASE_TEST_*` values without collecting an integration test or contacting Supabase |
| Mutating-suite guard | With all mutation prerequisites removed, `npm run test:integration:mutating` exited 1 during global setup before running tests |
| TypeScript | `npm run typecheck` passed, including the Edge handler configuration |
| Production export | `npm run build` passed; static output in `dist/` |
| Isolated browser E2E | 2/2 passed: partner practice/feedback/signout/account-switch isolation and admin draft/review; the affected cross-account journey also passed 10/10 across three workers |
| Browser data isolation | Local app host enforced; only `e2e.supabase.co` is intercepted and every other `*.supabase.co` request fails closed; no production/shared credentials or rows used |
| Mobile login accessibility | Lighthouse accessibility 100; best practices 100 |
| Visual review | Desktop and 390px login/legal renders inspected |
| Impeccable detector | One final invocation returned `[]` |
| `$un-vibecode` | PASS across R01–R22 |
| Independent local security review | No Critical, High, Medium, or Low finding remains in the Edge-key and mutating-integration remediation |
| Independent database review | No blocking finding remains; one optional Low notes that function identity/configuration is verified but function bodies are not hash-pinned against privileged out-of-band replacement |
| Dependency audit | 27 total: 17 high, 9 moderate, 1 low; no critical; no force-fix attempted |

The Expo server also reports supported-version patch drift: Expo 55.0.8 expects 55.0.29, React Native 0.83.2 expects 0.83.10, several Expo packages expect newer SDK-55 patches, and `react-native-worklets` expects 0.7.4 rather than 0.8.3. Treat this as a reviewed compatibility upgrade, not a blind install.

## Remaining P0 blockers before showing cofounders

- [x] Disable **Allow new users to sign up** in Supabase Auth and verify `disable_signup=true`; email sign-in remains available to existing named users.
- [x] Confirm anonymous sign-in is disabled.
- [x] Independent local security audit reports no unresolved Critical/High finding after delayed account-switch regression testing.
- [x] Stage the hosted-only reconciliation, three additive preview migrations, and final privilege cutover with fail-closed catalog/ACL checks.
- [x] Independent static database review reports no blocking finding after exact ownership-policy repair.
- [ ] Run the staged SQL from empty and observed-legacy states in an isolated local/disposable Supabase database; do not use production/shared credentials.
- [ ] Take a fresh read-only hosted catalog snapshot immediately before deployment and compare it with the scripts' exact preconditions.
- [ ] Separately approve and apply the hosted-only reconciliation; do not use `db push` for it.
- [ ] Separately approve and apply additive migrations `20260825000000` through `20260825002000`, then verify the created objects and ACLs read-only.
- [ ] Separately approve deployment of the reviewed JWT-verified preview Edge function(s).
- [ ] Configure exact `APP_ALLOWED_ORIGINS` for the stable Vercel origin and configure the provider/model/key through a server-only workflow.
- [ ] Run the required local Supabase Edge-runtime smoke for allowed/disallowed origins, preflight, JWT, methods, content type, body limits, provider failure, and safe errors.
- [ ] After the hardened Edge functions and Vercel client pass smoke testing, separately approve final privilege cutover `20260825004000` and verify its postconditions read-only.
- [ ] Put the two public variables in Vercel **Preview and Production**, then create a new deployment:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY` containing the `sb_publishable_...` value
- [ ] Confirm the Vercel deployment has SPA deep-link rewriting and retains the previous deployment for rollback.
- [ ] Create/invite only named cofounders and grant admin/content access through exact approved profile operations.
- [ ] Execute one bounded hosted smoke with named accounts only after the database/functions/configuration are approved and deployed.
- [ ] Obtain qualified legal review of the operator identity, contact, legal bases, transfers, retention, and final Terms/Privacy wording before anyone outside the founding team joins.

## Approval-gated Supabase sequence

Each stage is a separate approval. A previous approval does not authorize the next stage.

1. **Auth setting — complete:** new-user signup is disabled; no user row was deleted or edited.
2. **Fresh read-only audit:** catalog, exact RLS definitions, functions, table/column/function grants, triggers, extensions, migration history, and Cron state.
3. **Hosted-only reconciliation:** separately present and approve `supabase/reconciliation/20260825_cofounder_preview_security.sql`; never run it through `db push`.
4. **Additive preview objects:** separately present and approve migrations `20260825000000`, `20260825001000`, and `20260825002000` only.
5. **Read-only verification:** prove the expected tables, functions, RLS, owners, search paths, and ACLs before deploying clients.
6. **Edge deployment:** present the exact function names (`score-answer`, `manage-ai-key`) and CLI commands.
7. **Secrets/config:** present only variable names, target function, and change intent—never values.
8. **Hardened client smoke:** deploy the Vercel build while legacy browser grants still exist, then exercise its safe RPC/Edge paths with named accounts.
9. **Final privilege cutover:** separately present and approve `20260825004000`, then verify all table, column, policy, and function postconditions read-only.
10. **Named accounts/roles and hosted smoke:** present each target and every expected bounded write before running it.

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
- [ ] Edge-runtime smoke and the independent security review are complete.
- [ ] Rollback owner can restore a hardened-compatible Vercel deployment and disable scoring; the owner does not rely on the archival pre-redesign client after privilege revocation.

## Release decision

Do not show the hosted preview to cofounders while any P0 item is unresolved. Local tests prove the proposed code; they do not repair the current hosted policy/function drift.
