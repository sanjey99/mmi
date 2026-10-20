# Public registration and younger applicants

Updated 20 October 2026 (Singapore time).

The product owner approved public registration and UK pre-university applicants, including students under 18. The former adult-only restriction has been removed from the application, onboarding acknowledgement, Terms, Privacy Notice, and tracked invitation template. No substitute age threshold, date-of-birth question, identity document, or parental-contact collection has been added.

This document records implemented source behavior and the remaining rollout dependencies. It does not establish that hosted signup is enabled, that arbitrary outside addresses receive email, or that the service has completed legal review. Historical production receipts remain in [External beta readiness](EXTERNAL-BETA-READINESS.md). Quota settings and proofs are documented separately in [Public access limits](PUBLIC-ACCESS.md); CI, health monitoring, and failure-email setup are in [CI and monitoring](CI-AND-MONITORING.md).

## Implemented account flow

1. **Sign in → Create an account** opens `/signup`. Registration requests an email address, a unique password of 12–128 characters, and matching password confirmation. A real name and date of birth are not requested.
2. The isolated registration client sends the normalized email, chosen password, and fixed app-owned confirmation redirect to Supabase Auth. It sends no role, name, age, profile, or administrator metadata. Its session persistence, automatic refresh, and URL detection are disabled. It cannot replace the shared application's existing session. If Auth returns an immediate session, the form fails safely rather than presenting an unconfirmed account as ready; hosted email confirmation must remain enabled.
3. A successful or existing-address response shows the same conditional **Check your email** message. The UI never displays provider details, account-existence diagnostics, tokens, or full email links. Signup disabled, unsupported sender, transport failure, and other delivery failures display an honest retry/unavailable message rather than claiming an email was sent.
4. Resending requires an explicit user action. The browser client prevents concurrent requests and paces registration/resend attempts by one minute. This is a usability control, not a server-side anti-abuse boundary; refreshing a browser can reset it. Hosted rate limits and a suitable anti-bot configuration must be checked separately before broad public signup.
5. The confirmation email uses the tracked `supabase/templates/confirmation.html` link: `{{ .SiteURL }}/auth/callback#token_hash={{ .TokenHash }}&amp;type=signup`. The fragment keeps the one-time token out of the request path/query. The bootstrap strips the entire credential query and fragment before the Auth client and router start.
6. The callback accepts explicitly typed signup token hashes, legacy implicit token pairs, and typed PKCE codes under the existing strict origin, path, parameter, duplicate, and length checks. Auth must return a matching session/user, and a fresh server `getUser` result must match that same user before success.
7. Signup confirmation produces **no password-action marker**. The user already chose a password. The screen shows **Email confirmed → Continue to the circuit** only after shared authentication is ready for the verified account. Continue opens orientation. An invitation or recovery link retains its separate verified password-setup requirement. A signup callback or stored `mode: signup` value cannot authorize password replacement.
8. Orientation asks only for the existing university target and entry year, explains AI processing and retained excerpts, and acknowledges reading Terms and Privacy. It no longer asks the user to claim to be 18. Registration and invitations create ordinary practice accounts; existing database authorization remains responsible for role enforcement.

The application does not use an Auth administration key in the browser. Registration is not a mechanism for granting Supabase/Vercel project-team membership or an application administrator role.

## Hosted rollout prerequisites

The last recorded hosted configuration has public signup **OFF**, anonymous signup **OFF**, and email confirmation **ON**. Source changes do not alter those hosted settings.

Before declaring public registration active:

- Deploy the reviewed application source to the approved main app and verify its sign-in, signup, recovery, and safe empty-callback screens. Preserve the comparison app's existing administrator-only model behavior.
- Keep the canonical Auth Site URL at `https://mmi-hazel.vercel.app`, without a trailing slash. Add the exact supported main callback `https://mmi-hazel.vercel.app/auth/callback?type=signup` alongside the existing exact invitation/recovery callbacks. Do not add broad wildcard redirects as a shortcut. The comparison app's registration links must use a deliberately approved callback destination; ordinary candidates should use the main app.
- Save the tracked confirmation template and a clear confirmation subject in hosted Auth. Apply the updated invitation template so new invitation messages no longer claim an adult-only audience. Preserve the recovery template and callback behavior.
- Keep email confirmation **ON** and anonymous signup **OFF**. Configure the server's minimum password length consistently with the app's 12-character requirement; frontend validation alone cannot enforce API policy.
- Verify an approved sender that can deliver to arbitrary authorized external recipients. Supabase's default SMTP service is documented as restricted to project-team addresses, with a current limit of two emails per hour. One received invitation does not prove broad deliverability. Do not add testers to the project team to bypass the mailer's restriction.
- Check hosted signup/resend rate limits and an appropriate anti-bot configuration. Do not weaken email confirmation or expose a service-role key to work around sender or bot-protection problems. Account quotas are separately server-enforced and are not a substitute for signup protection.
- Verify new users receive exactly one ordinary profile and cannot set administrator status through Auth metadata or profile updates. Test normal candidate practice, denied admin/comparison access, sign-out, and cross-account isolation.
- With the recipient's explicit authorization, complete one genuine signup confirmation, subsequent sign-in, confirmation resend, and password recovery. Use the recipient's own password; never record it, tokens, or full email links in Git or reports. Record actual receipt and the completed journey privately, rather than relying only on a dashboard send acknowledgement.
- Complete the owner/contact, children's privacy assessment, content review, and manual QA decisions below. Record the actual hosted signup setting and release receipts when activation is complete.

The owner has explicitly paused domain/mailbox setup. `support@interviewstation.com` is only a proposed address and is not published as an operational support contact. Do not buy a domain, create a mailbox, configure a sender, or resume that paused task implicitly. A separate, already controlled working sender/contact can be selected by the owner; the website domain itself does not create email delivery.

## Privacy defaults and actual data flows

The implementation uses the same private defaults for all accounts, rather than collecting age information to separate younger users. A new plain-language privacy summary appears before the detailed notice, and short explanations appear during signup and orientation. Users may type instead of enabling browser speech. No advertising tracker, session replay, public candidate profile, geolocation feature, or marketing consent is introduced.

| Area | Current implementation |
| --- | --- |
| Account data | Email, optional profile name, university target, entry year, onboarding state, account role and timestamps. Registration requests no real name, date of birth, parent details, or identity document. |
| Authentication | Web sessions use session storage to survive refresh in the same tab; explicit sign-out removes the shared session. Registration uses a separate non-persistent client. |
| Candidate records | Ordinary candidates cannot read another candidate's private practice history. Existing server authorization and row-level security remain in force. Authorized staff/provider access is described in the detailed notice. |
| Speech | Browser/platform speech services may process microphone audio under their own terms. The app/database do not store raw MMI audio. Typing remains available. |
| AI scoring | The selected prompt and submitted answer go through the server to the configured AI provider. Automated scores are formative practice guidance and do not decide admission. Provider identity, processing settings, age eligibility/contractual terms, retention, regions, and transfers need confirmation for the younger audience. |
| Stored answer content | Successful scoring deletes the full finalized transcript immediately; unresolved full transcripts are purged within 24 hours by the existing retention scheduler. Scores, justifications, and answer excerpts of up to 300 characters per criterion remain with feedback; an excerpt can contain a complete short answer. |
| Runtime monitoring | Fixed error kind/screen-area counters are linked to signed-in accounts and hour buckets, with no error messages, stack traces, URLs, tokens, recordings, or answer content. Admins see aggregates. Cleanup retains seven full UTC days plus the current day, up to eight days while healthy. |
| Feedback allowances | Private per-account/day usage counts and response IDs with first-admission timestamps support server limits. These records add no answer text and retain seven full UTC days plus the current day, up to eight days while daily cleanup is healthy. The candidate RPC returns only the requesting account's remaining counts/reset/availability, with no IDs, costs, or other accounts' totals. |
| Independent health probes | Receive a fixed service-health response, not candidate analytics or personal records. They do not call a paid model, submit a practice answer, or send account email. |
| Rights and support | The notices describe requesting access, correction, export, restriction, objection, or deletion. A real operator identity and working contact still need to be supplied. There is no claim that an unverified mailbox is monitored or that a new automated deletion workflow exists. |

Provider-side retention is separate from application/database deletion. Precise retention periods for records other than full transcripts and runtime counters still require an approved decision. Do not describe this update as a completed Children's Code assessment or legal approval.

## Children's privacy and legal review

The ICO's [age-appropriate application standard](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/3-age-appropriate-application/) allows applying the code's standards to all users where an appropriate degree of age certainty is not established. The implementation follows that privacy-oriented approach rather than adding a self-declared replacement age gate. This design choice alone does not establish compliance.

The ICO's [transparency standard](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/4-transparency/) calls for clear information suited to children and short explanations when data use starts. The new signup/orientation explanations and layered privacy summary address that design work. Human testing must still establish whether the actual intended students understand the notice and choices.

Before broader access, a qualified reviewer and product owner still need to establish:

- The operating/controller identity, genuine support/privacy contact, legal bases, and age-appropriate terms.
- A children's data protection impact assessment and the product's best-interests assessment; potential effect of admissions-related AI scores and appropriate human guidance.
- Whether the actual provider contracts, configuration, international transfers, and retention decisions support the intended younger audience.
- A usable account/data-request process, report review owner, incident procedure, retention decisions, and how material changes reach registered users.
- Representative student/parent-facing notice testing and physical-device, keyboard, screen-reader, speech-permission, and denied-speech QA.

These items are unresolved factual/legal decisions. Removing the old 18+ checkbox must not be represented as completing them, and an acknowledgement of reading the notices is not optional marketing/tracking consent.

## Verification and rollback

Local checks cover safe signup payloads and callback origin, password validation, no automatic session installation, no account-existence disclosure, fixed errors, concurrent request pacing, explicit resend, and the absence of signup password-reset authority. Browser cases include invitation and recovery regressions, signup confirmation to orientation, honest failure while signup is disabled, ordinary signed-out registration, and the absence of the adult-only checkbox. All tests use a synthetic backend and local export; no live accounts or email are created by these tests.

To pause new public registrations, disable hosted public signup and keep invitation/recovery, email confirmation, and candidate record ownership checks intact. This is different from removing existing accounts or deleting their records. Existing invitations and confirmed accounts should continue to use the supported flows. If a frontend needs rollback, use a schema-v4-compatible release and preserve completed attempts and migration history. Record the exact hosted setting and app deployment used rather than assuming a UI-only change closes the Auth API.

Official implementation references: [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup), [confirmation resend](https://supabase.com/docs/reference/javascript/auth-resend), and [SMTP restrictions and custom senders](https://supabase.com/docs/guides/auth/auth-smtp). Documentation was checked on 20 October 2026; limits and provider terms can change.
