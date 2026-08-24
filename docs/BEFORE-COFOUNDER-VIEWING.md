# Before Cofounder Viewing

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Follow `AGENTS.md`, run GitNexus impact analysis before editing existing symbols, use strict TDD, and run an independent security review before release.

**Goal:** Put a private, truthful, reliable Interview Station preview in front of the founding team so they can test the core practice loop, manage legacy questions, and give structured product feedback.

**Architecture:** Deploy the Expo Router static web export to Vercel and keep Supabase as the only backend. The preview exposes the legacy single-question free/timed practice flow; unfinished Phase 4 MMI, MMI Circuit, Tutor, and student question-browser surfaces remain hidden. Browser authentication lasts for the browser session and explicit sign-out clears it immediately.

**Current branch:** `feat/cofounder-ui-reliability`, based on `origin/main` at `9cf4311`.

**Pre-redesign backup:** commit `9cf4311`, local branch `backup/pre-redesign-ui-2026-08-25`.

**Approved UI contract:** [PRODUCT.md](../PRODUCT.md) and [surface-brief.md](../.impeccable/surface-brief.md). The approved direction is **The Numbered Station Corridor**, composition **Doorway Threshold**.

## Non-negotiable boundaries

- Treat hosted Supabase as read-only until the user approves an exact operation.
- Never delete hosted rows or database objects.
- Do not apply migrations, deploy functions, modify secrets, repair migration history, or insert/update/delete hosted data without showing the exact operation and receiving approval.
- Never run credential-gated integration tests against production or shared data.
- Never place a Supabase secret/service-role key in Vercel or any client bundle. Vercel receives only the project URL and publishable key.
- Never run `npm audit fix --force`.
- Do not deploy unfinished Phase 4 MMI functions or UI as part of the cofounder preview.
- `ai_api_key` remains write-only to every client, including administrators.

## Preview scope

### Included

- Invite-only email/password login.
- Onboarding.
- Home/orientation.
- Legacy free practice and eight-minute timed practice.
- Clear category availability based on real active-question counts.
- Written answer submission with explicit loading, success, and recoverable failure states.
- AI feedback and progress only when the configured server flow succeeds.
- Profile editing and reliable explicit sign-out.
- Cofounder-only Question Desk for safe question creation and CSV-assisted bulk authoring.
- Structured cofounder feedback capture.

### Hidden or disabled

- Public signup.
- Student Questions placeholder.
- Tutor marketplace.
- MMI Circuit.
- Phase 4 station-library/client flows.
- Any category with zero active questions.
- AI scoring when server configuration is unavailable; the UI must explain the recovery rather than silently failing.

## Verified starting facts — 2026-08-25

- `origin/main` includes Phase 4 Tasks 1–6. Task 6 merged through PR #5 at `9cf4311`; Tasks 7–15 are unfinished.
- Hosted Supabase migration history is empty even though parts of the early schema exist. Do not run the current migration chain directly.
- Hosted legacy questions: two active rows, one Ethics and one Motivation. NHS, Teamwork, Resilience, and Scenarios have no active questions.
- Hosted `app_config`: provider and model are present; `ai_api_key` and `ai_base_url` are not configured.
- Hosted extensions observed: `pg_trgm` and `uuid-ossp`; the `on_auth_user_created` trigger is enabled.
- Render is not required. The preview architecture is Vercel static web plus Supabase.
- The current functional failures share a web-specific root cause: React Native Web's `Alert.alert()` is a no-op, so confirmation callbacks and error dialogs never run.
- Direct `router.back()` calls have no fallback for refreshes and deep links.
- Practice session state currently lives only in Zustand memory, so a refresh loses the question and attempts a dead back navigation.
- Legacy submission currently inserts an answer before AI scoring and performs score/session/streak writes client-side. This is not safe enough for closed release and must be made server-owned before real scoring is enabled.
- Current production dependency audit evidence must be refreshed before release. The last audit reported Expo/Metro transitive advisories; incompatible force-fixes are prohibited.

## Implementation plan

### Task 1: Establish the corridor design system and accessible application shell

**Files:**

- Modify: `app/_layout.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/theme/colors.ts`
- Modify: `src/theme/spacing.ts`
- Modify: `src/theme/typography.ts`
- Modify: `src/theme/index.ts`
- Modify: `src/components/layout/ScreenWrapper.tsx`
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Card.tsx`
- Create: `src/components/navigation/AppHeader.tsx`
- Create: `src/components/navigation/CircuitRoute.tsx`
- Create: `src/components/feedback/InlineNotice.tsx`
- Create: `src/components/feedback/ConfirmAction.tsx`
- Test: `tests/uiContracts.test.ts`
- E2E: `e2e/cofounder-preview.spec.ts`

**Produces:** one responsive component grammar for orientation, practice, feedback, progress, profile, auth, and admin screens.

- [ ] RED: add source-level and pure-contract tests for the approved palette, no emoji tab configuration, named route states, accessible focus/state copy, and removal of unsupported web alerts from preview routes.
- [ ] GREEN: replace teal/navy/cream, serif display type, pills, emoji tabs, soft card grids, and generic dashboard composition with the approved corridor tokens and route/plate/sheet components.
- [ ] Add visible selected, unavailable, loading, error, success, and keyboard-focus states that do not rely on colour alone.
- [ ] Use a sourced, open-licensed wayfinding typeface; record its package/license and keep long-form copy readable at 65–75 characters per line.
- [ ] Verify desktop, tablet, and phone breakpoints; the painted route must remain navigation rather than decorative overflow.
- [ ] Commit after focused tests pass.

### Task 2: Make navigation, confirmation, and status feedback work on web

**Files:**

- Create: `src/lib/navigation.ts`
- Modify: `app/(auth)/signup.tsx`
- Modify: `app/profile.tsx`
- Modify: `app/admin/index.tsx`
- Modify: `app/admin/questions.tsx`
- Modify: `app/admin/ai-config.tsx`
- Modify: `app/practice/session.tsx`
- Test: `tests/navigation.test.ts`
- E2E: `e2e/cofounder-preview.spec.ts`

**Interface:** `navigateBackOr(fallback)` uses safe history when available and otherwise replaces with a named route.

- [ ] RED: test history-present and deep-link/no-history decisions for every route fallback.
- [ ] GREEN: replace direct `router.back()` handlers with `navigateBackOr` using explicit fallbacks: signup → login, profile → home, admin child → admin, admin root → home, practice session → practice.
- [ ] Replace `Alert.alert()` confirmations and errors with accessible in-page notice/confirmation UI.
- [ ] Prevent navigation side effects during render when restoring a session.
- [ ] E2E: deep-link each protected screen, use Back, and verify a deterministic destination.
- [ ] Commit after focused tests pass.

### Task 3: Make web authentication session-only and explicit sign-out reliable

**Files:**

- Create: `src/lib/authStorage.ts`
- Modify: `src/lib/supabase.ts`
- Modify: `src/stores/authStore.ts`
- Modify: `app/profile.tsx`
- Modify: `app/(auth)/login.tsx`
- Modify: `app/(auth)/signup.tsx`
- Test: `tests/authStorage.test.ts`
- E2E: `e2e/cofounder-preview.spec.ts`

**Interface:** web uses a guarded `sessionStorage` adapter; native retains `AsyncStorage`.

- [ ] RED: test get/set/remove behavior, server/static-export safety, and storage failure handling without logging tokens.
- [ ] GREEN: inject platform storage into Supabase Auth and preserve refreshes in the same tab without localStorage persistence.
- [ ] Make `signOut()` check and throw Supabase errors before clearing local state.
- [ ] Show an explicit confirmation, pending state, success route replacement, and retryable failure.
- [ ] Hide public signup entry points for the preview; do not claim open membership.
- [ ] E2E: refresh retains auth, successful sign-out returns to login, and a new browser session has no retained auth.
- [ ] Commit after focused tests pass.

### Task 4: Make question availability and safe session restoration truthful

**Files:**

- Modify: `src/lib/questions.ts`
- Modify: `src/stores/practiceStore.ts`
- Modify: `app/(tabs)/practice.tsx`
- Modify: `app/practice/session.tsx`
- Create: `tests/questions.test.ts`
- Create: `tests/practiceRestoration.test.ts`
- E2E: `e2e/cofounder-preview.spec.ts`

**Interfaces:**

```ts
getActiveQuestionCounts(): Promise<Record<QuestionCategory, number>>
getQuestionById(questionId: string): Promise<Question | null>
restoreSession(sessionId: string, questionId: string): Promise<void>
```

- [ ] RED: test active counts, empty categories, exact question lookup, malformed route identifiers, ownership-safe restoration, and explicit not-found errors.
- [ ] GREEN: show real availability, disable empty categories, and label the current two-question bank truthfully.
- [ ] Restore the current owned session/question after refresh instead of depending on in-memory Zustand state.
- [ ] Keep question selection within the chosen category. Avoid promising variety when only one row exists.
- [ ] Show no-question and load errors inline with a useful recovery action.
- [ ] E2E: Ethics and Motivation open; the four empty categories do not; refresh on a session restores the prompt.
- [ ] Commit after focused tests pass.

### Task 5: Repair question authoring for cofounders

**Files:**

- Modify: `src/lib/questions.ts`
- Modify: `app/admin/questions.tsx`
- Create: `src/features/questions/csv.ts`
- Create: `src/features/questions/validation.ts`
- Create: `tests/questionCsv.test.ts`
- Create: `tests/questionValidation.test.ts`
- E2E: `e2e/admin-question-desk.spec.ts`

**Produces:** validated preview-before-write input for single-question and CSV authoring.

- [ ] RED: test exact header mapping `category,text,difficulty,subcategory,university_tags,is_mmi_suitable,guidance_notes`, quoted commas/newlines/escaped quotes, blank text, enum errors, field limits, row/file limits, and duplicate policy.
- [ ] GREEN: fix the current header/parser mismatch and show parsed rows plus row-level errors before any write.
- [ ] Add a single-question form suitable for ordinary cofounder iteration; CSV remains optional bulk input.
- [ ] Make mutation semantics honest. Do not say “upsert” unless a stable identifier and real update path exist.
- [ ] Separate draft/active publication state in the UI. Any required schema change remains an approval-gated Supabase operation.
- [ ] Keep guidance/assessor notes out of all student query projections.
- [ ] E2E uses mocked/local isolated boundaries only; it must never create hosted rows.
- [ ] Commit after focused tests pass.

### Task 6: Make legacy scoring server-owned and retry-safe

**Files:**

- Create: a reviewed additive migration and Edge function only after the local design is approved
- Modify: `supabase/functions/score-answer/index.ts`
- Modify: `src/stores/practiceStore.ts`
- Modify: `app/practice/session.tsx`
- Modify: `app/practice/feedback.tsx`
- Create: focused unit and isolated integration tests

**Security requirements:** the client supplies an owned identifier and answer text only; the server loads authoritative question/session/user state, rate-limits durable requests, calls the provider, and persists the result atomically and idempotently.

- [ ] RED: prove cross-user IDs, inactive questions, changed-body idempotency reuse, concurrent duplicates, provider failure/retry, malformed output, and arbitrary client score/streak writes fail.
- [ ] GREEN: move score, session-total, and streak persistence behind the authenticated server boundary.
- [ ] Preserve the Task 5 provider hardening: exact allowlisted hosts/origins, DNS/private-network rejection, redirect rejection, timeouts, and generic safe errors.
- [ ] The UI must never become inert: show pending, provider-not-configured, rate-limited, retryable, and saved states inline.
- [ ] Do not deploy or apply its migration without presenting exact operations and receiving approval.
- [ ] Commit local code only after 80%+ coverage and independent security review.

### Task 7: Add a privacy-minimal cofounder feedback loop

**Files:**

- Create: feedback UI, validation, isolated tests, and an approved persistence boundary
- Modify: navigation to expose `SEND FEEDBACK`

- [ ] Capture category, severity, screen, message, app version, and optional reply permission.
- [ ] Do not attach screenshots, tokens, answer text, transcripts, or console/network logs by default.
- [ ] Restrict users to own inserts and founders/admins to review access.
- [ ] If a temporary external form is chosen for the first viewing, state it explicitly and keep the in-app schema out of the preview migration set.
- [ ] Any table/function/policy creation and any test submission to hosted Supabase require exact approval.

### Task 8: Consolidate documentation and run local release gates

**Files:**

- Keep authoritative: `docs/BEFORE-COFOUNDER-VIEWING.md`
- Keep authoritative: `docs/PRE-CLOSED-ROUND-DEPLOYMENT.md`
- Reduce: `README.md` to setup/status/index
- Remove after consolidation: historical blueprint, plans, specs, and `security-revisions.md`

- [ ] Preserve all durable architecture, security, Phase 4, deployment, and rollback decisions in the two authoritative documents.
- [ ] Update checkboxes and dated evidence as work completes.
- [ ] Run `npm test`.
- [ ] Run `npm run test:coverage` and require 80%+ lines/functions/branches/statements for changed logic.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:e2e` against a local mocked/isolated environment.
- [ ] Run local Supabase Edge-runtime CORS/auth smoke for the exact functions proposed for deployment.
- [ ] Run the Impeccable detector exactly once against final changed UI targets, then complete the `$un-vibecode` audit.
- [ ] Run an independent security review and resolve every Critical/High finding.
- [ ] Run `gitnexus_detect_changes`, `git diff --check`, and review the complete diff before every commit/push.
- [ ] Refresh `npm audit --omit=dev`; classify every finding by runtime reachability and supported upgrade path. Never force-fix.

## Approval-gated hosted operations

None of these is authorized by this document. Present each exact SQL/CLI/dashboard action separately:

1. Repair selected migration-history rows only after metadata confirms their full effects.
2. Apply a revised non-destructive AI-key function-only-write hardening.
3. Revoke unsafe direct access to assessor-bearing MMI tables and legacy hidden question fields.
4. Fix cross-user `update_streak` execution and direct score insertion.
5. Apply the reviewed server-owned legacy-scoring migration.
6. Configure exact `APP_ALLOWED_ORIGINS`, scoring provider/model/key, and optional custom-provider host allowlist.
7. Deploy only the preview-approved JWT-verified functions.
8. Disable public signup and create/invite named cofounders.
9. Assign the minimum necessary admin/content role to named accounts.
10. Create feedback persistence only if the in-app option is approved.

Do not apply the current Phase 4 persistence/Cron migration merely to deploy this preview. Its retention job includes row mutations/deletions and requires a separate privacy decision.

## Vercel deployment contract

- Render: not used.
- Framework preset: Other.
- Build command: `npm run build`.
- Output directory: `dist`.
- Public environment variables only:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY` set to the Supabase publishable key
- `vercel.json` rewrites deep links to `index.html`.
- Add the stable Vercel origin exactly to the Edge allowlist before browser scoring is enabled.
- Keep the previous known-good Vercel deployment available for rollback.

## Cofounder go/no-go script

- [ ] Named tester can sign in and complete onboarding.
- [ ] Public signup is unavailable.
- [ ] Refresh retains the same-tab session; explicit sign-out works; a new browser session starts signed out.
- [ ] Deep links and every visible Back action reach a deterministic safe destination.
- [ ] Ethics and Motivation are available; empty categories are visibly unavailable.
- [ ] Practice start, session refresh, validation, submission, failure recovery, feedback, and progress work.
- [ ] A failed provider call does not leave a duplicate/orphaned logical submission.
- [ ] Non-admin testers cannot open or invoke admin/content/AI-key operations.
- [ ] An authorized cofounder can validate a single question and a CSV without ambiguous column mapping.
- [ ] Student APIs never expose inactive content, guidance notes, model answers, actor context, rubrics, or future prompts.
- [ ] Feedback can be sent without capturing sensitive answer/session data.
- [ ] Allowed origin works; disallowed origin and invalid/absent JWT fail safely.
- [ ] Chrome, Safari, Firefox, mobile-width, keyboard-only, focus, and reduced-motion checks pass.
- [ ] Unit/integration/E2E, 80%+ coverage, typecheck, build, Edge smoke, security review, and visual audits have dated evidence.
- [ ] Rollback owner knows how to restore the previous Vercel deployment and disable scoring.

## Release gate

Do not show the preview to cofounders until every P0 path above has evidence, hosted drift has an approved non-destructive treatment, and independent review reports no unresolved Critical or High security issue.
