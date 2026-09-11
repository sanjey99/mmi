# Task 9 — Verification and final-hardening report

## Delivered

- Added a race-free true rolling-hour limiter for paid scoring claims. Each
  user/response can create at most three durable claim attempts in any rolling
  hour; the fourth returns an accurate retry time before provider configuration
  or invocation. The HTTP boundary returns `429` plus `Retry-After` and no
  internal detail.
- Unified candidate and administrator station source IDs on the exact bounded
  ASCII contract `[A-Za-z0-9][A-Za-z0-9_-]{0,99}`. An administrator-created,
  published station now has configured database proof that it can be selected,
  started, and rendered by the candidate API; traversal, separators,
  whitespace, and overlong IDs fail closed.
- Replaced the installed transcript-retention definition with a 23h30 cutoff
  and five-minute schedule. The cutoff expires active scoring leases before
  purging, and a private content-free singleton heartbeat makes missed
  scheduled runs observable.
- Relaxed only the final usage validator so a successful schema-v3 assessment
  can retain provider/model/rate/latency/outcome snapshots when provider token
  usage is unavailable. Token counts and cost must be either all null or fully
  present with exact cost arithmetic; the administrator UI labels null cost as
  `Cost unavailable`.
- Strengthened the Task 9 proof surfaces: target and all-repository E2E flows
  each start a station and assert their distinct RPC scope; static SQL tests
  extract the last installed function definitions; live-catalog tests scope
  every deletion action to its exact table, referenced table, and column; and
  a hostile admin payload containing transcript, answer, evidence, raw provider
  response, and key fields is rejected before rendering.

## TDD and debugging evidence

- RED: the scoring handler mapped the new rate-limited claim to `500`, and the
  candidate parser rejected an administrator-safe source ID. Minimal handler
  and shared-parser changes made 48/48 focused unit tests GREEN.
- RED: the static policy suite could not find the new forward migration. The
  final-definition extractor and migration contract made 6/6 policy tests
  GREEN.
- The first disposable-stack startup failure was isolated to a temporary
  harness function stanza without copied source. The first configured database
  pass then exposed three proof-fixture defects: reuse of a versioned station,
  a reserved SQL alias, and an incorrect retry-horizon expectation. Production
  behavior was not weakened; corrected fixtures produced 22/22 focused
  configured database tests.

## Verification

- Fresh isolated local Supabase stack: API `55431`, PostgreSQL `55432`; baseline,
  reviewed security reconciliation, and every forward migration through
  `20260910005000_mmi_final_high_blockers.sql` applied successfully. The local
  hosted-compatibility tables and policy names were synthetic fixtures only.
- Focused configured database suites: 22/22 pass, including concurrent claims,
  fourth-claim limiting, rolling-window reset, null-usage persistence, immediate
  successful-score purge, 23h29/23h31 boundaries, active-lease expiry, cron,
  heartbeat ACL, live FKs, and administrator-created station start/render.
- Full mutation command: 5/5 files and 37/37 Vitest cases pass; serial Node
  integration contracts pass 41/41. The corpus proof retains 155 stations,
  775 questions, 3,100 criteria, target count 115, and all-repository count 155.
- `npm test`: 52 Node tests and 361 Vitest tests pass.
- `npm run test:e2e`: 16/16 synthetic localhost browser journeys pass.
- `npm run test:coverage`: Node thresholds pass; Vitest coverage is 87.43%
  statements, 83.18% branches, 97.15% functions, and 94.91% lines.
- `npm run typecheck`, Edge-handler typecheck, and `npm run build` pass.
- `npm audit --audit-level=high`: zero high/critical advisories; 21 existing
  moderate advisories remain in Vitest/Expo dependency paths and their offered
  fixes are outside this scoped hardening change or require breaking upgrades.
- `git diff --check` passes before final graph analysis and commit.

## Security review

- The new claim ledger and retention heartbeat have RLS enabled and revoke all
  browser and service-role table privileges. Security-definer functions retain
  fixed search paths and narrow grants; the internal cron wrapper is not
  callable by public, anonymous, authenticated, or service roles.
- Claim serialization uses the existing response row lock, so concurrent
  requests cannot exceed the rolling limit. The rate-limited response contains
  only a stable code and bounded retry metadata and never reaches the paid
  provider path.
- Unknown usage never becomes zero cost. Partial token data, mismatched exact
  cost, provider prose, evidence, transcript, raw response, and key fields all
  remain rejected at their boundaries.

## Scope

All work and verification is local-only. No shared Supabase, provider, Vercel,
credential, or other remote resource was changed, deployed, pushed, or merged.
