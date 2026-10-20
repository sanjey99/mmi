# Interview Station — Product Truth

## Product

Interview Station is a web-first interview-practice product for aspiring UK medical students. It helps candidates rehearse written MMI-style answers, receive structured formative feedback, and identify what to improve in the next attempt.

The current release is an invitation-only preview. A small outside-user pilot for adult testers is being prepared to validate the practice loop, feedback quality, reliability, and product direction. This is not a public launch, and it does not imply that legal review, email onboarding, physical-device QA, or human signoff is complete. [External beta readiness and operations](docs/EXTERNAL-BETA-READINESS.md) records the current status and evidence.

## Primary users

- Medical-school applicants preparing for Multiple Mini Interviews.
- Cofounders and trusted content editors who create, review, and manage practice questions.
- Invited adult testers (18+) supplying product feedback during the closed preview.

## Core user jobs

### Candidate

1. Choose all-published or target-university MMI practice.
2. Read a 60-second scenario brief without hidden assessor material, then five ordered response questions.
3. Answer each question for up to 120 seconds using editable browser speech or typing.
4. Understand whether submission and scoring succeeded, failed, or can be retried safely.
5. Review specific, actionable feedback and identify the next area to practise.
6. Review recent progress without mistaking activity for mastery.

### Cofounder or content editor

1. Add and validate questions without editing the database directly.
2. Understand whether a question is draft, available to candidates, invalid, or duplicated.
3. Correct or deactivate content safely.
4. Test the exact candidate experience before a wider closed round.

## Closed-preview scope

The preview includes:

- Sign in and onboarding.
- Home and orientation.
- One 11-minute MMI flow: a 60-second brief and five 120-second questions.
- Five-level criterion scoring after the station finishes, with weighted totals, bounded supporting evidence, justifications, retry/expiry status, and historical results.
- All-published and target-university practice pools, feedback, and progress.
- Profile and explicit sign out.
- Tester reports with optional follow-up permission.
- Administrator-only station/content management, AI configuration, structured assessment review, and usage/cost inspection.

The MMI candidate flow is live. Tutor marketplace and unfinished browsing surfaces remain outside this release. Legacy endpoints or screens that remain for compatibility are not the current candidate practice contract.

## Platform and session commitment

- The current target is responsive web deployed through Vercel.
- The approved candidate app is [mmi-hazel.vercel.app](https://mmi-hazel.vercel.app), using shared Supabase project `tliwifhnsytxpcynuwsy`. The owner's explicit choice supersedes old isolated-preview targets.
- The GPT-5.5 comparison app shares the backend and account/history data. Its model profile is enforced server-side as administrator-only; ordinary testers use the main app.
- Access uses named invited accounts. Testers do not need Supabase/Vercel team access, shared passwords, or administrator privileges.
- Web authentication is session-only: refreshes in the same browser session remain signed in, while closing the browser session clears local authentication persistence.
- A visible, functioning Sign Out action is always available.
- Nested and transactional pages provide a predictable return path even when opened directly or through a deep link.

## Learning commitments

- Practice requires active response generation rather than passive content browsing.
- Feedback compares the submitted response with an explicit practice standard and gives actionable next steps.
- System status is visible throughout loading, submission, scoring, success, failure, and retry states.
- Progress emphasizes demonstrated performance, coverage, and areas needing practice rather than decorative streaks alone.
- The interface reduces avoidable cognitive load during question reading and answer composition.

## Safety and trust

- AI feedback is formative practice guidance, not clinical, admissions, or professional advice.
- Private answers and hidden assessor content are never exposed outside their authorized boundary.
- Provider errors, secrets, stack traces, and internal rubrics are not shown to candidates.
- Server-owned claims prevent concurrent duplicate scoring calls; completed assessments are reused and paid retries are bounded rather than treated as free or unlimited.
- Content shown to candidates must be intentionally available and must exclude guidance notes or assessor-only material.
- The app stores no raw MMI audio. It deletes the full transcript after successful scoring and purges unresolved text within 24 hours. Supporting excerpts of up to 300 characters per criterion and justifications remain with feedback; an excerpt may contain a complete short answer. External speech/AI processing must be disclosed separately.
- Hosted changes require a concrete scoped operation covered by the user's authorization. Local product work and credential-gated integration suites do not authorize mutations to shared user data.
- The current terms/privacy notices remain reviewable drafts. Operator identity, working support contact, provider handling, retention decisions for other records, and qualified external-test review must not be invented or presented as complete.

## Product identity commitments

- The product name remains **Interview Station** for the closed preview.
- The product must have an independently derived visual identity and must not reproduce Quesmed or another study platform's assets, copy, palette, typography pairing, component grammar, illustrations, navigation treatment, or overall visual impression.
- Familiar web conventions remain where they improve accessibility and task clarity; product-specific expression must come from Interview Station's own interview-practice mechanism and audience context.

## Success for this work

- Cofounders can navigate the shipped preview without dead ends.
- They can sign out reliably and understand the session policy.
- Available question counts and empty categories are truthful.
- Question submission always produces visible, accessible status and never appears to do nothing.
- The redesigned interface is clearly distinguishable from Quesmed while remaining efficient for focused interview practice.
- The implementation passes the repository's TDD, coverage, typecheck, build, full-test, accessibility, security-review, Impeccable, and un-vibecode gates.
