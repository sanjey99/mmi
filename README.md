# Interview Station

[![CI](https://github.com/sanjey99/mmi/actions/workflows/ci.yml/badge.svg)](https://github.com/sanjey99/mmi/actions/workflows/ci.yml)

A web application for UK medical-school applicants to practise Multiple Mini Interviews (MMIs), receive structured AI feedback, and review their progress.

Each station combines a 60-second scenario brief with five two-minute responses. Candidates can type or use editable browser speech transcription, then review weighted rubric feedback with supporting evidence and practical next steps.

**Status:** Working beta. Access remains controlled while onboarding and launch checks are completed. AI feedback supports practice; it does not predict admission or provide clinical advice.

## Features

- Timed stations with all-published and target-university practice pools.
- Speech input with typing fallback, transcript checkpoints, and practice restoration.
- Five-level criterion scoring, weighted results, supporting excerpts, and saved feedback.
- Clear submission, scoring, retry, and expiry states.
- Practice history, progress summaries, and tester reports.
- Administrator tools for station content, assessment review, AI configuration, and usage inspection.

## Engineering highlights

- **Reliable practice flow:** timing, transcripts, and scoring are separated into focused, testable modules.
- **Server-controlled AI calls:** scoring claims prevent concurrent duplicate work, reuse completed results, and bound paid retries and allowances.
- **Account boundaries:** database authorization and row-level security protect candidate records and assessor content.
- **Data minimization:** the app stores no raw MMI audio. Successful scoring deletes the full transcript; unresolved text expires within 24 hours. Bounded excerpts remain with feedback, and external providers have separate processing policies.
- **Layered verification:** unit and contract tests, isolated PostgreSQL proofs, browser journeys, and automated accessibility checks run in CI.

## Stack

TypeScript · React · Expo Router · React Native Web · Zustand · Supabase Auth, PostgreSQL and Edge Functions · Vercel

## Run locally

Use **Node.js 22.18+** and npm.

```bash
npm ci
cp .env.example .env
```

Set the Supabase URL and publishable key for **your own disposable development project** in `.env`, then start the web application:

```bash
npm run web
```

Frontend setup does not provision a backend. See the [development guide](docs/DEVELOPMENT.md) before configuring database schema or Edge Functions. `EXPO_PUBLIC_*` values are embedded in the browser bundle: use publishable values only and keep service-role keys and AI credentials server-side.

## Validation

```bash
npm test
npm run typecheck
npm run build
```

The [CI workflow](.github/workflows/ci.yml) adds browser, accessibility, CAPTCHA, and isolated SQL checks. Its synthetic Supabase configuration is for verification; a build made with those values cannot connect to a real backend. See [testing and safety](docs/DEVELOPMENT.md#testing) for reproducible browser commands and database-test boundaries.

## Code tour

| Area | Where to look |
| --- | --- |
| Routes and screens | [`app/`](app/) |
| Candidate practice, transcripts, and scoring | [`src/features/candidateMmi/`](src/features/candidateMmi/) |
| Authentication and email actions | [`src/features/auth/`](src/features/auth/) |
| Content administration | [`src/features/adminMmi/`](src/features/adminMmi/) |
| Shared interface and design tokens | [`src/components/`](src/components/), [`src/theme/`](src/theme/) |
| Server handlers and database changes | [`supabase/functions/`](supabase/functions/), [`supabase/migrations/`](supabase/migrations/) |
| Automated checks | [`tests/`](tests/), [`e2e/`](e2e/), [`e2e-captcha/`](e2e-captcha/) |

Read the [architecture overview](docs/ARCHITECTURE.md), [product scope](PRODUCT.md), or [development guide](docs/DEVELOPMENT.md) for more detail.
