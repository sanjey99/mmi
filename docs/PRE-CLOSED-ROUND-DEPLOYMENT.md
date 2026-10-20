# Closed-round deployment and verification

Updated 20 October 2026. [External beta readiness and operations](EXTERNAL-BETA-READINESS.md) is the current evidence and pilot checklist. [Before cofounder viewing](BEFORE-COFOUNDER-VIEWING.md) contains the product and human review contract. This page is the procedure for a subsequent release, not a claim that deployment remains unfinished.

## Approved targets and access

- Candidate app: [mmi-hazel.vercel.app](https://mmi-hazel.vercel.app).
- Backend: shared Supabase project `tliwifhnsytxpcynuwsy`, explicitly selected by the product owner.
- Release baseline: `3c78e896dc2ad4f3dd471cae3268445b10c74936`; see the [release record](EXTERNAL-BETA-READINESS.md#current-approved-release) for immutable URLs, IDs, migration hash, and scorer version.
- GPT-5.5 comparison: same backend and schema-compatible frontend, with the model profile enforced server-side as administrator-only. It is not the ordinary tester entry point.
- Access: named invited accounts; the app does not offer public signup. Verify the hosted signup setting before invitations.

This decision supersedes the old `feat/cofounder-ui-reliability`, isolated-project, and protected-preview requirements. Do not switch the live app to `obfwfoykalvoxqdnosus` to satisfy an obsolete checklist. Record the actual reviewed revision for each future release.

## 1. Prepare a concrete release

- [ ] Review the final diff and exact source revision, preserving unrelated work.
- [ ] Run checks appropriate to the change: unit/type/build and relevant browser checks; use disposable local/isolated environments for credential-gated integration tests.
- [ ] Check for secrets and unintended output files; record results against the revision being deployed.
- [ ] For code changes, complete required GitNexus impact and change-scope checks. Follow the applicable commit/PR workflow when a commit or PR is in scope.

Never run fixture creation, role elevation, clock manipulation, mutating integration suites, or deliberately broken provider configuration against production/shared data. Normal authorized candidate smoke does not authorize those test mutations.

## 2. Verify backend scope before any write

- [ ] Read back the exact Supabase ref, migration history, affected function definitions/grants, content counts, and active scoring state.
- [ ] Compare hosted prerequisites with the reviewed migration. The repository's full migration history has diverged from hosted environments; do not blindly apply all local migrations.
- [ ] Identify the exact migration/function/configuration operation covered by the user's authorization. Use a dry run or equivalent reviewed preflight and a forward-only migration.
- [ ] Preserve private-table access, authenticated session ownership, server-only provider credentials, rate limits, and allowed origins.

The five-level migration `20261017000000` is already applied to the current release. Do not reapply historical migrations or repair migration history merely to make a checklist uniform.

## 3. Roll out compatible components

- [ ] Apply a reviewed additive database migration first when needed, accepting current and new request/result formats during rollout.
- [ ] Publish a frontend that reads historical and new assessments before the scorer starts producing a new format. Schema-v4 results require a compatible client; the pre-five-level client rejects them.
- [ ] Deploy the reviewed scorer and verify authentication. The current scorer has JWT verification enabled and independently verifies the user/owned scoring claim. Do not weaken authentication as a shortcut.
- [ ] Limit public frontend variables to the approved backend URL, publishable key, and model profile. Never publish service-role or AI keys.
- [ ] Confirm the main app uses the ordinary `default` profile. A comparison app may use `gpt-5.5`; verify a non-admin remains forbidden server-side.
- [ ] Update intended aliases and inspect served bundles for the correct backend/profile/source. A ready build does not prove every alias points to it.
- [ ] Record immutable URLs, source SHA, backend ref, migration version/hash, scorer version, authentication, and configuration changes.

## 4. Perform safe hosted postflight

- [ ] Check deployed function bodies or approved hashes, role grants, schema validators, and unchanged content counts without exporting candidate content.
- [ ] Check retention scheduling and a recent private purge heartbeat.
- [ ] Use an authorized ordinary account and synthetic answers for a normal station: brief, five questions, completion, feedback, refresh/resume, and signout.
- [ ] Confirm five-level and historical feedback remain readable; incomplete scoring must not fabricate a total.
- [ ] Check main and comparison clients after format changes. Existing-account success does not establish invitations or new-account onboarding.
- [ ] Record results and limits. Physical microphone, screen-reader, legal, and email-delivery checks require corresponding evidence.

Use the [pilot test matrix](EXTERNAL-BETA-READINESS.md#pilot-test-matrix) for email/callback/password testing, physical-device/accessibility review, feedback/support, and human signoff. Keep recipient details and private test records in a restricted operator log; record only safe identifiers, aggregate outcomes, dates, and issue references in Git.

## Rollback and failure behavior

- Restore a verified schema-v4-compatible frontend when needed. An older build may reject assessments already saved by the new scorer.
- Preserve completed attempts and historical results. Database corrections are forward-only; do not delete migration history, transcripts, or user data as a rollback.
- Keep honest retry/expiry states if scoring is unavailable. Inspect safe error stages and provider configuration without repeated paid calls or secret disclosure.
- Do not change the approved backend, grant tester admin access, or disable authorization to bypass a failure.
- Record the restored deployment/source and recheck aliases, backend/profile alignment, authentication, and feedback compatibility.

## Evidence for the next release

| Field | Record |
| --- | --- |
| Release date and source SHA | Pending next release |
| Main and comparison immutable deployments / aliases | Pending next release |
| Supabase ref | `tliwifhnsytxpcynuwsy`, unless the owner explicitly changes scope |
| Exact migration versions/hashes and scorer version/auth setting | Pending next release |
| Automated and safe hosted results | Pending next release |
| Manual QA, human reviewer, and open issues | Pending next release |

The current release is already recorded in [External beta readiness](EXTERNAL-BETA-READINESS.md). Distinguish completed operations from human or operational checks still outstanding in every new release record.
