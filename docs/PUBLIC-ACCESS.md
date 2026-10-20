# Public access and scoring allowances

The owner approved real public registration for UK pre-university applicants, including younger pupils. There is no 18+ gate or date-of-birth collection in this release. These decisions supersede the earlier invitation-only/adult-only preview scope; they do not claim completed qualified legal review, a verified support mailbox, or email delivery to arbitrary outside addresses.

## Registration rollout

The registration screen accepts email and password and requires email confirmation. It uses a non-persistent signup client, sends no name/age/role metadata, and fails safely if the provider unexpectedly creates an immediate session. Confirmation resends happen only on the user's request, with client pacing. Preserve server-side email confirmation when enabling hosted signup; do not use auto-confirm as a delivery workaround.

Before broad access, configure an owner-approved custom SMTP sender and verify an actual signup confirmation, password sign-in, and password-reset journey to an authorized outside recipient. The built-in Supabase Auth mailer restricts recipients and has a low shared sending limit; the earlier single invitation receipt does not establish wider deliverability. Domain work remains paused, and buying a new domain is not required if an existing owner-controlled sender can be verified. Do not give testers Supabase/Vercel team roles to work around email restrictions.

Save the reviewed signup confirmation template and exact signup callback allowlist alongside the existing invitation/recovery callbacks. Keep secret credentials in hosted secret stores only. The current release evidence remains in `EXTERNAL-BETA-READINESS.md`; local implementation is not itself a deployed-source or received-email receipt.

## Default candidate-scoring allowances

Migration `20261020001000_public_scoring_allowances.sql` adds server-owned admission limits shared by the main and comparison candidate scorer:

| Control | Default |
| --- | --- |
| Distinct nonempty finalized responses newly admitted per account per UTC day | 10, approximately two fully answered five-question stations |
| New paid claim attempts per account per UTC day, including retries | 20 |
| New candidate paid claim attempts across all accounts per UTC day | 100 |
| Concurrent live candidate scoring claims across all accounts | 10 |
| Additional existing retry bound | Three paid attempts per response per rolling hour |
| Scoring pause | Off |
| Daily observed known-cost cutoff in USD | Unset (`NULL`); no dollar budget is selected |

All accounts, including administrators using the candidate comparison profile, share these candidate limits. Already-scored results and no-response outcomes remain reusable without another allowance charge. A response admitted previously can retry without consuming another distinct-response slot, including after UTC midnight, but each newly issued paid lease still consumes account/global attempts. Duplicate in-flight requests do not consume another lease or allowance.

These checks run atomically in the existing claim RPC before a new paid lease. A global advisory lock protects concurrent account and shared counters. Finalization, checkpoints, existing answers, and stored results remain available. A blocked claim returns the existing `rate_limited` shape and changes no answer/scoring state. Daily limits reset at UTC midnight; `Retry-After` remains bounded to at most one hour for compatibility. Concurrent-cap responses use 15 seconds. Existing clients retry automatically only for delays at most ten seconds, so these controls do not create an automatic paid retry loop.

`get_candidate_mmi_scoring_allowance()` is an authenticated, self-only snapshot with `checkedAt`, `resetsAt`, `responsesRemaining`, `attemptsRemaining`, `stationAllowanceRemaining`, `scoringPaused`, and `globalCapacityAvailable`. It accepts no account ID and exposes no costs or other-account counts. The full-station estimate is `floor(responsesRemaining / 5)`; the interface also checks available attempts. It is guidance before practice, not a capacity reservation: another device or account can consume capacity before scoring admission.

## Configuration and reversible pause

The singleton `mmi_public_scoring_limits` and all new counters have RLS with no direct table grants, including for `service_role`. A database owner can review or change the bounded settings through the SQL editor in the exact approved project. Do not expose direct table access or a browser service key to make administration easier.

To stop new paid candidate claims without deleting data or removing the controls:

```sql
UPDATE public.mmi_public_scoring_limits
SET scoring_paused = true
WHERE singleton;
```

Results and no-response outcomes remain readable. A pause does not cancel a provider request that already started. Resume the same configured limits with `SET scoring_paused = false`; do not restore the old unbounded claim body as an improvised rollback. Lowering a limit below usage already counted stops further admissions until reset or a separately reviewed adjustment.

The optional `daily_known_cost_limit_usd` stops new candidate claims once recorded known cost for the current UTC day reaches that configured value. Leave it `NULL` unless an explicit amount has been chosen. Unknown usage, in-flight requests, missing persistence, provider billing differences, legacy administrator activity, and hosting/email quotas prevent this from being a hard platform-wide spending guarantee. Multi-account abuse can consume the shared daily allowance; email confirmation and sender controls remain separate protections. Ordinary accounts are denied the legacy paid `score-answer` endpoint; administrative legacy calls remain outside these candidate counters.

Known prior usage and retained retry claims seed the counters by unique lease so deployment does not silently reset today's recorded use. Missing historic metering cannot be reconstructed. Global daily totals have no account foreign key, so deleting an account cannot refund that day's shared allowance. Account counters and first-admission references contain only account/response identifiers, UTC dates/times, and counts; no answers, excerpts, URLs, or provider credentials are added. They retain seven full UTC days plus the current day, up to eight days while daily UTC cleanup is healthy. Account deletion cascades its own counters/references; shared totals contain no account identity.

## Exact rollout and proof

Do not apply the repository's diverged baseline to the shared project. Review and apply only this exact new migration, with the corresponding migration-ledger entry, after a read-only target/schema preflight. Verify the original claim body's MD5 is `4c6cb56001b9579a0983826d190f6f3f`, required columns/functions/grants match, new objects/job/version are absent, and cron uses UTC. A mismatched body is a stop-and-review result, not permission to overwrite unrelated hosted changes.

After applying it, verify private table/RPC grants, the default limits, the unchanged transcript-purge job, the new `mmi-purge-public-scoring-counters` job, and aggregate/candidate snapshot contracts. Normal hosted smoke must use authorized accounts and synthetic answers; do not create mass fixtures, alter clocks/roles, or deliberately exhaust shared limits. Record actual release/source/backend receipts separately.

Run `node scripts/test-public-scoring-sql.mjs` locally, with optional `PG_BIN=/path/to/postgresql/bin`. CI uses its existing PostgreSQL 16 binaries. The runner creates a fresh marked database and private Unix socket, disables TCP, ignores inherited PostgreSQL connection settings, and removes only its owned cluster. It accepts no hosted database URL. It extracts the reviewed original claim body verbatim, applies the actual migration, and checks real role boundaries, seed deduplication, retries, terminal reuse, pause/cost cutoff, UTC reset semantics, self-only snapshots, privacy expiry during a live lease, and actual account-deletion/nonrefund behavior.

Separate concurrent sessions prove global daily, global live-claim, and per-account distinct-response caps; rejected claims do not consume counters. The fixture models the reviewed schema and cron API/catalog, not the actual hosted scheduler. Hosted preflight/postflight and genuine public email receipt remain separate evidence.
