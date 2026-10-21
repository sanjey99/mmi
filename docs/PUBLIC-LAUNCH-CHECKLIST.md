# Public launch checklist

Updated 21 October 2026 (Singapore time). This is the current action list; [beta readiness](EXTERNAL-BETA-READINESS.md) retains historical release and live-test receipts. A checked item means the stated evidence exists, not that every related journey is approved.

Public signup remains **OFF**, anonymous signup **OFF**, and email confirmation **ON**. The owner approved public registration for UK pre-university users, including under-18s. Operator names and domain work are explicitly paused; do not infer names, purchase a domain, or publish the proposed domain mailbox. `interviewstation.admin@gmail.com` is the owner-approved support/privacy inbox and temporary sender.

## Completed and release verification

- [x] Five-level criterion scoring, weighted totals, candidate evidence and justifications deployed; saved results remain compatible.
- [x] Main and comparison source aligned through [PR #18](https://github.com/sanjey99/mmi/pull/18), merge `71324dd`. Main `dpl_9LAtNSCoP55JcW63ujAuZ2k24Lz1` and comparison `dpl_7UqRWEbZRs4dAwSbiNTLxbbBSupi` were READY. The subsequent email/protection release records its own receipt below.
- [x] Main requires passing Application verification and uses a Vercel production deployment gate. Scheduled health checks run, and the owner confirmed actual delivery of the intentional GitHub failed-run email.
- [x] Dedicated Gmail SMTP saved by the owner. One NTU recovery arrived in Junk and password reset/sign-out/sign-in were user-confirmed. A separate fresh Gmail invitation, private password setup/onboarding, ordinary profile, synthetic station, saved feedback, reporting persistence and transcript purge were checked.
- [x] Invitation, recovery and confirmation template sources pin `https://mmi-hazel.vercel.app`; link destinations no longer depend on provider Site URL, request redirects or user metadata. The hosted templates were saved, reloaded and matched byte-for-byte. See [registration runbook](PUBLIC-REGISTRATION.md#stable-email-destinations).
- [x] Support/privacy inbox approved and added to the notices; no company or operator identity invented. Gmail delivery/support processing and retained Sent copies are disclosed.
- [x] New station-start guard implemented with private PostgreSQL concurrency proofs: five new stations per rolling minute and 30 per account per UTC day, with free active-session reuse. [Rollout details](PUBLIC-ACCESS.md#new-station-creation-limits) distinguish local proof from hosted installation.
- [x] Optional Turnstile integration implemented for sign-in, signup, confirmation resend and recovery, with no runtime dependency. It remains disabled pending real provider configuration; local synthetic tests do not establish live bot protection.
- [x] Automated WCAG A/AA scans added for five public account/legal routes at desktop and mobile widths. The scan found a legal-document keyboard scrolling defect; the shared legal view now accepts keyboard focus on web. Human screen-reader and device checks remain below.
The introducing release pull request carries the final CI, production/comparison deployment and post-deployment template-persistence receipts. Verify those receipts when deciding whether a release has shipped; local checks alone are insufficient.

## Before expanding the invitation-only group

| Action | Status / evidence needed | Responsible role |
| --- | --- | --- |
| Cohort and capacity | Record group size, review cadence, support/report owner and acceptable spend/loss. Existing scoring caps allow 100 new paid claims globally per UTC day: at most 20 fully answered five-question stations before retries. Account limits do not reserve shared capacity. Start with a staggered cohort; review before 80 global claims or 8 email sends in an hour, without automatically raising caps. | Product/operator |
| Physical device and speech | Test real mobile Safari and Chrome: microphone allow/deny, unsupported speech, typing fallback, interruption, mobile keyboard, reduced motion and refresh. Automated Chromium tests do not prove these. | Human tester |
| Accessible use | Complete keyboard and named screen-reader checks for account setup, orientation, timed practice and feedback. Record understandable notices/status announcements with intended students. Public-page automated scans cover only machine-detectable issues. | Human tester |
| Report round trip and isolation | Candidate report persisted with follow-up off; still verify signed-in admin review and two authorized ordinary accounts cannot retrieve each other's results after sign-out/account changes. Local role/isolation tests are separate evidence. | Engineering/operator |
| Content quality | Review representative questions, rights/source permissions and evidence-based feedback; record the formative-practice limitations and human scoring-quality approval. | Content reviewer |
| Support and incidents | Inbox is approved. Assign access/review cadence, incident owner, escalation and a credential-rotation procedure. Do not send passwords, complete email-action links or patient details to support. | Operator |

## Additional gates before public signup

| Action | Current state / completion evidence | Responsible role |
| --- | --- | --- |
| Operator identity and notices | **Paused by owner.** Resume only when requested. Publish actual responsible operator(s), approve Terms/Privacy, legal bases, retention decisions and provider disclosures before public signup. No registered company is assumed. | Owner + qualified reviewer |
| Children's assessment | Complete children's DPIA/best-interests assessment, provider contractual/age eligibility, actual processing/retention/transfer settings, and age-appropriate notice testing. Removing 18+ is not legal approval. [ICO DPIA standard](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/2-data-protection-impact-assessments/). | Owner + qualified reviewer |
| Live CAPTCHA | Hosted Attack Protection is **Disabled**, observed 21 October. Create/approve a Turnstile site, enter its secret directly into Supabase and configure the public key/flag for both apps before enabling hosted enforcement. Restrict permitted hostnames. Human completes real challenges and verifies sign-in/recovery/resend; no agent CAPTCHA solving or secret collection. See registration runbook. | Owner + engineering |
| Email capacity and delivery | Saved project cap is 10 emails/hour, shared by signup/resend/recovery/invitations; 60-second per-user interval. A signup flood can consume recovery capacity. Confirm deliverability and capacity for the intended launch; keep the conservative cap until a deliberate sender/capacity decision. Domain purchase remains paused. | Operator |
| Real public signup journey | Still unverified: authorized new account → received confirmation → one-time link → orientation → subsequent password sign-in, plus explicit confirmation resend. User chooses their password privately. Confirm exactly one ordinary profile and denied admin/comparison access; preserve email confirmation ON and anonymous signup OFF. | Authorized recipient + engineering |
| Backup and restore | Dashboard on 21 October explicitly says **Free Plan does not include project backups**. Choose an encrypted backup destination, access owners, retention and tolerable data loss/recovery time; take and restore an approved backup in an isolated environment. No live personal-data export or paid upgrade was performed. [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups). | Operator + engineering |
| Data requests | Rehearse export and deletion with synthetic records. Identify feedback/report rows before deleting an account: `cofounder_feedback.user_id` becomes NULL while free text remains. Decide and test deletion/redaction/retention of those reports, retained excerpts, mailbox copies and backups. Do not promise that profile deletion removes every copy. | Privacy/support owner + engineering |
| Provider and platform budgets | Choose a monetary budget and provider limits/alerts; current candidate quota is not a platform-wide billing guarantee. Health 200 does not mean quota remains: normal exhaustion is excluded from provider-failure health. Review protected Operations/capacity during the cohort. Vercel spend controls have plan restrictions; no free hard billing cutoff is claimed. [Vercel guidance](https://vercel.com/docs/spend-management). | Product/operator |
| Dependency risk | Audit remains 37 affected production dependency entries (0 critical, 21 high, 16 moderate). Targeted browser decoder review found no decoder calls on the exercised Expo routes, with a positive control proving instrumentation. Residual availability risk remains; no incompatible override or forced framework upgrade. Record acceptance/remediation ownership, and repeat after routing/framework changes. | Engineering + release owner |
| Final activation | After gates are resolved, approve scope and release, enable hosted signup deliberately, then record the actual setting and successful real confirmation journey. Keep the existing scoring/start pause controls available. | Release owner |

## Restore and data-request rehearsal requirements

Use synthetic data in a private environment first. Validate Auth/profile ownership, grants/RLS, migration ledger, station snapshots, saved rubric results, quota behavior and ordinary/admin boundaries. Auth templates/callback allowlists, external secrets, SMTP, monitoring and provider configuration require separate recovery checks; a database restore alone is not a complete service restore.

Before reopening a restored service, run the approved transcript-expiry cleanup and reapply completed deletion/redaction requests so an older backup cannot resurrect purged text or deleted accounts. Verify the purge job/heartbeat and no overdue transcript/draft metadata, then test a synthetic ordinary account and read-only monitor. Keep credentials and exports outside Git and public CI; agree backup/mailbox access and expiry with the owner. No deletion, restore, provider failure or real credential rotation should be forced against the shared live project as a test.

## Release receipt

The station-start migration is installed on the approved shared project. Read-only postflight verified the exact source ledger, expected new function body/owner/default/search path, authenticated-only RPC execution, private limits/defaults, candidate history write denial, one reviewed overload, existing index and unchanged active cleanup-job definitions. SHA-256: `65eb5f100503b988750e42cd90e7993320afe87b29eed095eb1a83c8af10359c`.

The introducing release pull request is the authoritative receipt for its final CI, immutable main/comparison deployment identifiers, assigned aliases and reloaded hosted template hashes after deployment. Public signup stays OFF regardless of whether this technical release is shipped.
