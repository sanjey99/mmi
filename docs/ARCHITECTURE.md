# Architecture

Interview Station is a web-first TypeScript application. Expo Router serves the interface as a static web export; Supabase supplies authentication, PostgreSQL, and server-side Edge Functions. The browser never receives AI provider credentials.

## Application layers

| Layer | Responsibility | Source |
| --- | --- | --- |
| Routes | Account setup, practice, feedback, progress, and administration | [`app/`](../app/) |
| Feature logic | Timers, transcripts, scoring coordination, content validation, and account actions | [`src/features/`](../src/features/) |
| Shared UI | Reusable controls, status notices, layouts, and design tokens | [`src/components/`](../src/components/), [`src/theme/`](../src/theme/) |
| Client state | Authentication and practice state | [`src/stores/`](../src/stores/) |
| Server boundary | Authenticated requests, provider integration, scoring, and health responses | [`supabase/functions/`](../supabase/functions/) |
| Persistence | Candidate records, content, authorization, scoring claims, and retention | [`supabase/migrations/`](../supabase/migrations/) |

## Candidate practice

A station has one scenario brief followed by five ordered response questions. The candidate modules separate the [schedule](../src/features/candidateMmi/schedule.ts), [runner](../src/features/candidateMmi/runner.ts), [speech interface](../src/features/candidateMmi/speechPort.ts), and [transcript handling](../src/features/candidateMmi/transcript.ts). This keeps timing and answer capture testable independently of the screen.

The [candidate API](../src/features/candidateMmi/api.ts) handles persisted practice state. Candidate access is scoped to the authenticated account, and candidate content excludes hidden assessor material. Transcript checkpoints support restoration; typing remains available when browser speech is unavailable or interrupted.

## Scoring and feedback

After a station completes, the [scoring queue](../src/features/candidateMmi/scoringQueue.ts) coordinates requests through the [scoring client](../src/features/candidateMmi/scoringApi.ts). The [server scorer](../supabase/functions/score-candidate-mmi-response/handler.ts) validates requests and uses server-owned claims before contacting the configured provider.

Database admission controls serialize competing claims, reuse completed results, and enforce retry and usage bounds. These controls live on the server because client state alone cannot prevent duplicate paid requests or requests from another device.

The server validates rubric assessments and calculates weighted totals. Candidates receive five performance levels per criterion, bounded evidence excerpts, and justifications. The [feedback display](../src/features/candidateMmi/feedbackDisplay.ts) and [scoring summary](../src/features/candidateMmi/scoringSummary.ts) present stored results and failure/expiry states without fabricating a score.

## Authentication and administration

The [authentication modules](../src/features/auth/) handle public account requests, verification, recovery, and optional CAPTCHA. Web authentication persistence is session-scoped through the [auth storage adapter](../src/lib/authStorage.ts). Email-action processing verifies the action before allowing the next account step.

Administrative screens use separate [content APIs and validation](../src/features/adminMmi/). Database authorization remains the enforcement boundary: a hidden route or disabled control is insufficient protection. Provider keys and private configuration remain behind server handlers.

## Data handling

The application and database store no raw MMI audio. Browser speech services may process microphone audio under their own terms. Successful scoring removes the full transcript; unresolved transcript text is purged within 24 hours. Supporting excerpts of up to 300 characters per criterion and justifications remain with feedback; an excerpt can contain a complete short answer. Provider-side processing and retention are separate from application deletion.

Runtime reporting uses bounded event categories rather than answer content or arbitrary error payloads. The [operations modules](../src/features/operations/) expose protected summaries; the [health handler](../supabase/functions/operations-health/handler.ts) supports independent health checks.

## Verification and tradeoffs

The repository tests feature logic directly, checks API and UI contracts, exercises synthetic browser journeys, and uses disposable PostgreSQL clusters for authorization and concurrency proofs. The [CI workflow](../.github/workflows/ci.yml) records the executable verification steps.

Responsive web is the current delivery target. Speech support depends on the browser and device, so automated browser checks supplement human device testing. A static frontend export does not provision the database, configure email, or establish production readiness. Historical migrations and reconciliation artifacts require review against the intended schema rather than automatic replay against a hosted project.
