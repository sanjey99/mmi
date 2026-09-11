# Task 9 — Verification report

## Delivered

- Added a hostile static retention/projection policy test. It checks recursive
  forbidden-field rejection, structured rubric/cost-only projections, atomic
  successful-score purge, exact 24-hour unresolved-content retention, write-only
  AI key handling, grants/revokes, fixed function search paths, audit-before-
  detail return, and deletion cascades.
- Updated the existing synthetic candidate journey to use Oxford (115) and
  repository-wide (155) complete 11-minute pools plus schema-v3 equal-weight
  rubric checkboxes. It confirms retained feedback is read rather than rescored.
- Added a synthetic localhost-only administrator journey for structured
  cross-user rubric/cost review and non-secret AI configuration saves. The
  fixtures fail closed for all non-synthetic Supabase hosts and never use real
  credentials or candidate answer text.
- Made mutation integration file order deterministic: the existing checked-in
  candidate corpus importer now runs before the university-count test that
  consumes its 155-station fixture. No application or SQL behavior changed.
- Applied the approved lockfile-only `js-yaml` remediation: 3.15.1 to 3.15.2
  and 4.3.1 to 4.3.2. No direct package, major-version, or source change was
  made.

## Verification

- TDD: the new static policy suite was first RED because Vitest did not include
  it; after the minimal allowlist addition it passed 6/6 in both Node and
  Vitest. The new browser suite was first RED until the local route/UUID
  fixtures matched the shipped public contracts, then passed 3/3.
- `npm test`: 52 Node tests and 358 Vitest tests pass.
- Fresh disposable local Supabase proof: reset only
  `/private/tmp/mmi-supabase-task2-full`, restored the documented
  compatibility fixture, applied reconciliation and migrations in order through
  `20260910004000`, then ran the canonical mutation command. Vitest mutation
  tests passed 5 files / 34 tests and Node integration tests passed 41/41.
- `npm run test:e2e`: 15/15 localhost synthetic journeys pass. An apparent
  connection refusal during an earlier run was traced to the verification tool
  releasing its long-lived Expo child at its 30-second yield; holding that child
  through completion produced the full green run without any product change.
- `npm run test:coverage`: Node thresholds pass; Vitest coverage is 87.36%
  statements, 83.04% branches, 97.15% functions, and 94.84% lines.
- `npm run typecheck`, Edge-handler typecheck, and `npm run build` pass after
  a clean `npm ci` from the remediated lockfile.
- Production-only audit is 18 moderate, 0 high, and 0 critical. The prior high
  `js-yaml` advisory is removed. Remaining moderate fixes require incompatible
  Expo/Expo Router upgrades and were not applied.
- `git diff --check` passes. GitNexus was refreshed; `detect-changes --scope
  all` is low risk (6 files / 80 symbols) and the comparison to `main` reports
  the expected feature-wide critical scope (78 files / 853 symbols / 172
  flows). Both detect-change reports completed without a partial/truncated
  result. Reviewed candidate practice/scoring and admin-detail flows are
  covered by the focused static, mutation, and browser gates.

## Security review

No new production endpoint or persistence code was introduced. The new tests
use fixed synthetic IDs and synthetic session values only, block unexpected
hosts, contain no real secret, and assert that answer/transcript/evidence/raw
provider/key fields cannot enter candidate or administrator projections.

## Scope

All verification is local-only. No shared Supabase, provider, Vercel, or other
remote resource was changed, deployed, pushed, or merged.
