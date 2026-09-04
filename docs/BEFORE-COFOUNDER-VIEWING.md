# Before Cofounder Viewing

This is the authoritative checklist for showing the MMI practice app to a cofounder. Historical plans are not release gates.

## Product contract

- There is one MMI practice flow for every invited, signed-in user. There is no separate founder, cofounder, or candidate practice mode.
- One station lasts exactly 11 minutes: a 60-second read-only scenario brief followed by five ordered 120-second response questions.
- During the brief, the user reads only. There is no response box and no answer is expected.
- During each response question, browser speech recognition can add words to an editable transcript. Typing remains available at all times.
- The app stores transcript text for recovery and AI scoring. It does not record, upload, or store raw audio.
- If microphone permission is denied, speech recognition is unsupported, or recognition stops, the user can complete the station by typing.
- The AI evaluates all five finalized responses only after the complete station finishes. It never shows feedback between questions.
- The AI uses versioned scoring criteria owned by the server. A provider failure keeps the completed station and offers **Retry AI scoring**; it never creates a fake score.
- Camera/webcam capture is not in this version. It is a future product enhancement, not a hidden requirement for viewing the current app.

## Question source mapping

The Google Sheet and database use the same separation:

| Meaning | Google Sheet | Supabase |
| --- | --- | --- |
| 60-second scenario brief | `stations.scenario_text` | `mmi_stations.scenario_text` |
| Five 2-minute questions | `sub_questions.question_text` | `mmi_sub_questions.question_text` |
| Link between them | `station_id` | `station_id` |
| Question sequence | `order` | `order_num` |

For example, `MMI_001` is one station and `MMI_001_Q1` through `MMI_001_Q5` are its five ordered questions. The brief must not be combined with Q1 and must not contain an answer.

## Standing deployment rule

Unless the product owner explicitly opts out, reviewable work must be available in both:

- a Vercel deployment built from the exact reviewed Git commit; and
- the isolated Supabase project `obfwfoykalvoxqdnosus` (`mmi-cofounder-preview`).

Never deploy this preview work to the shared Supabase project `tliwifhnsytxpcynuwsy`.

## Already verified

- [x] The isolated Supabase preview project is provisioned and separate from shared data.
- [x] The normalized content contains exactly 155 published stations and 775 ordered questions: five questions for each station.
- [x] Automated tests prove the 60 + (5 × 120) timing contract, future-question hiding, transcript checkpoint/finalization, account isolation, and private table access.
- [x] Browser speech is optional, typing is always available, and no app audio storage surface exists.
- [x] Database scoring claims are rejected until the station is complete and all five responses are finalized.
- [x] The scoring function uses built-in versioned AI criteria and schema-validates results before showing a score.
- [x] The completed screen starts scoring for Q1–Q5, preserves completion on failure, and offers retry.

## Remaining before cofounder viewing

- [ ] Integrate the branch with current `origin/main`, run the complete verification suite against the exact resulting SHA, push it, and open or update the pull request.
- [ ] Apply the forward migration `20260904000000_single_mmi_station.sql` to isolated Supabase project `obfwfoykalvoxqdnosus` and verify the 155/775 content remains intact.
- [ ] Deploy `score-candidate-mmi-response` to that same isolated project and confirm its server-only AI provider configuration produces a real schema-valid result.
- [ ] Deploy the exact reviewed SHA to a protected Vercel Preview using the isolated Supabase public URL and anon key.
- [ ] Run an invited-account hosted smoke: sign in, read the 60-second brief, answer all five 120-second questions, complete the station, receive AI feedback, retry a deliberately failed scoring request, refresh/resume, and sign out.
- [ ] Complete the manual browser/device/accessibility/privacy checks below and record the date, browser/device, tester, and result.
- [ ] Cofounder reviews the deployed app and records product signoff.

## What manual device/accessibility QA means

This is a hands-on check because automated tests cannot prove native permission dialogs, physical keyboards, browser speech services, or screen-reader output.

- Microphone: test **Allow** and **Deny**; denial must leave typing usable.
- Speech fallback: test a browser without supported speech recognition and confirm typed input still works.
- Recovery: refresh during the brief and during a response; the same station and remaining server-controlled time must resume.
- Timing: observe the brief → Q1 → Q2 → Q3 → Q4 → Q5 → completion transitions. Future questions must remain hidden.
- Interruption: pause/restart speech recognition and confirm the editable transcript does not lose committed words.
- Keyboard/accessibility: complete the flow using only a keyboard, then check labels and status announcements with a screen reader.
- Mobile: verify the timer, prompt, transcript, and controls remain usable when the on-screen keyboard opens.
- Reduced motion: enable the operating-system preference and confirm no required information depends on animation.
- Sensitive data: inspect browser console, URLs, analytics, error monitoring, and storage. Raw audio, credentials, full provider payloads, and transcripts must not leak into logs or public locations.

Record failures as issues; do not mark this item complete from automated evidence alone.

## Cofounder signoff

- [ ] The brief is visible alone for 60 seconds and contains no answer.
- [ ] Five questions appear one at a time for 120 seconds each.
- [ ] Microphone transcription and typed fallback both work; the app stores no audio.
- [ ] Refresh/resume preserves the current station safely.
- [ ] AI scoring begins only after the station completes and returns real feedback or an honest retry state.
- [ ] The deployed Vercel build and isolated Supabase backend match the recorded exact SHA.
- [ ] Cofounder name, decision, date, and notes are recorded.

Do not call the preview ready until every remaining item above is checked with current hosted evidence.
