# Web-First Cross-Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make InterviewStation runnable in a browser (for cost-free testing/rollout) using the *same* React Native codebase that already targets iOS/Android, with zero platform forks beyond one file-I/O abstraction.

**Architecture:** Add `react-native-web` + `@expo/metro-runtime` so Expo Router's existing Metro bundler emits a web target from the current components (no separate web app, no DOM rewrite). The only code that behaves differently per platform — file picking/reading in the three admin import screens — is isolated behind a single `src/lib/filePicker` module using Metro's `.web.ts` / `.ts` platform-extension resolution, so native behavior is untouched.

**Tech Stack:** Expo SDK 55, Expo Router, react-native-web, @expo/metro-runtime, existing Supabase backend (unchanged).

**Note on testing approach:** This project has no test runner configured (verified: no jest/vitest config, no `*.test.ts` files outside `node_modules`). Introducing one is a separate initiative and out of scope here. Steps below substitute "write failing test" with explicit manual verification (dev server checks, `tsc --noEmit`, and a functional walkthrough) so risk is still caught before each commit.

---

## Task 1: Install web target dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto-updated by install)

- [ ] **Step 1: Install the packages Expo's web target requires**

Run:
```bash
npx expo install react-native-web @expo/metro-runtime
```
`react-dom` is already a dependency, so this adds the remaining two packages Expo's own docs specify for adding web support to an existing Expo Router app.

- [ ] **Step 2: Verify versions were resolved correctly**

Run: `npx expo-doctor`
Expected: no dependency-version warnings for the two new packages (expo-doctor checks installed versions against the SDK 55 compatibility table).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-native-web and metro-runtime for web target"
```

---

## Task 2: Configure the web output in app.json

**Files:**
- Modify: `app.json`

- [ ] **Step 1: Add the `web` block**

In `app.json`, inside the top-level `"expo"` object, add (alongside the existing `"ios"` and `"android"` blocks):

```json
"web": {
  "bundler": "metro",
  "output": "single",
  "favicon": "./assets/favicon.png"
}
```

`output: "single"` builds a single-page app (one `index.html`, client-side routing) rather than `"static"` (pre-rendered HTML per route) or `"server"` (needs a Node server). `"single"` is the right choice here because every screen sits behind Supabase auth and reads live data — there's nothing to gain from build-time HTML generation, and it avoids build-time execution of code that assumes a browser (`localStorage` access via `AsyncStorage`, etc.). `favicon.png` already exists in `assets/`.

- [ ] **Step 2: Manual verification — dev server boots**

Run: `npx expo start --web`
Expected: Metro bundles successfully, browser opens to the login/tabs screen with no red-box error overlay. Click through to the practice tab and back.

- [ ] **Step 3: Commit**

```bash
git add app.json
git commit -m "feat: configure web output for Expo Router"
```

---

## Task 3: Extract a cross-platform file-picker module

**Context:** `app/admin/questions.tsx`, `app/admin/import-mmi.tsx`, and `app/admin/import-roleplay.tsx` each independently call `expo-document-picker` + `expo-file-system` inline. `expo-file-system`'s `readAsStringAsync` does not support the `blob:`/`file:` URIs a browser produces, so this is the one place that needs a real per-platform implementation — and it's currently triplicated, so extracting it is a DRY win independent of the web work.

**Files:**
- Create: `src/lib/filePicker.ts` (native implementation — resolved by Metro for iOS/Android)
- Create: `src/lib/filePicker.web.ts` (web implementation — resolved by Metro for web only)

- [ ] **Step 1: Create the native implementation**

`src/lib/filePicker.ts`:
```ts
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export type PickedFile = { name: string; content: string };

/**
 * Opens the native document picker and reads the selected file.
 * `encoding: 'base64'` is required for binary formats (e.g. .xlsx).
 */
export async function pickFile(
  mimeTypes: string[],
  encoding: 'utf8' | 'base64',
): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: mimeTypes,
    copyToCacheDirectory: true,
  });

  if (result.canceled) return null;

  const file = result.assets[0];
  const content = await FileSystem.readAsStringAsync(
    file.uri,
    encoding === 'base64' ? { encoding: FileSystem.EncodingType.Base64 } : undefined,
  );

  return { name: file.name, content };
}
```

- [ ] **Step 2: Create the web implementation**

`src/lib/filePicker.web.ts`:
```ts
export type PickedFile = { name: string; content: string };

/**
 * Opens the browser's native file picker via a hidden <input type="file">
 * and reads the selected file. Mirrors the native module's signature so
 * callers don't need Platform.OS branches.
 */
export async function pickFile(
  mimeTypes: string[],
  encoding: 'utf8' | 'base64',
): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = mimeTypes.join(',');

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result as string;
        // readAsDataURL yields "data:<mime>;base64,<data>" — strip the prefix.
        const content = encoding === 'base64' ? raw.split(',')[1] : raw;
        resolve({ name: file.name, content });
      };
      reader.onerror = () => resolve(null);

      if (encoding === 'base64') reader.readAsDataURL(file);
      else reader.readAsText(file);
    };

    // No native 'cancel' event for <input type="file"> in all browsers;
    // if the user dismisses the dialog without choosing a file, onchange
    // simply never fires and the promise stays pending until they retry.
    input.click();
  });
}
```

- [ ] **Step 3: Manual verification — type check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `filePicker`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/filePicker.ts src/lib/filePicker.web.ts
git commit -m "feat: add cross-platform file-picker module"
```

---

## Task 4: Migrate `app/admin/questions.tsx` to the shared module

**Files:**
- Modify: `app/admin/questions.tsx:27-28` (remove direct imports), `:44-72` (`handlePickFile`)

- [ ] **Step 1: Replace the imports**

Remove:
```ts
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
```
Add:
```ts
import { pickFile } from '../../src/lib/filePicker';
```

- [ ] **Step 2: Replace the body of `handlePickFile`**

```ts
const handlePickFile = async () => {
  try {
    const picked = await pickFile(['text/csv', 'text/plain', 'application/csv'], 'utf8');
    if (!picked) return;

    setFileName(picked.name);
    setStatus('parsing');
    setImportResult(null);
    setErrorMsg(null);

    setCsvContent(picked.content);

    const lines = picked.content.split('\n').filter(l => l.trim());
    const headerLine = lines[0] ?? '';
    const previewLines = lines.slice(1, 4);
    setPreview([headerLine, ...previewLines]);
    setStatus('idle');
  } catch (e: any) {
    setStatus('error');
    setErrorMsg(e.message ?? 'Failed to read file');
  }
};
```

- [ ] **Step 3: Manual verification**

Run `npx expo start --web`, open Admin → Questions, upload a small `.csv` file, confirm the preview renders. Then confirm the same screen still works via Expo Go on iOS (native path unchanged, but this is the regression check that matters).

- [ ] **Step 4: Commit**

```bash
git add app/admin/questions.tsx
git commit -m "refactor: use shared filePicker in admin questions import"
```

---

## Task 5: Migrate `app/admin/import-mmi.tsx` to the shared module

**Files:**
- Modify: `app/admin/import-mmi.tsx:18-19` (remove direct imports), `:36-65` (`handlePickFile`)

- [ ] **Step 1: Replace the imports**

Remove:
```ts
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
```
Add:
```ts
import { pickFile } from '../../src/lib/filePicker';
```

- [ ] **Step 2: Replace the body of `handlePickFile`**

```ts
const handlePickFile = async () => {
  try {
    const picked = await pickFile(
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        '*/*',
      ],
      'base64',
    );
    if (!picked) return;

    setFileName(picked.name);
    setStatus('parsing');
    setResult(null);
    setErrorMsg(null);

    setBase64(picked.content);
    setPreview(previewXlsx(picked.content));
    setStatus('idle');
  } catch (e: any) {
    setStatus('error');
    setErrorMsg(e.message ?? 'Failed to read file');
  }
};
```

- [ ] **Step 3: Manual verification**

Run `npx expo start --web`, open Admin → Import MMI, upload `med_interview_question_bank.xlsx`, confirm the sheet-preview counts render (same as before the refactor).

- [ ] **Step 4: Commit**

```bash
git add app/admin/import-mmi.tsx
git commit -m "refactor: use shared filePicker in MMI import"
```

---

## Task 6: Migrate `app/admin/import-roleplay.tsx` to the shared module

**Files:**
- Modify: `app/admin/import-roleplay.tsx:17-18` (remove direct imports), `:37-56`-ish (`handlePickFile`, mirrors import-mmi.tsx)

- [ ] **Step 1: Replace the imports**

Same as Task 5, Step 1.

- [ ] **Step 2: Replace the body of `handlePickFile`**

Same shape as Task 5 Step 2, adjusted for whatever this screen's preview/result setters are named (confirm against the current file before editing — it mirrors `import-mmi.tsx`'s structure but the state variable names may differ).

- [ ] **Step 3: Manual verification**

Same as Task 5 Step 3, using the roleplay bank file.

- [ ] **Step 4: Commit**

```bash
git add app/admin/import-roleplay.tsx
git commit -m "refactor: use shared filePicker in roleplay import"
```

---

## Task 7: Ignore regenerable build output

**Files:**
- Modify: `.gitignore`

**Context:** An `android/` native project directory already exists untracked in the working tree (from a prior `expo prebuild`/`expo run:android`), but only `android/local.properties` is currently ignored — the whole directory should be, since it's regenerable via `npx expo prebuild` and isn't meant to be hand-edited in a managed Expo workflow. The web export (`dist/`) needs the same treatment.

- [ ] **Step 1: Add entries**

In `.gitignore`, replace:
```
android/local.properties
```
with:
```
# Native projects are regenerated via `npx expo prebuild` — don't commit them
/android
/ios

# Web static export output (npx expo export --platform web)
/dist
```

- [ ] **Step 2: Untrack the existing android/ directory**

```bash
git rm -r --cached android 2>/dev/null || true
```
(This only removes it from git's index — the files stay on disk. Safe no-op if `android/` was never tracked, which `git status` confirms it currently isn't.)

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore regenerable native/web build output"
```

---

## Task 8: Static export and free hosting

**Files:**
- Create: `vercel.json` (or equivalent for whichever host is chosen)

- [ ] **Step 1: Produce a static build**

Run:
```bash
npx expo export --platform web
```
Expected: a `dist/` directory containing `index.html` and bundled assets.

- [ ] **Step 2: Configure the host**

Recommended: Vercel (free tier, GitHub-connected, automatic preview deployments per PR — useful for "let people test before the app ships").

`vercel.json`:
```json
{
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
The rewrite is required because `output: "single"` produces one `index.html` — client-side routing needs the server to serve it for every path instead of 404ing on refresh.

- [ ] **Step 2 (alternative): Netlify**

Skip `vercel.json`; instead create `public/_redirects` (build-time file, not committed to `dist/` directly — check Netlify's current docs for the exact source path if choosing this route) containing:
```
/*  /index.html  200
```

- [ ] **Step 3: Deploy and verify**

Connect the GitHub repo in the chosen host's dashboard (or run `vercel`/`netlify deploy` locally), confirm the deployed URL loads the login screen and a full practice-session round-trip works against the real Supabase backend.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "chore: configure static web hosting"
```

---

## Summary of what does NOT change

- `expo-haptics` calls in `src/components/ui/Button.tsx` — already no-op safely on web, no edit needed.
- `react-native-reanimated`/`react-native-worklets`, used by `Button.tsx`'s press animation and screen transitions — has had web support since Reanimated v2/v3 (renders via CSS instead of the native driver); low risk, but give animated screens a visual look during Task 2 Step 2's manual check, not just a "no red-box" pass.
- Auth/session storage (`src/lib/supabase.ts`) — already uses `AsyncStorage`, which has a working web shim.
- AI scoring (`src/lib/ai/index.ts`) — already proxied through a Supabase Edge Function, no key exposure risk on web.
- Every other screen and component — renders through `react-native-web` unchanged; no Platform.OS branching needed outside `filePicker`.

## Future native builds (no rework required)

When ready for the App Store / Play Store, `eas build --platform ios` / `--platform android` builds this exact codebase — the `filePicker.web.ts` file is simply never bundled for native, and `filePicker.ts` keeps working exactly as it does today. No architecture change, no fork.
