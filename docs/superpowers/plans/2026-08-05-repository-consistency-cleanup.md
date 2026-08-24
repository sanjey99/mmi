# Repository Consistency Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the shipped app, database, dependencies, and roadmap so every reachable feature is secure and supported by its implementation.

**Architecture:** First establish a write-only server-side AI-key boundary. Then prevent unreachable unfinished features from being selectable, repair the completed-practice data flow and auth/onboarding guard, reconcile dependencies, and make documentation reflect the supported roadmap.

**Tech Stack:** Expo Router, React Native, Supabase Auth/Postgres/Edge Functions, TypeScript, npm.

## Global Constraints

- The API key is write-only and is never included in client query responses.
- Tutor marketplace remains explicitly deferred.
- A user-facing feature is only shown when its route, backing code, schema, and tests are present.
- Add a test runner before behavior changes; use unit, integration, and critical E2E coverage.

---

### Task 1: Establish test infrastructure

**Files:** package manifest, test configuration, first tests.

- [ ] Add the project test runner and scripts.
- [ ] Add a failing unit test for secret/config response shaping.
- [ ] Add a failing integration test for the key-management authorization cases.
- [ ] Verify the tests fail before implementation and pass afterward.

### Task 2: Make AI-key configuration write-only

**Files:** `app/admin/ai-config.tsx`, `supabase/functions/`, `supabase/migrations/`.

- [ ] Add the authenticated administrator-only key replacement Edge Function.
- [ ] Replace client reads/writes of `ai_api_key` with the write-only flow.
- [ ] Replace key read policies with a deny policy for all client roles.
- [ ] Verify scoring still reads the key exclusively with service-role credentials.

### Task 3: Remove unsupported MMI and Excel-import exposure

**Files:** practice and admin route screens, route navigation, docs.

- [ ] Remove the selectable MMI Circuit mode until the Phase 5 implementation exists.
- [ ] Remove or hide the broken Excel import routes until their library, tables, and dependency are delivered as one feature.
- [ ] Confirm every remaining navigation target resolves to a route.

### Task 4: Repair auth/onboarding and progress persistence

**Files:** auth store, root/tab layouts, practice store, progress screen.

- [ ] Keep initial routing in a loading state until both session and profile resolution finish.
- [ ] Guard tab routes against missing sessions and unfinished onboarding.
- [ ] Persist session score totals and handle score-insert failures.
- [ ] Query score averages through an explicit `answers` relationship.
- [ ] Render a dynamic rolling-calendar label.

### Task 5: Reconcile dependencies and documentation

**Files:** `package.json`, `package-lock.json`, README, blueprint/plan docs.

- [ ] Resolve `xlsx` and worklets manifest/lockfile drift.
- [ ] Run clean install, typecheck, test coverage, and web build.
- [ ] Mark the completed web plan accurately and remove duplicated plan content.
- [ ] Update setup instructions for all required migrations and Edge Function deployment.
- [ ] Update roadmap status to reflect supported features only.
