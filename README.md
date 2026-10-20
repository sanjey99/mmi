# Interview Station

Interview Station is an Expo Router web application for UK medical-school interview practice. The live invitation-only preview provides an 11-minute MMI station, five-level evidence-based scoring, practice history, content administration, and tester reports. A small outside-user pilot is being prepared; its operational and human review checks remain explicit.

## Status

- Frontend: Expo Router / React Native Web static export.
- Hosting: Vercel.
- Backend: Supabase Auth, Postgres, and Edge Functions.
- Render is not required.
- Live candidate app: [mmi-hazel.vercel.app](https://mmi-hazel.vercel.app).
- The product owner explicitly selected shared Supabase project `tliwifhnsytxpcynuwsy`; this supersedes historical isolated-backend deployment instructions.
- Five-level scoring is deployed from source `3c78e89`. The GPT-5.5 comparison frontend now uses the same compatible source and backend; its model profile remains administrator-only.

Authoritative runbooks:

- [External Beta Readiness and Operations](docs/EXTERNAL-BETA-READINESS.md) — current release evidence, remaining decisions, invitation/support procedure, and pilot test matrix.
- [Before Cofounder Viewing](docs/BEFORE-COFOUNDER-VIEWING.md)
- [Pre-Closed-Round Deployment](docs/PRE-CLOSED-ROUND-DEPLOYMENT.md)

Product and visual contract:

- [PRODUCT.md](PRODUCT.md)

## Local setup

Requirements: Node.js 20+ and npm.

```bash
npm ci
```

Create an ignored `.env` in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
EXPO_PUBLIC_AI_MODEL_PROFILE=default
```

The `EXPO_PUBLIC_SUPABASE_ANON_KEY` name is retained for compatibility; its value is the current Supabase publishable key. Never place a secret or service-role key in an `EXPO_PUBLIC_*` variable.

`EXPO_PUBLIC_AI_MODEL_PROFILE` accepts `default` or `gpt-5.5`. The GPT-5.5 profile is enforced server-side as admin-only; the browser value never selects a provider key or pricing directly. Model-comparison deployments can share the production Supabase URL and publishable key so accounts and practice history remain shared.

```bash
npm start
npm run build
```

## Verification

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run test:e2e
npm audit --omit=dev
```

The Playwright suite uses a synthetic intercepted Supabase endpoint. Credential-gated integration tests must run only against a disposable local/isolated project and must never target production or shared data.

## Deployment safety

The hosted migration history and repository have diverged. Do not blindly apply all repository migrations to hosted Supabase; review the exact operation, target, prerequisites, and current user authorization. The scoring rollout to the shared live project was explicitly authorized and completed. That rollout alone does not authorize unrelated role/configuration changes, test fixtures, or destructive account deletion; carry out later work within the user's current scope.

Keep automated credential-gated integration tests on disposable local/isolated databases. Testers receive ordinary invited application accounts, not Supabase/Vercel team membership or administrator access. Before outside invitations, follow the current readiness checklist; deployment alone does not establish working email onboarding, legal review, physical-device QA, or human signoff.

Do not use `npm audit fix --force`.
