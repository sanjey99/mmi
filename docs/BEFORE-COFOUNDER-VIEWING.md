# Before cofounder viewing

Updated 20 October 2026. Use [External beta readiness and operations](EXTERNAL-BETA-READINESS.md) for current release evidence, outside-user preparation, invitations, support, and the test matrix. This page records the product contract and human review still required.

## Current deployment decision

The product owner explicitly approved the existing live [main app](https://mmi-hazel.vercel.app) and shared Supabase project `tliwifhnsytxpcynuwsy`. This replaces the earlier isolated-project/protected-preview requirement. The isolated project `obfwfoykalvoxqdnosus` remains a separate test environment, not the current release destination.

The main app uses source `3c78e896dc2ad4f3dd471cae3268445b10c74936`. The five-level migration and scorer are deployed. On 20 October, the GPT-5.5 comparison frontend was corrected to the same source so it can read the new feedback. The comparison model remains administrator-only and uses the same backend; ordinary testers use the main app. Full identifiers and evidence limits are in the [release record](EXTERNAL-BETA-READINESS.md#current-approved-release).

Historical unchecked deployment tasks do not mean these completed operations need to be repeated. Historical plans are not current release gates; their backend targets, binary scoring, and prohibition on retained evidence excerpts were superseded by later approved work.

## Product contract

- One candidate MMI flow is available to invited signed-in users, with all-published or target-university practice pools.
- A station lasts 11 minutes: a 60-second read-only scenario brief, then five ordered 120-second response questions. No answer is expected during the brief.
- Browser speech adds editable transcript text; typing remains available when permission is denied, speech is unsupported, or recognition stops. The app stores no raw audio.
- AI scoring starts only after Q5 finishes. Each existing criterion receives one of five performance levels: 0%, 25%, 50%, 75%, or 100% of its weight. The server calculates the weighted result and retains bounded supporting excerpts and justifications.
- Successful scoring deletes the full transcript. Unresolved text is purged within 24 hours. Supporting excerpts of up to 300 characters per criterion remain and may contain a complete short answer. Browser speech and AI providers have their own processing arrangements.
- Failed scoring preserves the completed station and offers an honest retry/expiry state; it never creates a fake score. Paid retries use bounded server-owned claims.
- Camera/webcam capture is outside this release.

## Question source mapping

| Meaning | Google Sheet / source | Supabase |
| --- | --- | --- |
| 60-second scenario brief | `stations.scenario_text` | `mmi_stations.scenario_text` |
| Five response questions | `sub_questions.question_text` | `mmi_sub_questions.question_text` |
| Parent station | `station_id` | `station_id` |
| Question sequence | `order` | `order_num` |

For example, `MMI_001` is one station and `MMI_001_Q1` through `MMI_001_Q5` are its ordered questions. The brief must not be combined with Q1 or include an answer. Published content was previously verified as 155 stations and 775 ordered questions; refresh counts during a release/content change rather than treating those numbers as permanent.

## Engineering evidence already recorded

- Automated coverage exercises timing, future-question hiding, transcript checkpoints/finalization, account boundaries, scoring, and historical result compatibility.
- The five-level migration's eight function bodies and deployed scorer were verified against the release source.
- Recent hosted metadata showed schema-v4 scoring on two existing-account attempts. The comparison correction passed 61 unit checks and two browser checks.

These are engineering results, not proof of a fresh invitation journey, physical speech permissions, screen-reader behavior, legal approval, or human scoring quality.

## Human review still to record

Use the evidence columns in the [pilot test matrix](EXTERNAL-BETA-READINESS.md#pilot-test-matrix). Record tester, date, browser/device, result, and issue reference for each applicable check.

- [ ] Microphone Allow and Deny; typing remains usable.
- [ ] Unsupported speech, interruption, and restart; committed words survive.
- [ ] Brief → Q1 → Q2 → Q3 → Q4 → Q5 → completion and refresh/resume.
- [ ] Keyboard-only operation, screen-reader announcements, mobile keyboard, and reduced motion.
- [ ] Representative question/content review and human assessment of partial scores, evidence, and next steps.
- [ ] No raw audio, secrets, full answers, or provider payloads leak into public logs/URLs/reports; retained evidence matches the disclosure.
- [ ] An invited ordinary account signs in, signs out, and cannot use admin functions or read another account's records.
- [ ] Cofounder/product owner records the decision, approved scope, and known limitations.

Deliberate provider failures, credential-gated integration suites, fixtures, and clock/role manipulation belong in disposable local or isolated tests, never the shared backend. Normal hosted smoke uses authorized accounts and synthetic answers without changing shared provider configuration.

Before outside invitations, also complete the operator/contact, email/callback, terms/privacy review, retention-health, and support ownership items in [External beta readiness](EXTERNAL-BETA-READINESS.md#decisions-and-checks-still-open). Do not mark human checks complete from automated evidence alone.
