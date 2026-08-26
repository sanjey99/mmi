# Interview Station

Interview Station is an Expo Router web application for UK medical-school interview practice. The current release target is a private founding-team preview of the legacy written-practice loop, question authoring, and structured product feedback.

## Status

- Frontend: Expo Router / React Native Web static export.
- Hosting: Vercel.
- Backend: Supabase Auth, Postgres, and Edge Functions.
- Render is not required.
- Phase 4 MMI Tasks 1–6 are merged, but the Phase 4 student experience and hosted deployment remain intentionally unavailable.

Authoritative runbooks:

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
```

The `EXPO_PUBLIC_SUPABASE_ANON_KEY` name is retained for compatibility; its value is the current Supabase publishable key. Never place a secret or service-role key in an `EXPO_PUBLIC_*` variable.

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

Do not paste or apply migrations from this repository directly to hosted Supabase. The hosted migration history and schema are currently divergent. Every migration, function deployment, secret/configuration change, role change, or row mutation requires an exact reviewed operation and explicit approval.

Do not use `npm audit fix --force`.
