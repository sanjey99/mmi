# Interview Station — Product Truth

## Product

Interview Station is a web-first interview-practice product for aspiring UK medical students. It helps candidates rehearse written MMI-style answers, receive structured formative feedback, and identify what to improve in the next attempt.

The current release is a closed cofounder preview, not a public launch. It exists to validate the core practice loop, question-authoring workflow, feedback quality, reliability, and product direction with a small trusted group.

## Primary users

- Medical-school applicants preparing for Multiple Mini Interviews.
- Cofounders and trusted content editors who create, review, and manage practice questions.
- Cofounders testing the product and supplying product feedback during the closed preview.

## Core user jobs

### Candidate

1. Choose a practice mode and an available question category.
2. Read one interview prompt without hidden assessor material.
3. Compose and submit a considered response.
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
- Free and timed legacy question practice.
- Submission, scoring status, feedback, and progress.
- Profile and explicit sign out.
- Cofounder administration for questions and AI configuration.

The preview does not present unfinished surfaces as working products. Tutor marketplace, the placeholder student Questions area, MMI Circuit, and incomplete Phase 4 student flows remain hidden until their real workflows and release gates exist.

## Platform and session commitment

- The current target is responsive web deployed through Vercel.
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
- A failed scoring call must not create duplicate paid calls or duplicate answer records when retried.
- Content shown to candidates must be intentionally available and must exclude guidance notes or assessor-only material.
- Supabase remains read-only during local product work unless an exact remote mutation is separately shown and approved.

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
