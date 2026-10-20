# CI and monitoring

Updated 20 October 2026 (Singapore time).

## Verified release and activation

[PR #16](https://github.com/sanjey99/mmi/pull/16) merged implementation `13c86e10580060b71daabe5312e6fea2bb6c0667` as main `cf15987decc027aee2a69c425f76fceb19fc6864`. Both PR CI runs and [main CI](https://github.com/sanjey99/mmi/actions/runs/39440640343) passed. Current validation includes 817 unit/contract checks (54 Node and 763 Vitest), 64 browser cases, 10 monitor checks, both disposable SQL proofs, type checking, and the production build.

The main production release is READY deployment `dpl_8snnxuW2FphhCTZ27agL8xjvQ2G3`, [immutable build](https://mmi-kcxhp7sws-sanjey99s-projects.vercel.app); the canonical `mmi-hazel.vercel.app` alias was verified with the new signup UI. Comparison build `dpl_Efw8AE3A3tYGfcCTnSm8ZHrb1UeR` is READY at its [immutable URL](https://mmi-88tmska66-sanjey99s-projects.vercel.app), source `13c86e1`, ref `experiment/gpt-5-5`; `mmi-gpt55.vercel.app` is assigned and its new signup UI was verified.

On the approved shared Supabase backend, the operations migration is installed with SHA-256 `277d4e7121ddd835ab4d71dddaa5d87cc12b5063bcc0d6d598bbfd57250bf33b`, and the public-scoring allowance migration with SHA-256 `536a7c151f6827dc9370708961f868b26a0bfbe10b448f74ab773f73c69a0817`. Ledger/source, private ACLs, allowance defaults, self-only allowance RPC, and cleanup jobs were verified. Deployed `operations-health` returned HTTP 200 with all four checks OK. A later metadata read found active revisions 19 for `score-answer`, 23 for `score-candidate-mmi-response` (both JWT verified), and 2 for `operations-health` (its own scoped token). All eight downloaded candidate-scorer source files matched the tested repository byte for byte. Revision numbers may advance on redeployment; the candidate scorer source is unchanged and the legacy administrator guard is deployed.

Monitoring repository variables and a new restricted token in both Actions and Supabase secrets are configured. The [manual health run](https://github.com/sanjey99/mmi/actions/runs/39440812953) reported `MONITOR_OK` at 22:37:32 Singapore (14:37:32 UTC). The [intentional alert-delivery test](https://github.com/sanjey99/mmi/actions/runs/39440938938) reported `ALERT_DELIVERY_TEST` and failed as designed at 22:37:47 Singapore (14:37:47 UTC), with health probes skipped. **Actual notification-email receipt is awaiting user confirmation.** The manual pass does not establish that a scheduled run or its email has occurred.

## Application verification

`.github/workflows/ci.yml` runs on pull requests, every push (including `main`), and manual dispatch. Its stable check name is **Application verification** in the **CI** workflow. The job installs the lockfile, runs unit and contract tests, checks application and Edge Function types, proves both migrations' database permissions and concurrency controls in disposable PostgreSQL clusters, exports the web application, and runs Chromium checks against that exported application.

CI uses only `https://e2e.supabase.co` and a synthetic publishable key. The CI browser configuration requires that exact configuration, uses a fixed localhost server, and runs the existing mocked browser scenarios. Database writes occur only in the disposable local SQL proof. The workflow has read-only repository permissions and no production secrets; it makes no hosted deployments. Browser traces, screenshots, state, and bundles are not uploaded as artifacts.

`scripts/test-operations-sql.mjs` applies the operations migration only inside a newly created private Unix-socket PostgreSQL cluster, verifies its isolated proof database and marker, runs the security assertions, and removes the cluster afterward. It accepts no shared database URL and exposes no TCP listener. CI uses PostgreSQL 16 already included in the [Ubuntu 24.04 runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), without starting the image's system database service. For a local run, install PostgreSQL and use `PG_BIN=/path/to/postgresql/bin node scripts/test-operations-sql.mjs`.

The next CI step runs `node scripts/test-public-scoring-sql.mjs` with the same PostgreSQL 16 binary directory. It creates a separate marked local cluster, applies the reviewed allowance migration over the exact prior claim body, and verifies private grants, own-account access, retained terminal/retry behavior, daily resets, pause/cost controls, cleanup, and simultaneous admission bounds. It also accepts no hosted connection configuration. See [Public access limits](PUBLIC-ACCESS.md) for the limits and proof assumptions.

To reproduce the browser portion locally after installing dependencies:

```sh
export CI=true EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1
export EXPO_PUBLIC_SUPABASE_URL=https://e2e.supabase.co
export EXPO_PUBLIC_SUPABASE_ANON_KEY=synthetic-publishable-key
export EXPO_PUBLIC_AI_MODEL_PROFILE=default
npm run build
npx playwright install chromium
npm run test:e2e -- --config=playwright.ci.config.ts
```

The workflow uses immutable commits from the official [checkout v6.0.2](https://github.com/actions/checkout/releases/tag/v6.0.2) and [setup-node v6.1.0](https://github.com/actions/setup-node/releases/tag/v6.1.0) releases. Update these pins deliberately when maintaining the workflow.

## Deployment gate

The Vercel production [Deployment Check](https://vercel.com/docs/deployment-checks) is configured for **Application verification**, gate `chk_e6671c79-e2be-451e-a896-b2647953b5a0`. Main branch protection requires that check from GitHub Actions integration `15368`, strict up-to-date checks, administrator enforcement, and a pull request. The sole-owner configuration requires zero approval reviews; it does not establish independent human review. No deployment token or deploy hook is needed in GitHub Actions.

The main deployment's check run `ckr_d95c8b3c-2ea9-4f14-b167-23b090f2c05e` was reread through the Vercel API: **Application verification** was completed/succeeded, blocked `deployment-alias`, and linked to the [passing main CI job](https://github.com/sanjey99/mmi/actions/runs/39440640343/job/118689224585). This verifies the gate was used for this production release rather than only saved as configuration.

When maintaining the gate, preserve the existing Vercel GitHub integration, required check source/name, and automatic production alias behavior. The push-triggered check is used directly and needs no additional status-reporting action. Reverify hosted settings after changing workflow names, project linkage, or branch protection.

Keep **Public health** out of the required deployment checks: it inspects the deployment already serving users and would otherwise make a new release depend on the old deployment's health. Database migrations and Edge Function releases still require their own reviewed rollout; this workflow does not deploy them.

## Read-only public monitoring

`.github/workflows/monitoring.yml` runs at minutes 7, 22, 37, and 52 of each hour and supports manual dispatch. It stays visibly disabled until the repository variable `MMI_MONITORING_ENABLED` is exactly `true`.

These repository settings are configured for the deployed health endpoint; preserve them without placing token values in documentation:

| Setting | Kind | Value |
| --- | --- | --- |
| `MMI_HEALTH_URL` | Actions variable | `https://tliwifhnsytxpcynuwsy.supabase.co/functions/v1/operations-health` |
| `MMI_MONITOR_TOKEN` | Actions secret | The same dedicated 64-character hexadecimal read-only monitor token configured for the Edge Function |
| `MMI_MONITORING_ENABLED` | Actions variable | `true` to enable; another value disables monitoring |

The backend probe sends one authenticated GET to that exact endpoint. It rejects alternate hosts, credentials in URLs, ports, query strings, fragments, and redirects before forwarding the token. The response is bounded and must contain only the documented overall status and database, retention, scoring, and runtime checks. The token is scoped to the health request, never supplied to page JavaScript or the browser process, and never printed.

The separate production browser probe loads the real `https://mmi-hazel.vercel.app/login` page in a fresh Chromium context. It verifies the visible brand, editable email/password fields, and enabled sign-in button. It submits no form, creates no account, and reads no candidate data. Browser-context guards cover every page, including popup first requests, and allow only GET/HEAD requests to that fixed app origin. They fetch real responses with redirects disabled before delivering them to the browser, rejecting redirect responses; writes, external requests, WebSockets, and service workers are blocked. It supplies no synthetic response fixtures. There are no screenshots, recordings, traces, console captures, or uploaded artifacts.

The probes make no AI provider calls. They use existing Vercel and Supabase request quotas and add no paid monitoring or email service. Standard GitHub-hosted runners are [free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions); a future change to repository visibility or runner type needs a fresh cost review.

## Failure email and diagnosis

Watch the repository and enable **Email** plus **Only notify for failed workflows** in GitHub's [Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications). The destination is the email associated with the GitHub account's notification preferences. The workflow does not send mail through the application or Supabase.

To verify delivery, manually run **Public health monitor** with **test_alert** enabled. This runs only **Alert delivery test**, prints `ALERT_DELIVERY_TEST`, and deliberately exits with failure so GitHub can send its normal failed-workflow email. The health and configuration jobs are skipped; the test uses no credentials and makes no application or Supabase calls. This failure is expected. The recorded test above has run; actual receipt is still pending confirmation. Leave **test_alert** disabled for normal manual health checks. Scheduled checks never run the delivery test.

Successful probes print `MONITOR_OK`; failures exit nonzero and print only fixed codes:

| Code | Meaning |
| --- | --- |
| `MONITOR_CONFIGURATION_INVALID` | Missing or invalid endpoint/token configuration; no network probe starts |
| `HEALTH_HTTP_FAILED` | Health endpoint returned a status other than the expected 200 or 503; its body is not read |
| `HEALTH_REQUEST_FAILED` | Request timeout, redirect, or network failure |
| `HEALTH_CONTRACT_INVALID` | Health response is unreadable, oversized, unexpected, or contradicts its checks/HTTP status |
| `HEALTH_DATABASE_FAILING`, `HEALTH_RETENTION_FAILING`, `HEALTH_SCORING_FAILING`, `HEALTH_RUNTIME_FAILING` | The corresponding backend check reported failure |
| `PUBLIC_LOGIN_HTTP_FAILED` | Public login returned an unsuccessful page response |
| `PUBLIC_LOGIN_UI_FAILED` | Public browser startup, page load, or login form verification failed |
| `MONITOR_INTERNAL_FAILED` | Unexpected monitor failure, with details suppressed |

Open the failed **Public health** run to find the code, then inspect the relevant protected dashboard. Do not add raw response bodies, request URLs, tokens, candidate answers, or exception objects to workflow logs. Credential-boundary and failure-handling tests are in `tests/operationsMonitor.test.mjs`. The additional `tests/operationsMonitor.browser.test.mjs` uses local servers to prove redirects, popup POSTs, local POSTs, and WebSockets cannot escape the guard. Both workflows run these tests before the real public probe can receive credentials.

This is a periodic beta monitor, with no incident deduplication or recovery email. An ongoing fault can produce repeated failed runs and emails according to GitHub's notification behavior. GitHub schedules can be delayed or dropped, run only from the default branch, and are automatically disabled in public repositories after 60 days without repository activity. See [GitHub's schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Verify a manual run and actual failure-email delivery when enabling the monitor; this does not provide a guaranteed 15-minute alert deadline.

## Backend rollout and access

The exact additive migration `20261020000000_operations_monitoring.sql` is installed in the approved shared Supabase project `tliwifhnsytxpcynuwsy`, with the verified hash recorded above. Its reviewed preflight and postflight passed. The older hosted/repository migration histories diverge; do not rerun this migration, the entire baseline, or migration-history repair as a shortcut. Future corrective migrations need scoped prerequisites and checks of function grants, private-table boundaries, aggregate shape, cleanup jobs, and the unchanged transcript-purge job without selecting candidate content.

`app_runtime_hourly_counters` has RLS and no direct table grants, including for `service_role`. `record_app_runtime_event(p_kind,p_area)` is available only to authenticated accounts, derives the account from Auth, accepts three fixed event kinds and nine broad screen areas, and returns no payload. `get_mmi_operations_dashboard(p_testers_only)` permits verified administrators or the service role and returns aggregates only. The default cohort excludes administrators; retention checks cover all accounts regardless of cohort. Existing transcript-purge code, scheduling, and private-table grants are preserved.

`operations-health` is deployed after the migration. Its GET handler uses a dedicated lowercase 64-character hexadecimal `MMI_MONITOR_TOKEN` Edge secret, shared only with the Actions secret. Gateway JWT checking is disabled only for this function because this credential is a dedicated monitor token; the handler verifies it before querying private data. Missing/invalid configuration fails closed. The response exposes only `ok` and four `ok`/`failing` states, with no account data, counts, provider settings, keys, or raw exceptions. Backend reads time out after eight seconds. Deployment, token configuration, workflow activation, and a passing manual run are recorded; verified notification delivery remains a separate pending check.

The protected **Admin → Operations overview** screen shows seven UTC calendar dates including partial today, with the period ending at `checkedAt`. “Practising users” means accounts starting a station, not all logins or page visitors. A finished station requires all five responses finalized, including legitimate no-response outcomes; elapsed time alone does not count. Provider statistics cover recorded usage events during the period; pending/failed/expired work is the current backlog across all dates. Provider latency excludes other request stages, and unknown cost stays unknown. The configuration flag validates default-provider settings only; it does not prove that a key, model, network, or paid inference works. Usage recording can itself fail during a database outage, which is why the independent probe is needed.

## Health thresholds

| Check | Failing condition |
| --- | --- |
| Database | Aggregate RPC fails, times out, or returns unusable health inputs. All health states then fail closed. |
| Retention | Transcript-purge job inactive, missing heartbeat, heartbeat older than 900 seconds, or any full transcript/draft past the existing 23-hour-30-minute purge cutoff. |
| Scoring | Default configuration invalid; an in-progress response has a claim lease expired by more than two minutes; or the last 15 minutes contain at least three recorded failure outcomes and failures are at least 25% of recorded calls. |
| Runtime | At least one signed-in account has an accepted runtime event recorded in the last 15 minutes. |

Normal no-response results and polling/rate-limit states are not provider failures. Runtime checks use the last accepted event time rather than counting an entire hour as recent. A short incident between scheduled probes or after counter saturation can be missed; these are beta detection limits, not continuous availability guarantees.

## Runtime privacy and database proof

The browser observes unexpected errors, unhandled rejections, and the app's safe render-error boundary. It ignores the underlying event/error object and sends only fixed kind/area values after finding a signed-in session. It attempts at most four reports per minute per running browser reporter, drops concurrent reports, and does not buffer, retry, block the candidate, or log reporting failures. Account-link credentials are scrubbed before monitoring initializes. Signed-out errors are not ingested; the public browser probe checks the signed-out login separately. There is no session replay, advertising tracker, persistent browser identifier, error message/stack, URL, answer, or recording in these counters.

An advisory lock caps the sum across all permitted keys at 100 accepted events per account per UTC hour. The private counters retain seven full UTC days plus the current day, up to eight days while the new daily UTC cleanup is healthy. The dashboard displays only grouped counts. Account deletion cascades to its counters, so historical aggregate totals can change after deletion.

Run the repeatable database proof with `node scripts/test-operations-sql.mjs`, optionally setting `PG_BIN` to an installed PostgreSQL binary directory; otherwise it discovers that directory with `pg_config --bindir`. The runner ignores inherited PostgreSQL connection settings, creates its own marked database and private Unix socket, disables TCP, and cleans up only its own cluster. It never accepts or uses a hosted/shared database URL. The fixture refuses an unmarked, non-fresh, or TCP-connected target.

The proof executes the actual migration and verifies real SQL-role denials, administrator/service boundaries, fixed categories, UTC/cohort aggregates, configuration validation, five-finalization completion, recent windows, retention cutoffs/cleanup, and the original purge-job definition. Six concurrent writers submit 180 events across different keys and must accept exactly 100. The local fixture models the reviewed existing schema and cron API/catalog; it does not prove the hosted schema or execute the actual pg_cron scheduler. Complete the scoped hosted preflight and postflight separately.
