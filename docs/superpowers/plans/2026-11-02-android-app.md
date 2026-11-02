# Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the phone app (`src/phone`) as a Capacitor Android app with Discord sign-in, Stream mode, a working back button, an APK on GitHub releases (after the owner's device check) and a Play-ready AAB.

**Architecture:** Same shape as `ios/`: a `--mode android` Vite build of `src/phone` copied into a Capacitor `android/` project, with two small local Java plugins (`WebAuth`, `Stream`) matching the iOS plugins' JS contracts. Shared code stops treating "native" as "iOS" and branches on a build-time platform value. A GitHub Actions workflow builds signed APK + AAB on `v*` tags.

**Tech Stack:** Capacitor 8.5 (`@capacitor/android`, `@capacitor/app`), Java plugins, Android Custom Tabs (`androidx.browser`), Vite, React, vitest, Cloudflare Worker (portal), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-02-android-app-design.md`

## Global Constraints

- App id `com.darkharasho.duelbinder`, name "Duel Binder", background `#111113`. `@capacitor/android` and `@capacitor/app` at the same major/minor as `@capacitor/ios` (8.5.x).
- Phone, portrait only, except during a stream (all orientations but upside down).
- Sign-in callback `duelbinder://auth/callback`; Worker query `app=android`. Discord only on Android; no Apple button.
- CORS: Android origin `https://localhost` beside `capacitor://localhost`, Bearer routes only, never `access-control-allow-credentials`.
- Usage/error platform value `'android'`.
- One release signing key at `~/.android-keys/duel-binder-release.jks`, never committed; CI gets it via secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, set with `gh secret set` without printing (local `gh` needs `env -u GITHUB_TOKEN`).
- `versionName` = package.json version; `versionCode` = `major*1_000_000 + minor*1_000 + patch` (monotonic for APK and Play).
- APK asset name `Duel-Binder-<version>.apk`. Attaching to releases is gated by repo variable `ANDROID_RELEASE == 'true'` (unset until the owner's camera check).
- Vitest always `--maxWorkers=2` (`npm test -- <file>` already passes it).
- Don't break iOS: `npm run build:ios` output and behaviour unchanged; iOS still reports `'ios'` and shows the Apple button.
- The Worker deploy (one-way, owner-approved) goes out before anyone installs an APK.

## Review Focus

1. **Back from a sheet inside a sub-page** (e.g. picker open on Collection): the sheet closes, the page stays. Pinned by the stack-order test in Task 5.
2. **Rotating mid-stream**: no WebView reload, the stream keeps running. Pinned by `configChanges` in Task 3 and the rotation check in Task 4.
3. **Sign-in tab closed by the user** (back from the Custom Tab, no callback): the button comes back without an error message. Pinned by the cancel test in Task 4 (JS side exists; the plugin must reject `CANCELLED` on resume without a callback).
4. **Update check offline or GitHub 403/rate-limited**: no banner, no error, retried the next day. Pinned by a test in Task 6.
5. **A release with no APK asset** (gate off, or Android job failed): the site shows no Android button and the update check shows nothing. Pinned by tests in Tasks 6 and 7.

---

### Task 1: Platform value, usage and sign-in screen

**Files:**
- Modify: `src/renderer/src/lib/portal.ts`
- Modify: `vite.phone.config.ts`
- Modify: `src/phone/api.ts:311,315`
- Modify: `src/phone/nativeSignIn.ts:77`
- Modify: `src/phone/SignIn.tsx`
- Modify: `src/shared/usage.ts:6`, `workers/portal/src/adminPage.ts:187`
- Modify: `package.json` (script `build:android`)
- Test: `tests/renderer/phone-api.test.ts`, `tests/renderer/phone-native-signin.test.ts`, `tests/renderer/phone-app-native.test.tsx`, `tests/portal/usage.test.ts`, `tests/portal/admin-stats.test.ts`

**Interfaces:**
- Produces: `export type AppPlatform = 'web' | 'ios' | 'android'`; `export const APP_PLATFORM: AppPlatform` (from `import.meta.env.VITE_APP_PLATFORM`, default `'web'`); `isNativeApp()` unchanged in meaning (`APP_PLATFORM !== 'web'`). `export const ANDROID_CHANNEL: 'apk' | 'play'` (from `import.meta.env.VITE_ANDROID_CHANNEL`, default `'apk'`), all in `src/renderer/src/lib/portal.ts`.
- Produces: `nativeSignIn` sends `app: APP_PLATFORM` (`'ios'` or `'android'`); add an optional `deps.app?: 'ios' | 'android'` for tests.
- Produces: `npm run build:android` → `out/android-web` then `cap sync android` (the `cap sync` part is added in Task 3; until then the script is just the Vite build).

- [ ] **Step 1: Write failing tests**
  - `phone-native-signin.test.ts`: `it('opens the Android flow with app=android')` — `nativeSignIn({ app: 'android', start, fetch })`, assert the start URL's `app` param is `'android'`; the existing iOS test still asserts `'ios'`.
  - `phone-api.test.ts`: with `@/lib/portal` mocked to `APP_PLATFORM: 'android'`, usage and error reports carry `platform: 'android'`; mocked `'ios'` → `'ios'`; `'web'` → `'phone'`.
  - `phone-app-native.test.tsx`: with platform `'android'`, the sign-in screen shows "Sign in with Discord" and no "Sign in with Apple"; with `'ios'`, both.
  - `usage.test.ts` / `admin-stats.test.ts`: `'android'` accepted as a platform and listed on the dashboard.
- [ ] **Step 2: Run them, expect FAIL** — `npm test -- tests/renderer/phone-native-signin.test.ts tests/renderer/phone-api.test.ts tests/renderer/phone-app-native.test.tsx tests/portal/usage.test.ts tests/portal/admin-stats.test.ts`
- [ ] **Step 3: Implement**
  - `portal.ts`: `APP_PLATFORM`, `ANDROID_CHANNEL`, `isNativeApp`. Update the doc comments ("the iOS app" → "the iOS and Android apps").
  - `vite.phone.config.ts`: `const native = mode === 'ios' || mode === 'android'`; everything currently keyed on `ios` keys on `native`; `outDir` `out/${mode}-web` when native; define `import.meta.env.VITE_APP_PLATFORM` (`mode` when native, else `'web'`) and `import.meta.env.VITE_ANDROID_CHANNEL` from `process.env.ANDROID_CHANNEL === 'play' ? 'play' : 'apk'`. Rename `IOS_PORTAL` → `APP_PORTAL`.
  - `api.ts`: platform `APP_PLATFORM === 'web' ? 'phone' : APP_PLATFORM` for usage and errors.
  - `SignIn.tsx`: Apple button only when `APP_PLATFORM === 'ios'`.
  - `usage.ts` and `adminPage.ts`: add `'android'`.
  - `package.json`: `"build:android": "cross-env NODE_ENV=production vite build --config vite.phone.config.ts --mode android"`.
- [ ] **Step 4: Run the tests, expect PASS**; then `npm run typecheck` and `npm run build:ios` (still writes `out/ios-web`, no diff in `ios/` beyond `cap sync`'s copy).
- [ ] **Step 5: Commit** — `feat(phone): app platform value; Android reports android and hides Sign in with Apple`

### Task 2: Worker accepts the Android app

**Files:**
- Modify: `workers/portal/src/auth.ts:190-235`
- Modify: `workers/portal/src/appCors.ts`
- Test: `tests/portal/desktop-auth.test.ts`, `tests/portal/app-cors.test.ts`

**Interfaces:**
- Produces: `DesktopAuth.port: number | 'ios' | 'android'`; `app=android` (with no `port`) behaves exactly like `app=ios`, cookie `android.<state>.<challenge>`, callback `duelbinder://auth/callback`.
- Produces: `export const APP_ORIGINS = ['capacitor://localhost', 'https://localhost'] as const` replacing `IOS_APP_ORIGIN`; the allow-origin header echoes the request's origin when it is in the list.

- [ ] **Step 1: Write failing tests**
  - `desktop-auth.test.ts`: `/auth/desktop/start?app=android&state=…&challenge=…` redirects to Discord and sets `desktop_auth=android.…`; the callback with that cookie redirects to `duelbinder://auth/callback?code=…&state=…`; `app=android&port=5000` → 400; `app=windows` → 400.
  - `app-cors.test.ts`: origin `https://localhost` on `/api/me` preflight → 204 with `access-control-allow-origin: https://localhost`; same origin on a non-Bearer route (`/auth/logout`) → no CORS headers; no response ever sets `access-control-allow-credentials`; `capacitor://localhost` unchanged; `https://localhost.evil.test` → no headers.
- [ ] **Step 2: Run, expect FAIL** — `npm test -- tests/portal/desktop-auth.test.ts tests/portal/app-cors.test.ts`
- [ ] **Step 3: Implement** — `checkDesktopAuth` accepts `'android'` like `'ios'`; `startDesktopSignIn` maps `app` ∈ {ios, android} (no `port`) to itself; `desktopCallback` uses `APP_CALLBACK` (renamed from `IOS_CALLBACK`) for both. `appCors.ts`: `opensTo` checks membership in `APP_ORIGINS`; `ALLOW` becomes a function of the origin; update comments.
- [ ] **Step 4: Run, expect PASS**; `npm test -- tests/portal` all green.
- [ ] **Step 5: Commit** — `feat(portal): sign-in and CORS for the Android app`

### Task 3: The Android shell

**Files:**
- Create: `android/` (via `npx cap add android`), then modify `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `android/variables.gradle` as below
- Create: `scripts/android-version.mjs`, `tests/main/android-version.test.ts`
- Modify: `capacitor.config.ts`, `package.json`, `.gitignore`

**Interfaces:**
- Produces: `versionCode(version: string): number` and `versionName(version: string): string` in `scripts/android-version.mjs`; gradle reads `-PversionCode` / `-PversionName` (CI) and falls back to `1` / `0.0.0-dev`.
- Produces: gradle release signing from env `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`; with none set, `assembleRelease` produces an unsigned APK (debug builds always work).
- Produces: `MainActivity` (Java, `com.darkharasho.duelbinder`) — later tasks call `registerPlugin(...)` in its `onCreate` before `super.onCreate`.

- [ ] **Step 1: Toolchain (local, not committed)** — install JDK 21 (Temurin tarball) and Android cmdline-tools under `~/Android/` (`~/Android/jdk-21`, `~/Android/Sdk`); `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "emulator" "system-images;android-35;google_apis;x86_64"`; create AVD `pixel_api35`. Check: `JAVA_HOME=~/Android/jdk-21 ~/Android/Sdk/platform-tools/adb version` prints a version. (Use the platform/build-tools level Capacitor 8's template targets if it differs.)
- [ ] **Step 2: Failing test** — `android-version.test.ts`: `versionCode('0.47.0') === 47000`, `versionCode('1.2.3') === 1002003`, `versionCode('0.47.10') > versionCode('0.47.9')`, `versionCode('1.0.0') > versionCode('0.999.999')`; throws on `'1.2'`, `'1.2.3-beta'`, minor or patch ≥ 1000.
- [ ] **Step 3: Run, expect FAIL**, implement `scripts/android-version.mjs` (also runnable: `node scripts/android-version.mjs` prints `<versionName> <versionCode>` for package.json), run, expect PASS.
- [ ] **Step 4: Add the platform** — `npm i @capacitor/android@^8.5.3 @capacitor/app@^8`; `capacitor.config.ts`: `webDir: process.env.CAP_PLATFORM === 'android' ? 'out/android-web' : 'out/ios-web'`, `android: { backgroundColor: '#111113' }`; `npx cap add android`; `build:android` script appends `&& cross-env CAP_PLATFORM=android cap sync android`. `.gitignore` the generated web copy (`android/app/src/main/assets/public`) as Capacitor's template does.
- [ ] **Step 5: Manifest and gradle** — `CAMERA` permission plus `<uses-feature android:name="android.hardware.camera" android:required="false"/>`; main activity `android:screenOrientation="portrait"` and `android:configChanges` including `orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden|uiMode` (rotation must not recreate the activity); intent filter on the main activity for `VIEW` + `BROWSABLE` + scheme `duelbinder`, host `auth`; `launchMode="singleTask"` so the callback returns to the running activity. Gradle: version properties and env signing as in Interfaces. App icon/splash from `resources/` (`@capacitor/assets` or hand-made mipmaps — builder's call).
- [ ] **Step 6: Insets** — make the page's `env(safe-area-inset-*)` hold under Android 15 edge-to-edge (Capacitor 8 system-bars handling, or native padding on the WebView). Check on the emulator: status bar and gesture bar never cover content on Home, Collection, Scan and a sheet; screenshot each.
- [ ] **Step 7: Verify** — `npm run build:android && (cd android && ./gradlew assembleDebug)` succeeds; install on `pixel_api35`; the app opens to the sign-in screen with only the Discord button; collection screens render (with a token pasted via devtools if sign-in isn't done yet); `npm run build:ios` still works.
- [ ] **Step 8: Commit** — `feat(android): Capacitor Android shell`

### Task 4: Native plugins — WebAuth and Stream

**Files:**
- Create: `android/app/src/main/java/com/darkharasho/duelbinder/WebAuthPlugin.java`
- Create: `android/app/src/main/java/com/darkharasho/duelbinder/StreamPlugin.java`
- Modify: `MainActivity.java`, `android/app/build.gradle` (`androidx.browser:browser`)
- Modify: `src/phone/nativeSignIn.ts`, `src/phone/stream/device.ts` (doc comments only: "the iOS and Android plugins")

**Interfaces:**
- Consumes: JS contracts already in `nativeSignIn.ts` and `stream/device.ts` — `WebAuth.start({url, callbackScheme}) → {url}`, rejects with code `CANCELLED`; `Stream.enter()`, `Stream.exit()`.
- Produces: Android `WebAuth` (`@CapacitorPlugin(name = "WebAuth")`) with `start` only (no `appleSignIn`; calling it rejects `UNAVAILABLE`). `Stream` (`@CapacitorPlugin(name = "Stream")`).

- [ ] **Step 1: WebAuth** — `start` saves the call, opens `url` in a Custom Tab. `handleOnNewIntent` with a `duelbinder:` URI resolves `{url: uri.toString()}`. `handleOnResume` with a pending call and no callback received → reject `CANCELLED` (post the check briefly so a callback arriving with the resume wins). A second `start` while one is pending rejects the first with `CANCELLED`.
- [ ] **Step 2: Stream** — `enter`: `setRequestedOrientation(SCREEN_ORIENTATION_SENSOR)` minus reverse portrait (`USER` with `FULL_USER` excluded is fine — any orientation but upside down) and `FLAG_KEEP_SCREEN_ON`; `exit`: `SCREEN_ORIENTATION_PORTRAIT`, clear the flag. All on the UI thread.
- [ ] **Step 3: Register** both in `MainActivity.onCreate` before `super.onCreate`.
- [ ] **Step 4: Verify on the emulator** (Worker from Task 2 running locally with `wrangler dev`, or deployed if the owner has approved the deploy):
  - Sign in with Discord → Custom Tab → back in the app, signed in; usage shows `android`.
  - Open the tab and press back → sign-in button returns, no error.
  - Start a stream, rotate the emulator → landscape, no reload, stream continues; screen stays on; exit → portrait.
  - Record what was checked against the emulator vs left for the device.
- [ ] **Step 5: Commit** — `feat(android): sign-in and stream plugins`

### Task 5: Android back button

**Files:**
- Create: `src/phone/backButton.ts`
- Modify: `src/phone/main.tsx` (listener), `src/phone/PhoneShell.tsx` (More sheet, page back), `src/phone/PickerSheet.tsx`, `src/phone/ReviewSheet.tsx`, `src/phone/ScannerScreen.tsx`, `src/phone/stream/StreamScreen.tsx`, `src/phone/stream/StreamStart.tsx`, and any other phone sheet/dialog with an `onClose`
- Test: `tests/renderer/phone-back-button.test.tsx`

**Interfaces:**
- Produces: `useBackHandler(active: boolean, onBack: () => void): void` — while `active`, `onBack` is on a stack; `handleBack(): boolean` — calls the top handler and returns true, or returns false when the stack is empty. Pure module state plus the hook.
- Produces: `listenForBack(deps?: { addListener?, exitApp? }): void` called from `main.tsx` only when `APP_PLATFORM === 'android'`; on `backButton`, `handleBack() || exitApp()`.

- [ ] **Step 1: Failing tests** — `phone-back-button.test.tsx`:
  - `handleBack()` with nothing registered → `false`.
  - Two handlers (page then sheet) → first `handleBack()` calls only the sheet's; after it deactivates, the next calls the page's.
  - Rendering the Shell on Collection with a `PickerSheet` open: `handleBack()` closes the picker and Collection stays shown; `handleBack()` again goes to Home; on Home, `handleBack()` → `false`.
  - `listenForBack` with fakes: back with an empty stack calls `exitApp` once; with a handler, doesn't.
- [ ] **Step 2: Run, expect FAIL** — `npm test -- tests/renderer/phone-back-button.test.tsx`
- [ ] **Step 3: Implement** — the module and hook; `useBackHandler(page !== 'dashboard', () => onNavigate('dashboard'))` in the Shell; each sheet/dialog `useBackHandler(open, onClose)`; the scanner and stream screens register their own close. Listener via `App.addListener('backButton', …)` from `@capacitor/app`.
- [ ] **Step 4: Run, expect PASS**; full `npm test -- tests/renderer` green; on the emulator, back closes a sheet, then goes Home, then leaves the app.
- [ ] **Step 5: Commit** — `feat(phone): Android back button closes sheets, then goes Home`

### Task 6: Update banner for APK installs

**Files:**
- Create: `src/shared/androidRelease.ts`
- Create: `src/phone/UpdateBanner.tsx`
- Modify: `src/phone/PhoneShell.tsx` (render the banner)
- Test: `tests/renderer/phone-update-banner.test.tsx`, `tests/main/android-release.test.ts`

**Interfaces:**
- Produces (`src/shared/androidRelease.ts`, used again in Task 7): `pickApk(release: unknown): { version: string; url: string; name: string; size: number } | null` — the first asset matching `/^Duel-Binder-.+\.apk$/` from a GitHub "latest release" JSON, version from `tag_name` minus `v`; `isNewer(latest: string, current: string): boolean` (semver x.y.z numeric compare; anything unparsable → false).
- Produces: `checkForUpdate(deps: { fetch: typeof fetch; now: () => number; storage: Storage; current: string }): Promise<{ version: string; url: string } | null>` in `UpdateBanner.tsx` (or a sibling module); reads `https://api.github.com/repos/darkharasho/duel-binder/releases/latest`; at most one network call per 24 h (timestamp key `duelbinder.updateCheckedAt`); a dismissed version (`duelbinder.updateDismissed`) isn't shown again.

- [ ] **Step 1: Failing tests**
  - `android-release.test.ts`: `pickApk` finds `Duel-Binder-0.48.0.apk`, ignores `.aab`, `.dmg`, and a release with no APK → `null`; non-object → `null`. `isNewer('0.48.0','0.47.0')`, `isNewer('0.47.10','0.47.9')` true; equal false; older false; `'x'` false.
  - `phone-update-banner.test.tsx`: newer APK → banner with "Update to 0.48.0" linking to the asset URL; same version → nothing; fetch rejects or 403 → nothing and no throw; second check within 24 h makes no fetch; dismiss hides it and it stays hidden after remount for that version; the banner never renders when `APP_PLATFORM !== 'android'` or `ANDROID_CHANNEL === 'play'`.
- [ ] **Step 2: Run, expect FAIL** — `npm test -- tests/main/android-release.test.ts tests/renderer/phone-update-banner.test.tsx`
- [ ] **Step 3: Implement**; the link opens outside the app (`target="_blank"`, which Capacitor hands to the system browser — confirm on the emulator). Banner sits above the page content, below the status line, dismissible; current version from `__APP_VERSION__`.
- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(phone): tell APK installs about a newer version`

### Task 7: Android download on duelbinder.com

**Files:**
- Modify: `workers/portal/src/site/releases.ts`, `workers/portal/src/site/os.ts`, `workers/portal/src/site/page.ts`
- Test: `tests/portal/site-releases.test.ts`, `tests/portal/site-page.test.ts`

**Interfaces:**
- Consumes: `pickApk` from Task 6.
- Produces: `Downloads.android: Asset | null`; `isAndroid(userAgent: string | null): boolean` in `os.ts` (`detectOs` unchanged).

- [ ] **Step 1: Failing tests**
  - `site-releases.test.ts`: `pickDownloads` sets `android` from a `Duel-Binder-*.apk` asset, `null` without one.
  - `site-page.test.ts`: Android UA + APK present → hero button "Download for Android" to the APK URL, meta line mentions Android, and a short note "Allow installs from your browser when Android asks."; Android UA + no APK → hero unchanged from today; download table has an Android row only when the APK exists; desktop UAs unchanged.
- [ ] **Step 2: Run, expect FAIL** — `npm test -- tests/portal/site-releases.test.ts tests/portal/site-page.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npm test -- tests/portal`.
- [ ] **Step 5: Commit** — `feat(site): Android download once a release carries the APK`

### Task 8: Signing key, CI and release

**Files:**
- Create: `.github/workflows/android.yml`
- Modify: `.github/workflows/release.yml` only if the Android job must wait on its draft release (prefer a `needs`-free job that waits/uploads with `gh release upload` after the draft exists — builder's call)
- Modify: `README.md` (short "Android app" section: build commands, key location, the `ANDROID_RELEASE` gate)

**Interfaces:**
- Consumes: `build:android`, `scripts/android-version.mjs`, gradle signing env from Task 3.

- [ ] **Step 1: Generate the key (this machine, once)** — `mkdir -p ~/.android-keys && chmod 700 ~/.android-keys`; random 32-char passwords into `~/.android-keys/duel-binder-release.txt` (mode 600); `keytool -genkeypair -v -keystore ~/.android-keys/duel-binder-release.jks -alias duelbinder -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Duel Binder, O=darkharasho"` with those passwords. **Stop if the file already exists — never overwrite.** Set the four secrets with `env -u GITHUB_TOKEN gh secret set … -R darkharasho/duel-binder`, values piped from files, never echoed. Print only the certificate SHA-256 (`keytool -list -v … | grep SHA256`) for the README and the Play setup.
- [ ] **Step 2: Workflow** — `android.yml` on `ubuntu-latest`, JDK 21, Node 22, `npm ci --ignore-scripts`:
  - Triggers: `v*` tags, `workflow_dispatch`, PRs touching `android/**`, `capacitor.config.ts`, `vite.phone.config.ts`, `src/phone/**`, the workflow.
  - PR: `build:android` + `assembleDebug` (compile check, no secrets).
  - Tag / dispatch with secrets: decode keystore to `$RUNNER_TEMP`; `build:android` + `assembleRelease` → rename to `Duel-Binder-<version>.apk`; `ANDROID_CHANNEL=play build:android` + `bundleRelease` → `.aab`; versions from `node scripts/android-version.mjs`. Upload both as workflow artifacts. On a tag **and** `vars.ANDROID_RELEASE == 'true'`, attach the APK to the tag's GitHub release (wait for `release.yml`'s draft to exist).
  - Without secrets on a tag/dispatch: warn and build unsigned, like `ios.yml`.
  - Verify with `apksigner verify --print-certs` that the APK's cert SHA-256 matches Step 1.
- [ ] **Step 3: Verify** — push the branch, run `workflow_dispatch`, show the run with the CI watcher card; download the APK artifact, install on the emulator, it signs in. The PR run's debug compile passes.
- [ ] **Step 4: Commit** — `ci(android): signed APK and Play bundle`

### Task 9: Hand-off (owner steps, not code)

- [ ] Ask the owner to approve the Worker deploy (Task 2 + Task 7) and deploy it.
- [ ] Give the owner the `workflow_dispatch` APK to sideload and check: camera scanning (both games), Stream rotation, sign-in, back button.
- [ ] After their OK: `gh variable set ANDROID_RELEASE --body true`; the next `v*` release carries the APK and the website shows it.
- [ ] Remind them: copy `~/.android-keys/` offline; Play identity verification, listing, closed test; enrol Play App Signing with this key (upload the existing key via PEPK), and upload the AAB artifact by hand.
- [ ] Update the memory file for the Android app.
