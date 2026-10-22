# Development

## Requirements and setup

- Node.js **22.18+** and npm. CI uses Node 22; the Node test suite executes TypeScript directly.
- A disposable Supabase development project for connected application work.
- PostgreSQL command-line binaries for the optional isolated SQL proofs.

```bash
npm ci
cp .env.example .env
```

Fill in `.env` with your own development project's URL and publishable key. The historical `EXPO_PUBLIC_SUPABASE_ANON_KEY` name accepts the Supabase publishable key. Leave the model profile at `default` for ordinary development. Keep optional CAPTCHA disabled until a matching development provider configuration exists.

```bash
npm run web
```

All `EXPO_PUBLIC_*` values are public browser configuration. Service-role credentials, AI provider keys, SMTP passwords, and private database URLs belong in local or hosted secret storage, never in that namespace or Git.

## Backend setup boundaries

The frontend install does not create a database, seed a question bank, deploy Edge Functions, or configure email. Review the [migrations](../supabase/migrations/), [reconciliation artifacts](../supabase/reconciliation/), and [function sources](../supabase/functions/) against a disposable project's actual schema before applying changes.

Historical schema evolution includes prerequisites and reconciliation work that cannot be assumed to exist in a fresh project. There is no supported one-command hosted bootstrap. Do not blindly replay the migration directory, run a hosted database push, or point test fixtures at a shared backend.

Private question-bank imports are intentionally absent from Git. The repository retains [converters and manifests](../supabase/imports/20260825_med_interview_question_bank/) so import validation can be reviewed without publishing source content. Supply only content you are authorized to use in your own environment.

## Testing

The standard checks do not require production credentials:

```bash
npm test
npm run typecheck
npm run build
```

`npm test` runs the Node and Vitest suites. `npm run typecheck` checks both the application and selected Edge Function handlers. Optional coverage thresholds are available through `npm run test:coverage`.

### Synthetic browser checks

The Playwright suite runs against a local application with intercepted Supabase requests. A reproducible static-build run uses the same synthetic values as CI:

```bash
export EXPO_NO_DOTENV=1
export EXPO_PUBLIC_SUPABASE_URL=https://e2e.supabase.co
export EXPO_PUBLIC_SUPABASE_ANON_KEY=synthetic-publishable-key
export EXPO_PUBLIC_AI_MODEL_PROFILE=default
export EXPO_PUBLIC_AUTH_CAPTCHA_ENABLED=false
export EXPO_PUBLIC_TURNSTILE_SITE_KEY=
npm run build
npx playwright install chromium
npm run test:e2e -- --config=playwright.ci.config.ts
```

Run those commands in a dedicated terminal session so synthetic values do not carry into connected development or deployment. The CI configuration starts its own local static server and disables traces, screenshots, and video. Never publish a build made with synthetic configuration as a connected application.

The [CI workflow](../.github/workflows/ci.yml) also tests CAPTCHA enabled and disabled against local provider stubs. Its public synthetic site key is test configuration, not a live anti-bot setup. Automated accessibility checks cover machine-detectable issues; device, microphone, keyboard, and screen-reader checks still need human testing.

### Isolated PostgreSQL proofs

These scripts create fresh temporary PostgreSQL clusters using private Unix sockets. They do not accept a hosted connection as their test target:

```bash
node scripts/test-operations-sql.mjs
node scripts/test-public-scoring-sql.mjs
node scripts/test-candidate-mmi-activity-sql.mjs
node scripts/test-candidate-mmi-start-limits-sql.mjs
```

Install PostgreSQL binaries and make `pg_config` available, or set `PG_BIN` to their absolute directory. The proofs exercise real grants, row-level security, scoring admission, activity isolation, and station-start concurrency. Review each script's output and cleanup behavior if a proof fails.

The separate [adversarial local proof guide](MMI-SUPABASE-ADVERSARIAL-LOCAL-PROOF.md) documents its required pre-cutover catalog, explicit disposable-database marker, and sole supported runner. Its fixtures must not be run directly or against a hosted database.

### Credential-gated integration checks

`npm run test:integration:mutating` is a separate guarded suite for a disposable local Supabase environment. It skips when unconfigured and rejects partial or unsafe configuration. Read the [environment guard](../tests/integration/requireLocalMutationEnvironment.ts), [mutation safety checks](../tests/integration/mutationTestSafety.ts), and [runner](../scripts/run-mutating-integration-tests.mjs) before supplying local test credentials.

These checks create or modify fixtures and account roles. They must never target production, a shared backend, or real user records. Keep credentials and generated browser state, traces, reports, database exports, and answer content outside Git and public CI artifacts.

## Production builds

`npm run build` writes the static web export to ignored `dist/`. Public environment values are embedded during export, so changing them requires a new build. Review configuration before deploying; frontend build success alone does not verify backend schema, provider credentials, email delivery, retention scheduling, or human release checks.

Follow the [security policy](../SECURITY.md) for handling sensitive findings. Do not use a forced dependency upgrade to bypass an audit result; review compatibility and rerun the relevant checks.
