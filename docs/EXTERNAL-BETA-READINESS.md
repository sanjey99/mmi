# External beta readiness and operations

Updated 20 October 2026 (Singapore time).

The engineering rollout is live, and receipt of the first authorized invitation is confirmed. A small invited outside-user pilot is being prepared; completed password setup/login/recovery, legal approval, physical-device QA, and human product signoff remain unverified. Use the status and evidence below before expanding access.

## Current approved release

The product owner explicitly selected the existing live app and shared backend. This supersedes older instructions requiring the isolated cofounder backend, a protected Vercel Preview, or the historical feature branch.

| Surface | Approved target |
| --- | --- |
| Candidate app | [mmi-hazel.vercel.app](https://mmi-hazel.vercel.app) |
| Backend | Supabase project `tliwifhnsytxpcynuwsy` |
| Application source | `7494ba380f3e7a47c59d86540095305cc724aa21`; [release PR #15](https://github.com/sanjey99/mmi/pull/15) |
| Main deployment | `dpl_D1Z9dhSLNa7nsBhuvykGpGtPpSF1`, READY and promoted to production on 20 October 2026; [immutable build](https://mmi-88oqi6omj-sanjey99s-projects.vercel.app) |
| Scorer | `score-candidate-mmi-response`, ACTIVE version 21, JWT verification enabled |
| Scoring migration | `20261017000000_mmi_five_level_scoring.sql`; SHA-256 `b45e0c89c8dfc9588bd61d62563e3df28433eb4ae56e7f3ac5b3ec7b1ceb622d` |
| GPT-5.5 comparison | [mmi-gpt55.vercel.app](https://mmi-gpt55.vercel.app), administrator-only model profile; same shared backend and account/history data |
| Comparison deployment | `dpl_7FkGPsFxVNMykLPhUf8nk1C3Qc7n`, READY on 20 October 2026 with `mmi-gpt55.vercel.app` assigned; [immutable build](https://mmi-knpxje3hy-sanjey99s-projects.vercel.app), source `7494ba3` |

Do not switch either app to the isolated project `obfwfoykalvoxqdnosus` as a routine setup or rollback step. A new backend or model-profile change needs a separately scoped operation.

The owner explicitly approved the comparison deployment. Both apps now serve the account-access release from `7494ba3`; the comparison model profile remains administrator-only on the same shared backend.

## Completed engineering evidence

| Item | Result and evidence | Limit |
| --- | --- | --- |
| Five-level scoring | Migration and scorer deployed. Eight migration function bodies were verified against the reviewed source. Levels award 0%, 25%, 50%, 75%, or 100% of each criterion's existing weight, with bounded answer evidence and justification. | Historical results stay compatible; existing answers were not regraded. |
| Main app and scorer compatibility | Main app serves source `7494ba3` against the shared backend; production promotion is recorded above. | A genuine received-email onboarding journey has not been verified. |
| Comparison app compatibility | With explicit owner approval, `experiment/gpt-5-5` advanced to `7494ba3`; the READY build and comparison alias are recorded above. Live browser checks verified the new invitation wording and **Forgot password** link on the comparison login. | Ordinary testers use the main app. The comparison profile remains server-enforced as administrator-only. |
| Recent hosted results | Metadata for two existing-account attempts on 20 October showed four scored schema-v4 responses and one no-response outcome each. | This is not evidence that a new invitation, email delivery, or password setup works. |
| Focused regression checks | 61 unit checks and two browser checks passed for the comparison correction. | Automated checks do not establish physical microphone, screen-reader, or human scoring-quality approval. |
| Local beta onboarding and regression validation | On 20 October, the full suite passed: 54 Node checks and 648 Vitest checks (702 total), type checking, production build, and 41 browser cases (19 account-access, 18 practice/preview, and four admin cases). Account-link cleanup, password setup/recovery, pending-setup gating, legal-page access, and existing journeys were covered locally. | These checks do not prove received-email delivery, physical-device/accessibility QA, or legal approval. |
| Hosted account-access configuration | Hosted Auth Site URL is `https://mmi-hazel.vercel.app` with no trailing slash. Exact redirects `https://mmi-hazel.vercel.app/auth/callback` and `https://mmi-hazel.vercel.app/auth/callback?type=recovery` were added. Tracked invitation/recovery HTML and subjects were saved in hosted Auth. | Domain/custom SMTP remain pending. Saved configuration alone does not prove a valid-link journey. |
| Canonical main-app smoke check | Browser checks on the production main app verified the new invitation wording, **Forgot password** link, recovery screen, and safe error for an empty callback. Callback response headers were verified for `no-store`, `no-referrer`, `nosniff`, and `noindex`. | No valid invitation/recovery token or received email was used; password creation, subsequent login, and delivered recovery remain unverified on the hosted app. |
| First authorized invitation | One invitation was submitted through Auth Users at 17:34:56 Singapore time on 20 October. The account was created, and the recipient confirmed actual receipt in the current chat. A read-only check found exactly one profile for that account with ordinary-tester status. | Password setup, subsequent login, reset-email receipt, and the complete hosted journey remain pending. This single receipt does not establish delivery to a wider outside group. Recipient details and account identifiers stay outside Git. |

Dependency audit on 20 October 2026: after compatible patches to `shell-quote` 1.11.0, `compression` 1.8.2, `source-map-js` 1.2.2, and `brace-expansion` 1.1.21 / 5.0.12, `npm audit --omit=dev` reports **37 affected package entries: 0 critical, 21 high, and 16 moderate**. Counts include inherited findings across Expo, Metro, and Jest dependencies; they are not counts of independently reachable browser flaws. Remaining high findings primarily concern build/development tools, including [unpatched `braces` pattern recursion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [unpatched `node-forge` signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv). These Node tool paths are not the static Vercel site's HTTP server, but remain relevant when development or CI processes untrusted patterns, files, or certificates. The exported browser bundle does contain `decode-uri-component` 0.2.2 through `query-string` 7.1.3, with a [moderate malformed-input denial-of-service advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr); execution through the current Expo URL path has not been proven, since Expo's routing fork uses `URLSearchParams`. Its patched version 0.5.0 changes to an ESM export, so no blind override was applied. No Expo or React Native major upgrade, framework downgrade, or forced audit fix was attempted. Record this residual risk for the pilot decision, complete the targeted decoder review, and verify the final build after dependency changes; this audit is not clean.

## Decisions and checks still open

The role names below identify responsibility; they do not imply someone has already accepted that responsibility.

| Need | Current status | Owner / next evidence |
| --- | --- | --- |
| Operating person or company | Legal/operator name not supplied. | Product owner supplies the identity to use in notices and support records. |
| Working support contact | `support@interviewstation.com` is a planned address only. The owner explicitly paused the domain step; ownership, mailbox delivery, and sender configuration remain unverified. | Use the existing invitation channel for now. Resume domain/mailbox work only when requested, or designate an existing working contact. Do not publish the planned address as operational. |
| First invitation recipient | The authorized first invitation was submitted once on 20 October; the recipient confirmed receipt. The new account has one ordinary-tester profile. | Operator keeps recipient details in the restricted invitation log, outside Git, and records password setup, subsequent login, and recovery outcomes. |
| Email sender / custom SMTP | Built-in Auth mailer only; the first authorized invitation was received. Custom SMTP and wider outside-group delivery remain unverified. The owner paused the domain step. | Resume domain/sender work only when authorized, then verify custom SMTP, sender identity, delivery limits, and broader pilot delivery. |
| Invitation callback and password setup | Both app releases are deployed. Hosted Site URL, exact invitation/recovery callbacks, tracked HTML templates, and subjects are saved; canonical recovery and empty-callback states were checked. First invitation receipt is confirmed; the valid-link journey remains unverified. | First recipient and operator record valid-link password creation, subsequent login, reset-email receipt, and recovery completion. Preserve the approved main-app destination and exact callbacks. |
| Hosted public signup | Read-only hosted check on 20 October: public email signup OFF, anonymous signup OFF, and email confirmation ON. | Preserve these settings and verify the ordinary invited-account journey. The closed signup screen is additional UI guidance. |
| External-test terms and privacy | Reviewable draft notices now describe invited adult testers aged 18 or over, the shared data flows, bounded retained excerpts, and unresolved operator/contact and review items. Qualified legal review remains pending. | Product owner obtains qualified review and approves the outside-user scope, operator/contact, provider handling, and retention decisions. This document gives no legal approval. |
| Current retention health | Read-only check on 20 October 2026 at 16:43:10 Singapore time (08:43:10 UTC): purge job active on `*/5 * * * *`; last completion 16:40:00 Singapore (08:40:00 UTC), age 190 seconds; zero overdue response transcripts and drafts. | Operator repeats the aggregate/heartbeat check during the pilot. This is a timestamped observation, not a guarantee of future scheduler health. |
| Physical-device and accessibility QA | Evidence not recorded; see matrix below. | Named human tester records browser/device, date, result, and issue references. |
| Content and scoring-quality signoff | Human signoff not recorded. | Product owner/content reviewer checks representative questions and evidence-based feedback, then records the pilot decision. |
| Pilot size, use allowance, and review owner | Not recorded. | Product owner names the initial group, expected stations per tester, spend allowance, review frequency, and person handling reports. |

The owner has paused domain work for now; no domain purchase or mailbox setup is implied. Owning a domain does not create a working mailbox. A functioning contact and verified sender can use an existing owner-controlled domain; buying a new app domain is not itself evidence that support or invitations work.

As checked on 20 October, [Supabase's SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp) limits its built-in mailer to project-team addresses and currently two messages per hour per project; these limits may change. The one confirmed receipt does not establish delivery to arbitrary outside addresses. Configure an approved custom sender before expanding outside the mailer's supported recipients; do not grant testers project-team access to bypass that restriction.

## Issue an ordinary tester account

1. Confirm the recipient and pilot scope are authorized. Issue one named account per tester with `profiles.is_admin = false`. Testers need no Supabase or Vercel team access, database credentials, provider key, or shared login.
2. In the live Supabase project, inspect Auth configuration: main site URL, the exact invitation/recovery callback URLs supported by the app, public signup disabled, and custom SMTP/sender details. Avoid wildcard redirects. Verify the callback and password-setup route before sending email.
3. For wider outside-group invitations, configure the owner-approved custom sender and verify delivery to an authorized recipient. The first built-in-mailer receipt is recorded above and does not establish wider deliverability. Do not mark delivery successful from a dashboard “sent” state alone.
4. Use **Supabase Dashboard → Authentication → Users → Add user → Send invitation** for that recipient. Use the main candidate app as the destination. Do not grant an administrator role to make onboarding work.
5. The recipient opens the genuine invitation, completes the app's supported password setup, signs out, and signs in again with their own password. Test recovery delivery and password replacement through the supported recovery flow; do not send passwords in email or reports.
6. Confirm the account sees candidate practice, cannot open admin functions, and can submit a tester report. Record received time and outcomes in the restricted invitation log. Never save invitation tokens, full email links, passwords, or screenshots containing them in Git or issue reports.
7. Expand invitations only after the first journey succeeds and the remaining pilot decisions above are recorded. For expiry or delivery failure, diagnose the sender/callback and resend through Auth; do not repeatedly create accounts or manufacture invitation tokens.

## Pilot test matrix

Use ordinary, authorized accounts and synthetic answers. Run credential-gated integration tests, clock manipulation, role elevation, fixtures, and deliberate provider/configuration failures only against a disposable local or isolated test project, never the production/shared backend. Shared-host smoke tests use the normal candidate journey and must not alter shared provider settings to force an error.

| Check | Expected result | Current status | Evidence to record / owner |
| --- | --- | --- | --- |
| Invitation delivery, callback, password, login, reset | Received email leads to the intended app; own password and recovery work. | First invitation received; deployed recovery and empty-callback UI verified. Password setup, login, reset receipt, and full valid-link journey pending. | Restricted delivery log; recipient + operator |
| Ordinary account boundaries | Candidate can practise; admin and comparison-model access remain denied. | Read-only check confirms one ordinary-tester profile for the new account; logged-in hosted access checks pending. | Test account reference and outcome; engineering |
| Server signup setting | Public signup disabled, invited-account flow available. | Hosted public and anonymous signup OFF; email confirmation ON, checked 20 October | Preserve settings; first receipt confirmed, complete invitation journey pending; operator |
| Station timing and refresh | 60-second brief, five 120-second questions, future questions hidden; refresh resumes server time. | Automated coverage; current manual journey unrecorded | Date/browser and transition results; human tester |
| Allowed microphone and interruption | Speech adds editable text; stop/restart preserves committed words. | Physical-device check pending | Device/browser and result; human tester |
| Denied or unsupported speech | Typing works and the station can finish. | Physical/browser check pending | Device/browser and result; human tester |
| Feedback and retry | Feedback appears after Q5; levels, totals, evidence and justifications are understandable; failure remains retryable without inventing a score. | Existing-account v4 metadata verified; human quality review pending | Safe result summary; reviewer. Force failure only in disposable tests. |
| Cross-account signout | Signout works; another account cannot recover the first user's answer/result. | Automated coverage; fresh-account hosted check pending | Two authorized account references, no answer text; engineering |
| Keyboard and screen reader | Controls, notices, prompts, and status changes are usable and announced. | Human check pending | Keyboard + named screen reader/browser; human tester |
| Mobile keyboard and reduced motion | Timer, prompt, answer controls remain usable; no required motion. | Human check pending | Device/viewport/preferences; human tester |
| Reporting and support | Report is saved, appears for an admin, and respects follow-up permission. | Feature exists; pilot round trip unverified | Safe report ID and review outcome; support owner |
| Privacy and retention | No raw-audio upload or secrets/answer content in public logs; full transcripts purge; bounded excerpts remain as disclosed. | Hosted purge/heartbeat check passed at 16:43:10 Singapore on 20 October: 190-second heartbeat, active five-minute job, zero overdue text. Manual device/log inspection remains pending. | Repeat safe aggregate checks during pilot; operator. Record manual inspection separately. |
| Final pilot decision | Named owner accepts outstanding known limitations and approves the pilot scope. | Pending | Name, date, scope, open issues; product owner |

## Support, incidents, and data requests

- The main app's **Tester report** accepts bug, usability, content, and scoring reports. Include the screen, expected/observed behavior, time, browser, and build. Do not paste real patient information, answers, transcripts, credentials, or invitation links. No such attachments are added automatically.
- Assign a person to review **Admin → Feedback desk** and the working support channel at the agreed frequency. The desk shows the latest 100 reports; there is no verified automatic notification or issue-resolution workflow. Respect the tester's follow-up preference; an account ID is omitted from the review response when permission is off.
- For suspected unauthorized access or exposed data, stop expanding access and contact the designated operator promptly. For blocking login/scoring failures, preserve the completed attempt, inspect safe error stages, and give a clear update. Avoid repeated paid retries while investigating. Track lesser usability/content issues with an owner and disposition.
- Password help goes through the verified Auth recovery flow. Staff do not ask for the tester's password or reset link.
- For access, export, correction, or deletion requests, verify the requester through their account/invitation channel, record the minimum request details privately, confirm scope, and assign an owner. Deliver exports through an approved private channel; never commit them or attach full answers to public tickets.
- Suspension and deletion are separate operations. Obtain explicit owner authorization for the exact account and duration before a temporary, reversible Auth ban; verify how existing sessions are affected. Restoring access requires its own recorded decision. Do not delete an account as a shortcut for suspension or troubleshooting.
- Account deletion is destructive and needs separate explicit authorization for the identified account and intended data scope. Review cascade behavior, retained operational/audit records, and any requested export first. After deletion, verify the intended outcome without retaining a new copy of the removed private content. End-of-pilot offboarding does not authorize bulk deletion automatically.

## Usage and retention review

Review **Admin → Usage and costs** for call count, known cost, unavailable cost, failure rate, and latency; inspect provider billing separately against the agreed allowance. “Cost unavailable” is not zero. The application bounds paid attempts to three per user, per response, per rolling hour. This is not a per-station, daily, cohort, or global spending cap. No automatic spend cutoff or operational alert integration has been verified. Agree a manual review cadence and pause expansion when the allowance or failure threshold is reached.

An authorized operator can inspect the private `mmi_retention_job_health` heartbeat and the `candidate-mmi-purge-expired-free-text` scheduler without selecting transcript content or granting new table privileges. Expect a five-minute schedule and investigate a heartbeat that has missed two expected runs. Successful scoring deletes the full transcript immediately; unresolved text uses a 23-hour-30-minute cutoff with purge margin below the 24-hour promise. Evidence excerpts of up to 300 characters per criterion and justifications remain with feedback and may include a complete short answer. Confirm provider-side handling separately.

The read-only hosted check at 16:43:10 Singapore on 20 October 2026 found the purge job active on `*/5 * * * *`, the latest completion at 16:40:00 (190 seconds earlier), and zero overdue response transcripts or drafts. No answer text was needed for this check. Recheck after a scheduler change or incident and during the agreed operational review cadence.

## Rollback and release checks

- Record the app alias, immutable deployment, source SHA, backend ref, scorer version/auth setting, migration version/hash, and model profile together. Check both main and comparison bundles after alias changes; comparison deployments must also understand schema-v4 feedback.
- Before restoring a frontend, verify it can read existing schema-v4 assessments. A pre-five-level frontend can reject results already stored by the new scorer. Prefer a known compatible build and preserve completed attempts.
- Database changes are forward-only. Do not remove migration history, regrade historical answers, delete user records, or switch backends as an improvised rollback. Review an exact corrective migration if needed.
- Keep private tables, authenticated session ownership checks, provider secrets, and allowed origins intact. A failure state must remain honest and retryable where the transcript still exists.
- Re-run focused checks when code/configuration changes. Documentation preparation alone does not require rerunning the entire product suite or claiming new hosted evidence.

## Pilot decision record

- Operator identity and working support contact: pending.
- Domain/mailbox work: paused at the owner's request; the planned support address is not operational.
- Authorized first invitation: submitted once at 17:34:56 Singapore on 20 October; actual receipt confirmed by the recipient, and one ordinary-tester profile verified read-only. Private recipient/account details remain outside Git.
- Callback URLs, invitation/recovery templates, and subjects: saved in hosted Auth; canonical recovery/empty-callback smoke and callback header checks passed.
- Domain/custom SMTP and wider outside-group delivery: pending; domain work remains paused. Password setup, subsequent login, reset receipt, and the complete hosted journey also remain pending.
- Comparison account-access deployment: explicitly approved, READY, and assigned to the comparison alias at source `7494ba3`; live login wording and recovery link verified.
- Retention scheduler/overdue-text check: passed at 16:43:10 Singapore on 20 October 2026; ongoing review still required.
- Legal/privacy approval for outside testing: pending.
- Manual QA evidence and content/scoring reviewer: pending.
- Pilot cohort, allowance, review owner, and start/end decision: pending.

Keep names, email addresses, and private test records in the operator's restricted log. Add only safe dates, outcomes, issue references, and release identifiers to this document.
