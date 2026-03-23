# Security Revisions — InterviewStation
<!-- Claude Code: This document is executable. Work through each REVISION in order.
     Each section contains: threat, affected files, and concrete steps to fix it.
     Mark completed with [x] as you go. -->

## How to Use This Document
Run this file as a Claude Code task:
> "Work through security-revisions.md and implement all HIGH and CRITICAL fixes."

Each revision has a **Risk** level, **Affected Files**, and **Fix Steps**.
Do NOT skip HIGH or CRITICAL items. MEDIUM items should be batched after.

---

## REVISION 1 — CRITICAL: Admin Routes Have No Auth Guard
**Risk:** CRITICAL
**Threat:** Any authenticated user can navigate to `/admin/*` routes directly. The layout
wraps a Stack but never checks `profile.is_admin`. An attacker who creates an account
can access `/admin/ai-config` and overwrite the AI API key with their own endpoint.

**Affected Files:**
- `app/admin/_layout.tsx`

**Fix Steps:**
1. Read `app/admin/_layout.tsx` and `src/stores/authStore.ts`
2. Import `useAuthStore` and `router` in the admin layout
3. Add a `useEffect` that checks `profile?.is_admin`. If false or null, call
   `router.replace('/(tabs)')` immediately
4. While `loading` is true, render a centered `<ActivityIndicator>` so there is no
   flash of admin UI before the redirect fires
5. The check must happen inside the layout component, not just in individual screens

**Expected Result:** Navigating to `/admin` without `is_admin: true` redirects to tabs.

---

## REVISION 2 — CRITICAL: AI API Key Exposed on Client
**Risk:** CRITICAL
**Threat:** `src/lib/ai/index.ts` fetches the AI API key from Supabase `app_config`,
then uses it directly in client-side `fetch()` calls to Anthropic/OpenAI. The key
is present in device memory, visible in Charles/Proxyman network captures, and
extractable from a decompiled APK/IPA. Any user on the same network can intercept it.

**Affected Files:**
- `src/lib/ai/index.ts`
- Supabase: new Edge Function needed

**Fix Steps:**
1. Create a Supabase Edge Function at `supabase/functions/score-answer/index.ts`
   - Accept POST body: `{ questionText: string, answerText: string }`
   - Read AI config from `app_config` using the service-role key (server-side only)
   - Make the AI provider call server-side and return the `ScoreResult` JSON
   - Verify the caller is authenticated: check `Authorization: Bearer <jwt>` header
     using `supabase.auth.getUser(token)` — reject with 401 if invalid
2. In `src/lib/ai/index.ts`:
   - Remove `callAnthropic()`, `callOpenAICompat()`, and `getAIConfig()`
   - Replace `scoreAnswer()` to call the Edge Function via
     `supabase.functions.invoke('score-answer', { body: { questionText, answerText } })`
3. In Supabase dashboard: ensure `app_config` RLS policy DENIES reads of `ai_api_key`
   to non-admin roles (the Edge Function uses service role, bypassing RLS)

**Expected Result:** API key never leaves the server. Client only sends question + answer.

---

## REVISION 3 — HIGH: SSRF via Unvalidated `base_url`
**Risk:** HIGH
**Threat:** The `openai_compatible` provider accepts an arbitrary `base_url` from the
`app_config` table. A compromised admin account can set this to an internal metadata
URL (e.g. `http://169.254.169.254/` on cloud VMs) or an attacker-controlled server
to exfiltrate the API key or probe the internal network. This becomes exploitable once
Revision 2 moves AI calls to an Edge Function.

**Affected Files:**
- `src/lib/ai/index.ts` (and the Edge Function created in Revision 2)

**Fix Steps:**
1. Add a `validateBaseUrl(url: string): boolean` function that:
   - Parses the URL with `new URL(url)` inside try/catch (invalid URL → false)
   - Rejects `http:` scheme unless hostname is `localhost` or `127.0.0.1`
   - Rejects private IP ranges: `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`
   - Rejects hostnames that resolve to private ranges (basic check: reject bare IPs
     in the above ranges — full DNS resolution is out of scope for MVP)
   - Returns true only if `https:` or (localhost `http:`)
2. Call `validateBaseUrl` before using `base_url` in the Edge Function. Throw a
   descriptive error if invalid: `"base_url must be an HTTPS endpoint"`
3. In `app/admin/ai-config.tsx`, add client-side validation in `handleSave()` using
   the same rules — this is UX only, the server validation is authoritative

**Expected Result:** SSRF via custom base URL is blocked at both client and server.

---

## REVISION 4 — HIGH: No Rate Limiting on AI Scoring
**Risk:** HIGH
**Threat:** Any authenticated user can call `scoreAnswer` in a tight loop, burning
through the AI API budget. There is no per-user cooldown, daily cap, or abuse detection.
At current pricing, a script calling the endpoint every second costs ~$50/hour on GPT-4o.

**Affected Files:**
- Supabase Edge Function (from Revision 2)
- Supabase: new `rate_limits` table or use Postgres function

**Fix Steps:**
1. In the `score-answer` Edge Function, after authenticating the user, check rate:
   ```sql
   SELECT COUNT(*) FROM scores
   WHERE answer_id IN (
     SELECT id FROM answers WHERE session_id IN (
       SELECT id FROM mock_sessions WHERE user_id = $1
         AND started_at > NOW() - INTERVAL '1 hour'
     )
   )
   ```
   If count > 50 (50 AI calls per user per hour), return HTTP 429 with
   `{ error: "Rate limit exceeded. Try again later." }`
2. Alternatively: add a `last_score_at` column to `profiles` and enforce a
   minimum 10-second gap between consecutive scoring calls per user
3. In the React Native client, handle 429 responses in `scoreAnswer()` gracefully:
   show an Alert: "You're scoring too quickly. Please wait a moment."

**Expected Result:** No user can make more than 50 AI scoring calls per hour.

---

## REVISION 5 — HIGH: `session: any` Type Hides Auth Bugs
**Risk:** HIGH
**Threat:** `AuthState.session` is typed as `any` in `authStore.ts`. This suppresses
TypeScript errors when accessing session properties. A future developer could
accidentally use a stale or malformed session object without the compiler catching it.

**Affected Files:**
- `src/stores/authStore.ts`

**Fix Steps:**
1. Import `Session` from `@supabase/supabase-js`
2. Change `session: any | null` to `session: Session | null` in the `AuthState` interface
3. Verify no TypeScript errors are introduced — fix any property access that relied on `any`

**Expected Result:** Full type safety on session state. `tsc --noEmit` passes.

---

## REVISION 6 — MEDIUM: Answer Text Has No Length Cap
**Risk:** MEDIUM
**Threat:** `scoreAnswer(questionText, answerText)` sends both strings to the AI API
with no length validation. An abusive user could submit a 100,000-character answer,
increasing token consumption 100x per call and potentially hitting API limits.

**Affected Files:**
- `src/lib/ai/index.ts`
- `app/practice/session.tsx` (wherever answer text is submitted)

**Fix Steps:**
1. In the Edge Function (Revision 2), add input validation at the top:
   ```typescript
   if (answerText.length > 3000) {
     return new Response(JSON.stringify({ error: "Answer too long (max 3000 chars)" }), {
       status: 400
     });
   }
   if (questionText.length > 1000) {
     return new Response(JSON.stringify({ error: "Question text too long" }), {
       status: 400
     });
   }
   ```
2. In the practice session screen, enforce the same 3000-char limit on the TextInput
   with `maxLength={3000}` and a live character counter in the UI

**Expected Result:** Token consumption is bounded. No single call exceeds ~1000 tokens.

---

## REVISION 7 — MEDIUM: `.env` Must Be in `.gitignore`
**Risk:** MEDIUM
**Threat:** The `.env` file containing `EXPO_PUBLIC_SUPABASE_ANON_KEY` and
`EXPO_PUBLIC_SUPABASE_URL` is currently untracked (shown in `git status` as `??`).
If `.gitignore` is not correctly configured, a `git add .` could accidentally commit
these credentials to the repo and expose them publicly if pushed to GitHub.

**Affected Files:**
- `.gitignore` (create or update)

**Fix Steps:**
1. Check if `.gitignore` exists. If not, create it.
2. Ensure these lines are present:
   ```
   .env
   .env.local
   .env*.local
   .expo/
   node_modules/
   ```
3. Run `git check-ignore -v .env` to confirm the file is ignored
4. Create a `.env.example` file with placeholder values (no real keys) so other
   developers know what variables are needed:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

**Expected Result:** `git status` no longer shows `.env` as a candidate for staging.

---

## REVISION 8 — MEDIUM: Admin Check Is Client-Side Only
**Risk:** MEDIUM
**Threat:** The `is_admin` flag is read from the `profiles` table and stored in Zustand.
This client-side check (once added per Revision 1) can be bypassed by a user who
patches their local Zustand state. The Supabase RLS policies for admin-only tables
(`app_config`, `questions` write access) must also enforce `is_admin` server-side.

**Affected Files:**
- Supabase RLS policies (verify in dashboard)

**Fix Steps:**
1. In Supabase dashboard → Table Editor → `app_config` → RLS policies:
   - SELECT: allow authenticated users to read non-sensitive keys (NOT `ai_api_key`)
     `key != 'ai_api_key'`
   - SELECT of `ai_api_key`: DENY to all client roles (service role only, via Edge Function)
   - INSERT/UPDATE/DELETE: restrict to `auth.uid() IN (SELECT id FROM profiles WHERE is_admin = true)`
2. For `questions` table:
   - SELECT: allow all authenticated users
   - INSERT/UPDATE/DELETE: restrict to admins only (same policy as above)
3. Verify policies with Supabase's built-in Policy Editor "Test" feature using
   a non-admin JWT

**Expected Result:** Even if client-side is bypassed, server rejects unauthorized mutations.

---

## REVISION 9 — MEDIUM: No HTTPS Enforcement Reminder for Production
**Risk:** MEDIUM
**Threat:** The `openai_compatible` provider example includes `http://localhost:11434/v1`
(Ollama). This is fine for local dev but if a developer deploys with a non-HTTPS
remote URL, API keys travel over plaintext HTTP. Revision 3 addresses validation
but this is a documentation/config reminder.

**Affected Files:**
- `app/admin/ai-config.tsx`

**Fix Steps:**
1. In the Base URL input section, add a warning Text component that appears when
   `baseUrl` starts with `http://` and does NOT include `localhost` or `127.0.0.1`:
   ```
   ⚠️ Non-HTTPS URLs are insecure in production. Use HTTPS for remote providers.
   ```
2. Style the warning in amber/orange using the existing `colors` theme

**Expected Result:** Admins are warned before saving an insecure base URL.

---

## REVISION 10 — LOW: `select('*')` on Profiles Fetches All Columns
**Risk:** LOW
**Threat:** `refreshProfile()` in `authStore.ts` calls `.select('*')` which fetches
every column including `is_admin`, `streak_current`, and future sensitive fields
that may be added. Overfetching increases the attack surface if the response is
ever logged or cached improperly.

**Affected Files:**
- `src/stores/authStore.ts`

**Fix Steps:**
1. Replace `.select('*')` in `refreshProfile()` with an explicit column list:
   ```typescript
   .select('id, full_name, avatar_url, university_target, entry_year, daily_goal, streak_current, streak_longest, streak_last_date, onboarding_complete, is_admin, created_at, updated_at')
   ```
2. Do the same in `updateProfile()` where `.select()` is called after the update

**Expected Result:** Only expected columns are fetched. Future sensitive columns are
not accidentally included without an explicit decision.

---

## Summary Checklist

| # | Risk | Description | Status |
|---|------|-------------|--------|
| 1 | CRITICAL | Admin route auth guard | [x] `app/admin/_layout.tsx` |
| 2 | CRITICAL | AI API key server-side only (Edge Function) | [x] `supabase/functions/score-answer/index.ts` + `src/lib/ai/index.ts` |
| 3 | HIGH | SSRF via unvalidated base_url | [x] `validateBaseUrl()` in Edge Function |
| 4 | HIGH | Rate limiting on AI scoring | [x] 50/hr per user in Edge Function |
| 5 | HIGH | `session: any` type | [x] `src/stores/authStore.ts` uses `Session` |
| 6 | MEDIUM | Answer length cap | [x] `app/practice/session.tsx` maxLength=3000 |
| 7 | MEDIUM | `.env` in `.gitignore` | [x] `.gitignore` + `.env.example` |
| 8 | MEDIUM | Admin RLS policies in Supabase | [x] `supabase/migrations/20260323000000_security_rls.sql` — run in dashboard |
| 9 | MEDIUM | HTTPS warning for base_url | [x] `app/admin/ai-config.tsx` |
| 10 | LOW | Explicit column select on profiles | [x] `src/stores/authStore.ts` explicit columns |

**Implement in order: 1 → 2 → 3 → 4 → 5, then batch 6–10.**
