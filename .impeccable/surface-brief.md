# Interview Station surface brief

## Approved direction

- Visual world: The Numbered Station Corridor.
- Approved composition: Doorway Threshold.
- Build path: comp-first.
- Backup: the pre-redesign UI is retained at commit `9cf4311` and local branch `backup/pre-redesign-ui-2026-08-25`.

## Visual contract

- Translate an MMI corridor into software through numbered room plates, posted candidate briefs, painted route lines, laminated instructions, and explicit station state.
- Use cool white `#F7F8F6`, charcoal `#25272A`, circuit yellow `#F4C542`, and restrained directional red `#B3342B`.
- Use one disciplined wayfinding sans family with strong tabular numerals and a quieter reading weight for long copy.
- Prefer square, door-plate, route-sign, and posted-sheet geometry over generic rounded cards or pills.
- Make the route functional navigation. The dominant orientation/practice-entry move is the numbered route arriving at the current station doorway.
- Carry the same grammar into long-form answers, structured feedback, progress, profile, and question management without forcing a literal corridor photograph onto every screen.

## Distinctness constraints

- Do not reuse the current teal/navy/cream palette, serif-display-plus-sans pairing, emoji navigation, soft-shadow rounded card grid, pill filters, competitor copy, or competitor assets.
- Do not use real NHS, university, or admissions-provider branding.
- Do not imply marks, progress, question volume, AI availability, or user activity that the application cannot verify.

## Interaction contract

- Every route has an explicit current, available, unavailable, loading, success, and failure state that is not communicated by colour alone.
- Back actions use browser history when safe and a named product destination when history is absent.
- Web confirmation and error feedback must use accessible application UI; React Native Web's no-op `Alert.alert()` is not a supported interaction.
- Session state persists across refreshes in the same browser tab, clears when the browser session closes, and clears immediately after a successful explicit sign-out.
- Practice submission remains visibly pending until a confirmed result or a recoverable error is shown. A failed scoring request must never look like a successful submission.

## Closed-preview truth

- The deployed preview currently has two active questions: one Ethics and one Motivation.
- NHS, Teamwork, Resilience, and Scenarios must be shown as unavailable until content exists.
- Cofounder question management is surfaced as `QUESTION DESK / Manage questions`.
- Unfinished Tutor and student Questions destinations are hidden from the closed-preview navigation.
