# Interview Station

A React Native + Expo app for UK medical school interview preparation. Targets MMI and panel-style interviews, with AI-powered answer scoring across 5 dimensions.

**Target launch:** July 2026 · **Phase:** 3 of 6

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
2. Run the migration in **SQL Editor**:

```bash
# Copy and paste the contents of:
supabase/migrations/001_initial.sql
```

3. Create `.env` in the project root:

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
```

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
| 2 | ✅ Done | Practice sessions, AI scoring, feedback |
| 3 | ✅ Done | Progress tracking, streak calendar, admin panel |
| 4 | 🔜 Next | Full question bank browser (replace "Coming Soon") |
| 5 | 🔜 | MMI circuit mode (multi-station timed sessions) |
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
