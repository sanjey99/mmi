# Interview Station

A React Native + Expo app for UK medical school interview preparation. Targets MMI and panel-style interviews, with AI-powered answer scoring across 5 dimensions.

**Current focus:** Stabilise Phases 1–3 · **Next feature:** Phase 4 question-bank browser

---

## Quick Start

### Prerequisites

- Node.js 20+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Expo Go](https://expo.dev/client) on your phone (for development), or Android/iOS simulator

### 1. Install dependencies

```bash
cd InterviewStation
npm install
```

### 2. Set up Supabase

1. Create a [Supabase](https://supabase.com) project
2. Run migrations in filename order in the **SQL Editor**:

```bash
# Copy and paste the contents of both files:
supabase/migrations/001_initial.sql
supabase/migrations/20260323000000_security_rls.sql
supabase/migrations/20260805000000_ai_key_write_only.sql
supabase/migrations/20260805010000_ai_key_function_only_writes.sql
```

3. Deploy the AI Edge Functions:

```bash
supabase functions deploy score-answer
supabase functions deploy manage-ai-key
```

4. Create `.env` in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Configure AI Provider (Admin)

After launching, sign in, then open **Admin → AI Configuration**:

| Provider | API Key format | Model example | Base URL |
|---|---|---|---|
| Anthropic | `sk-ant-...` | `claude-3-5-haiku-20241022` | — |
| OpenAI | `sk-...` | `gpt-4o-mini` | — |
| Groq | your key | `llama-3.1-8b-instant` | `https://api.groq.com/openai/v1` |
| Together AI | your key | `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo` | `https://api.together.xyz/v1` |
| Ollama (local) | `ollama` | `llama3.2` | `http://localhost:11434/v1` |

The first admin account can be created by setting `is_admin = true` directly in the `profiles` table via the Supabase dashboard.

### 4. Run

```bash
npm start          # Expo dev server (scan QR with Expo Go)
npm run android    # Android emulator
npm run ios        # iOS simulator (Mac only)
npm run export:web # Static web export to dist/
npm run test:e2e  # Browser flow (requires an isolated E2E deployment)
```

### Integration and E2E test environments

The Supabase contract tests are deliberately opt-in. Never point them at the production project: they create temporary users and replace a test AI key.

```env
SUPABASE_TEST_URL=https://isolated-test-project.supabase.co
SUPABASE_TEST_ANON_KEY=...
SUPABASE_TEST_SERVICE_ROLE_KEY=...
# Enables the live scoring assertion after an admin replacement.
SUPABASE_TEST_AI_KEY=...

E2E_BASE_URL=https://isolated-test-web-deployment.example
E2E_STUDENT_EMAIL=...
E2E_STUDENT_PASSWORD=...
```

Apply the migrations and deploy both Edge Functions to that isolated project first. `npm test -- --run` then exercises the Supabase policy/function contract; `npm run test:e2e` checks onboarding → practice → feedback → progress in a browser.

### Production dependency audit

`npm audit --omit=dev` currently reports 21 findings (1 critical, 7 high, 12 moderate, 1 low). The remaining findings are mainly in Expo SDK 55 / React Native tooling dependencies. A clean resolution requires an approved Expo SDK 57 migration; do not run `npm audit fix --force`. The compatible transitive upgrades should be handled as a separate, reviewed lockfile-only change after this uncommitted cleanup is parked.

---

## Project Structure

```
InterviewStation/
├── app/                     # Expo Router screens
│   ├── (auth)/              # Login, signup
│   ├── (tabs)/              # Main tab screens
│   │   ├── index.tsx        # Home dashboard
│   │   ├── practice.tsx     # Practice entry
│   │   ├── questions.tsx    # Question bank (Coming Soon — Phase 4)
│   │   ├── progress.tsx     # Progress & stats
│   │   └── tutor.tsx        # Book a tutor (Phase 6)
│   ├── practice/
│   │   ├── session.tsx      # Active interview screen
│   │   └── feedback.tsx     # AI feedback + scores
│   ├── admin/
│   │   ├── index.tsx        # Admin dashboard
│   │   ├── ai-config.tsx    # ★ Configure AI provider
│   │   └── questions.tsx    # ★ Import questions via CSV
│   ├── onboarding.tsx
│   └── profile.tsx
├── src/
│   ├── lib/
│   │   ├── ai/index.ts      # ★ Plug-and-play AI adapter
│   │   ├── questions.ts     # Question service + CSV importer
│   │   └── supabase.ts
│   ├── stores/
│   │   ├── authStore.ts     # Zustand auth
│   │   └── practiceStore.ts # Zustand practice + scoring
│   ├── components/ui/       # RadarChart, ScoreDimensionBar, TimerRing, ...
│   ├── theme/               # Colors, typography, spacing
│   └── types/index.ts
└── supabase/migrations/
    └── 001_initial.sql      # Full schema + RLS + seed questions
```

---

## Key Features

### AI Scoring (Plug-and-Play)

Answers are scored by an AI across 5 dimensions:

| Dimension | What it assesses |
|---|---|
| **Structure** | Logical flow, STARR/SPAR framework |
| **Ethics** | Four pillars: autonomy, beneficence, non-maleficence, justice |
| **Communication** | Clarity, vocabulary, fluency |
| **Reflection** | Self-awareness, personal growth |
| **NHS Awareness** | NHS values, current policy |

The AI provider is configured at runtime — not hardcoded. Any OpenAI-compatible API works.

### Question Bank (CSV Import)

Admins can upload questions via CSV. Format:

```csv
category,text,difficulty,subcategory,university_tags,is_mmi_suitable,guidance_notes
ethics,"A 16-year-old requests contraception...",intermediate,clinical_scenarios,"oxford,cambridge",true,Consider Gillick competence
```

Required: `category`, `text`, `difficulty`
Optional: `subcategory`, `university_tags`, `is_mmi_suitable`, `guidance_notes`

Valid categories: `motivation | ethics | nhs | teamwork | resilience | scenarios`
Valid difficulties: `foundation | intermediate | advanced`

---

## Phase Roadmap

| Phase | Status | Features |
|---|---|---|
| 1 | ✅ Done | Auth, onboarding, home dashboard |
| 2 | ✅ Code complete | Practice sessions, AI scoring, feedback — deploy Edge Functions/migrations before release |
| 3 | ✅ Code complete | Progress tracking, streak calendar, admin panel — deploy migrations before release |
| 4 | 🔜 Next | Full question bank browser (replace "Coming Soon") |
| 5 | 🔜 | MMI circuit mode (multi-station timed sessions; currently not exposed) |
| 6 | 🔜 | Tutor marketplace with Stripe payments |

---

## Design System

**"Clinical Precision"** aesthetic:
- Fonts: DM Serif Display (headings) + DM Sans (body)
- Background: warm ecru `#F7F3EE`
- Primary: deep navy `#0F1E3D`
- Accent: teal `#00B4A6`
- Cards: 16px radius, 1px border, subtle shadow

See `The Vault/projects/interview-station/design-system.md` for full token reference.
