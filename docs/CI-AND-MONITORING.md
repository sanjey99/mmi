# CI and monitoring

## Application verification

`.github/workflows/ci.yml` runs on pull requests, every push (including `main`), and manual dispatch. Its stable check name is **Application verification** in the **CI** workflow. The job installs the lockfile, runs unit and contract tests, checks application and Edge Function types, proves the operations migration's database permissions in a disposable PostgreSQL cluster, exports the web application, and runs Chromium checks against that exported application.

CI uses only `https://e2e.supabase.co` and a synthetic publishable key. The CI browser configuration requires that exact configuration, uses a fixed localhost server, and runs the existing mocked browser scenarios. Database writes occur only in the disposable local SQL proof. The workflow has read-only repository permissions and no production secrets; it makes no hosted deployments. Browser traces, screenshots, state, and bundles are not uploaded as artifacts.

`scripts/test-operations-sql.mjs` applies the operations migration only inside a newly created private Unix-socket PostgreSQL cluster, verifies its isolated proof database and marker, runs the security assertions, and removes the cluster afterward. It accepts no shared database URL and exposes no TCP listener. CI uses PostgreSQL 16 already included in the [Ubuntu 24.04 runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), without starting the image's system database service. For a local run, install PostgreSQL and use `PG_BIN=/path/to/postgresql/bin node scripts/test-operations-sql.mjs`.

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

The intended production gate is the existing Vercel Git integration with **Application verification** selected as a required [Deployment Check](https://vercel.com/docs/deployment-checks). Configure the equivalent required GitHub check for the protected default branch, require reviewed pull requests, and keep bypass permissions limited. These are hosted settings; adding this workflow alone does not enable them. No deployment token or deploy hook is needed in GitHub Actions.

Verify the project is linked through Vercel for GitHub and production automatic aliasing is enabled, then choose **GitHub** as the Deployment Checks provider. The existing push-triggered check can be used directly; it does not need an additional status-reporting action. Keep the job name stable after configuring the gate.

Keep **Public health** out of the required deployment checks: it inspects the deployment already serving users and would otherwise make a new release depend on the old deployment's health. Database migrations and Edge Function releases still require their own reviewed rollout; this workflow does not deploy them.

## Read-only public monitoring

`.github/workflows/monitoring.yml` runs at minutes 7, 22, 37, and 52 of each hour and supports manual dispatch. It stays visibly disabled until the repository variable `MMI_MONITORING_ENABLED` is exactly `true`.

Configure these repository settings after deploying the health endpoint:

| Setting | Kind | Value |
| --- | --- | --- |
| `MMI_HEALTH_URL` | Actions variable | `https://<20 lowercase letters or digits>.supabase.co/functions/v1/operations-health` |
| `MMI_MONITOR_TOKEN` | Actions secret | The same dedicated 64-character hexadecimal read-only monitor token configured for the Edge Function |
| `MMI_MONITORING_ENABLED` | Actions variable | `true` to enable; another value disables monitoring |

The backend probe sends one authenticated GET to that exact endpoint. It rejects alternate hosts, credentials in URLs, ports, query strings, fragments, and redirects before forwarding the token. The response is bounded and must contain only the documented overall status and database, retention, scoring, and runtime checks. The token is scoped to the health request, never supplied to page JavaScript or the browser process, and never printed.

The separate production browser probe loads the real `https://mmi-hazel.vercel.app/login` page in a fresh Chromium context. It verifies the visible brand, editable email/password fields, and enabled sign-in button. It submits no form, creates no account, and reads no candidate data. Browser-context guards cover every page, including popup first requests, and allow only GET/HEAD requests to that fixed app origin. They fetch real responses with redirects disabled before delivering them to the browser, rejecting redirect responses; writes, external requests, WebSockets, and service workers are blocked. It supplies no synthetic response fixtures. There are no screenshots, recordings, traces, console captures, or uploaded artifacts.

The probes make no AI provider calls. They use existing Vercel and Supabase request quotas and add no paid monitoring or email service. Standard GitHub-hosted runners are [free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions); a future change to repository visibility or runner type needs a fresh cost review.

## Failure email and diagnosis

Watch the repository and enable **Email** plus **Only notify for failed workflows** in GitHub's [Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications). The destination is the email associated with the GitHub account's notification preferences. The workflow does not send mail through the application or Supabase.

To verify delivery after merging the workflow, manually run **Public health monitor** with **test_alert** enabled. This runs only **Alert delivery test**, prints `ALERT_DELIVERY_TEST`, and deliberately exits with failure so GitHub can send its normal failed-workflow email. The health and configuration jobs are skipped; the test uses no credentials and makes no application or Supabase calls. This failure is expected. Confirm the email arrived, then leave **test_alert** disabled for normal manual health checks. Scheduled checks never run the delivery test.

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

The new backend operation is the exact additive migration `20261020000000_operations_monitoring.sql`. Review its prerequisites against the approved shared Supabase project `tliwifhnsytxpcynuwsy`; the older hosted/repository migration histories diverge, so do not run the entire baseline or repair migration history as a shortcut. Before applying it, verify required columns and functions, UTC cron settings, the unchanged active transcript-purge job, absence of the new objects/cleanup job, and absence of this version from the migration ledger. After applying it, verify the new function grants, private-table boundary, aggregate RPC shape, and new cleanup job without selecting candidate content.

`app_runtime_hourly_counters` has RLS and no direct table grants, including for `service_role`. `record_app_runtime_event(p_kind,p_area)` is available only to authenticated accounts, derives the account from Auth, accepts three fixed event kinds and nine broad screen areas, and returns no payload. `get_mmi_operations_dashboard(p_testers_only)` permits verified administrators or the service role and returns aggregates only. The default cohort excludes administrators; retention checks cover all accounts regardless of cohort. Existing transcript-purge code, scheduling, and private-table grants are preserved.

Deploy `operations-health` after the migration. Its GET handler uses a dedicated lowercase 64-character hexadecimal `MMI_MONITOR_TOKEN` Edge secret, shared only with the Actions secret. Gateway JWT checking is disabled only for this function because this credential is a dedicated monitor token; the handler verifies it before querying private data. Missing/invalid configuration fails closed. The response exposes only `ok` and four `ok`/`failing` states, with no account data, counts, provider settings, keys, or raw exceptions. Backend reads time out after eight seconds. Deployment, token configuration, workflow activation, and verified notification delivery are separate checks; local tests alone do not establish them.

The protected **Admin → Operations and analytics** screen shows seven UTC calendar dates including partial today, with the period ending at `checkedAt`. “Practising users” means accounts starting a station, not all logins or page visitors. A finished station requires all five responses finalized, including legitimate no-response outcomes; elapsed time alone does not count. Provider statistics cover recorded usage events during the period; pending/failed/expired work is the current backlog across all dates. Provider latency excludes other request stages, and unknown cost stays unknown. The configuration flag validates default-provider settings only; it does not prove that a key, model, network, or paid inference works. Usage recording can itself fail during a database outage, which is why the independent probe is needed.

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
