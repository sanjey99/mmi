# Interview Station

Interview Station is a web-first practice application for UK medical-school applicants preparing for Multiple Mini Interviews (MMIs). It combines timed active practice with structured formative feedback.

## Candidate experience

1. Choose from published stations, including target-university practice pools.
2. Read a scenario during a 60-second preparation period.
3. Answer five ordered questions, with up to two minutes per response. Use editable browser speech transcription where supported, or type.
4. Submit the station for weighted, five-level rubric feedback with supporting evidence and improvement guidance.
5. Review saved feedback, practice history, and progress.

Loading, submission, scoring, failure, retry, and expiry states are explicit. Browser refresh and interrupted sessions are considered in the practice flow.

## Content administration

Administrators can manage stations and questions, validate drafts, review structured assessments, configure server-side AI access, and inspect aggregate usage. Hidden assessor material is restricted to authorized server and administrator workflows.

## Scope

The responsive web application is a working beta. Registration and access depend on the deployment's configuration. Native mobile releases, a tutor marketplace, and unfinished legacy browsing routes are outside the current candidate experience.

Feedback supports interview practice; it does not predict admissions outcomes or provide clinical advice.

## Data handling

- Application accounts isolate candidate practice records.
- The app does not store raw audio. Browser speech services may process speech separately.
- Full response transcripts are cleared after successful scoring; unresolved text is subject to a 24-hour cleanup policy.
- Feedback retains bounded supporting excerpts and justifications. An excerpt may contain an entire short response.
- Provider credentials stay on the server. Browser configuration contains public client values only.

These describe the implementation's intended boundaries; deployment configuration and external provider handling must also be reviewed before operating a separate instance.

See [architecture](docs/ARCHITECTURE.md), [development and testing](docs/DEVELOPMENT.md), and [security](SECURITY.md) for engineering details.
