# Security

## Reporting an issue

Do not include credentials, account details, candidate responses, or hidden assessor content in public issues, pull requests, or screenshots. Use GitHub's private vulnerability reporting option if it is available for this repository; otherwise contact the [repository owner](https://github.com/sanjey99) to arrange a private channel before sharing sensitive details.

## Configuration boundaries

`EXPO_PUBLIC_*` values are included in the browser bundle. Use only the Supabase project URL, publishable client key, and other intentionally public configuration there. Service-role keys, AI provider keys, CAPTCHA secrets, and monitoring tokens belong only in server-side secret storage.

The browser's Supabase key is public by design. Authorization depends on authentication, database row-level policies, grants, and server-side checks. Changing a browser model-profile flag does not authorize access to administrator functionality.

## Test and deployment boundaries

The standard CI build and browser tests use synthetic configuration. Mutating integration tests and adversarial SQL proofs require a disposable local database and explicit safeguards. Never point them at production or shared user data. See [development and testing](docs/DEVELOPMENT.md).

Repository migration history includes historical reconciliation work. Applying every migration to an existing hosted database without reviewing its current state is unsafe. Plan and verify each database change separately.

## Public repository hygiene

Keep real environment files, database exports, prompt-bank payloads, user data, internal operating records, and local reports outside Git. The checked-in import manifests contain verification metadata; private source content is supplied separately.

Ignore rules prevent future accidental additions; they do not erase existing commits, branches, pull requests, forks, or cached copies. If a credential is exposed, revoke or rotate it at the issuing service before considering history cleanup. Removing operational notes from the current tree alone does not make earlier copies private.
