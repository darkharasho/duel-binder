# Live Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iOS and Android store shells fetch each release's web code from our Worker and switch to it invisibly, so only native changes need store review.

**Architecture:** `@capgo/capacitor-updater` v8 in manual mode does the native download, per-file hash check, swap and rollback. Our Worker serves content-addressed files and signed release records from R2. CI publishes each tag's web build and makes it live once the tag's tests pass. `src/phone/liveUpdate.ts` checks, verifies the signature, downloads, and switches on a cold start or on an idle Home visit.

**Tech Stack:** Capacitor 8.5.3, `@capgo/capacitor-updater@^8.54`, React (src/phone), Cloudflare Worker + R2 (`workers/portal`), Node 24 scripts, GitHub Actions, vitest, WebCrypto ECDSA P-256.

**Spec:** `docs/superpowers/specs/2026-11-16-live-updates-design.md`

## Decisions this plan makes (from reading the plugin source, v8.54.2)

- **Signing: our own manifest signature, no Capgo `publicKey`.** With `publicKey` set, the plugin requires a Capgo session key and AES-encrypted files for every download (`requireSessionKeyForEncryptedUpdate`), and we would have to copy Capgo's private encryption format. Without it, both platforms still check every downloaded file against its manifest `file_hash` (iOS `downloadManifestFileOnce`, Android `copyStreamIfChecksumMatches`). So CI signs `{target, version, manifest}` with an ECDSA P-256 key, and `liveUpdate.ts` verifies it before it calls `download`. The spec allows this fallback. The public key ships inside the JS, so the trust chain is: store shell → built-in JS → each signed bundle.
- **Built-in reuse is native.** The plugin copies a manifest file from the built-in bundle when its hash matches (plus the `ota-builtin-hashes.json` Capacitor hook it installs). Only changed files download. No compression work.
- **iOS install path:** the project uses SPM (`ios/App/CapApp-SPM`), and the plugin ships a `Package.swift`. `cap sync ios` adds it.
- **Files are shared across targets:** `app-bundles/files/<sha256>` serves all three targets, because identical files dedupe. Release records stay per target.
- **Routes live under `/api/`** (`/api/app-update`, `/api/app-bundles/files/<sha256>`, `/api/admin/app-bundles/...`). That way the existing `withAppCors` opens them to `capacitor://localhost` and `https://localhost` without new CORS rules.
- **"Tests passed" means the tag's GitHub release exists.** `release.yml`'s `create-release` job `needs: test`, and `android.yml` already waits for the release this way.
- **Shell records:** right after each build, CI PUTs `builtins/<version>.json` holding the fingerprint, before waiting for tests. A TestFlight/Play shell built from a tag whose tests failed can then still be matched.
- **APK link:** `shellUpdate` uses the GitHub release asset URL, recorded only once the release is published (not a draft), so the link never 404s.

## Global Constraints

- Plugin: `@capgo/capacitor-updater` major **8** (peer `@capacitor/core ^8`). Never 9 or 10, which peer on Capacitor 5.
- Plugin config: `autoUpdate: false`, `appReadyTimeout: 10000`, `resetWhenUpdate: true`, `statsUrl: ''`, and **no** `publicKey`. Nothing may reach `*.capgo.app` (verified in Task 4).
- Targets are exactly `'ios' | 'android-apk' | 'android-play'`. Android targets share one fingerprint.
- Check interval: launch, plus each return to foreground at most every **10 min**.
- Home idle switch: page `dashboard`, **2000 ms** with no pointer/key input, no `[role="dialog"]` open, and account sync state not `'syncing'`.
- Fade: to `#111113` over **150 ms** before `set`. Note: "Updated to X" for about **2 s** via the phone's sonner `toast`.
- `/api/app-update` edge cache: **60 s** per full URL.
- R2 bucket binding `IMAGES`, prefix `app-bundles/`.
- Migrations after version **48** must not contain `DROP COLUMN` or `RENAME COLUMN`.
- Deploy the portal Worker **before** the first tag whose CI uploads bundles.
- Run vitest with `--maxWorkers=2` (`npm test` already does this). Before pushing, run `npm run typecheck:web` and `npm run typecheck:phone` separately.

## Review Focus

1. **A bundle that rolled back is offered again forever.** After the plugin reverts a bundle that never called `notifyAppReady`, the next check must not download that version again. Pinned by `liveUpdate: skips a version the plugin rolled back` (Task 5).
2. **Signature mismatch or tampered manifest.** A bad or missing signature, or a manifest edited after signing, must never reach `download`. Pinned by `liveUpdate: refuses an offer whose signature doesn't verify` (Task 5) and `signedMessage is stable across key order` (Task 1).
3. **Withdrawal across a schema change.** A withdrawn current version with only older releases on another schema must get `{version: null}`, not a downgrade. Pinned by `pickRelease: withdrawn current, no same-schema fallback` (Task 1).
4. **Unknown built-in version** (a shell from a tag CI never recorded, or a dev build reporting `1.0`). The answer must be `{version: null}`, never a bundle for some other fingerprint. Pinned by `app-update: unknown builtin gets nothing` (Task 2).
5. **Switch during activity.** A touch at 1.9 s, a sheet opened, or a sync starting during the idle wait must cancel the switch, and leaving Home must cancel the timer. Pinned by the idle-guard tests in Task 6.

---

### Task 1: Shared release contract

**Files:**
- Create: `src/shared/appBundles.ts`
- Test: `tests/shared/app-bundles.test.ts`

**Interfaces:**
- Produces:
  - `type BundleTarget = 'ios' | 'android-apk' | 'android-play'`; `isBundleTarget(v: unknown): v is BundleTarget`
  - `interface ManifestEntry { file_name: string; file_hash: string; download_url: string }` (plugin field names)
  - `interface ReleaseRecord { target: BundleTarget; version: string; fingerprint: string; schema: number; manifest: ManifestEntry[]; signature: string /* base64url, IEEE P1363 */; createdAt: string; withdrawn?: true; apkUrl?: string }`
  - `interface IndexEntry { version: string; fingerprint: string; schema: number; withdrawn?: true; apkUrl?: string }`
  - `type AppUpdateAnswer = { version: null; shellUpdate?: { version: string; url: string } } | { version: string; manifest: ManifestEntry[]; signature: string; shellUpdate?: { version: string; url: string } }`
  - `signedMessage(target: BundleTarget, version: string, manifest: ManifestEntry[]): Uint8Array`: UTF-8 of `JSON.stringify([target, version, manifest sorted by file_name, each as [file_name, file_hash, download_url]])`.
  - `pickRelease(index: IndexEntry[], q: { fingerprint: string; current: string }): IndexEntry | null`
  - `pickShellUpdate(index: IndexEntry[], q: { fingerprint: string; builtin: string }): { version: string; url: string } | null`
  - Uses `isNewer` from `src/shared/androidRelease.ts` for version order.

`pickRelease` rule: candidates are entries with the same `fingerprint` that are not withdrawn. If the newest candidate is newer than `current`, return it. Otherwise, if `current` is withdrawn in the index, return the newest candidate older than `current` whose `schema` equals current's `schema`, else `null`. Otherwise return `null`.

`pickShellUpdate` rule: the newest entry with `apkUrl`, `fingerprint !== q.fingerprint` and `isNewer(version, q.builtin)`. Otherwise `null`.

- [ ] **Step 1: Write the failing tests** in `tests/shared/app-bundles.test.ts`:
  - `pickRelease: offers the newest same-fingerprint release`: index `0.101.0/fpA/48`, `0.102.0/fpA/48`, `0.103.0/fpB/48`; `{fingerprint:'fpA', current:'0.101.0'}` → `0.102.0`.
  - `pickRelease: nothing when current is newest`: same index, current `0.102.0` → `null`.
  - `pickRelease: skips withdrawn`: `0.102.0` withdrawn, current `0.101.0` → `null`.
  - `pickRelease: withdrawn current falls back on the same schema`: `0.101.0/48`, `0.102.0/48 withdrawn`, current `0.102.0` → `0.101.0`.
  - `pickRelease: withdrawn current, no same-schema fallback`: `0.101.0/47`, `0.102.0/48 withdrawn`, current `0.102.0` → `null`.
  - `pickShellUpdate: newer APK on another fingerprint`: `0.104.0/fpB` with `apkUrl` and builtin `0.101.0` on `fpA` → `{version:'0.104.0', url}`; same fingerprint → `null`; no `apkUrl` → `null`.
  - `signedMessage is stable across key order`: two manifests with the same entries in different array order give equal bytes; changing one `file_hash` gives different bytes.
- [ ] **Step 2: Run** `npm test -- tests/shared/app-bundles.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/shared/appBundles.ts` with the interfaces above. No imports beyond `./androidRelease`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(live-update): shared release contract`

---

### Task 2: Worker routes

**Files:**
- Create: `workers/portal/src/appBundles.ts`
- Modify: `workers/portal/src/index.ts` (call next to `catalogSnapshotRoute`, around line 173)
- Test: `tests/portal/app-bundles.test.ts` (reuse the in-memory bucket pattern from `tests/portal/catalog-snapshot.test.ts`; extract it to `tests/portal/helpers` if it's copied verbatim)

**Interfaces:**
- Consumes: Task 1 types, `pickRelease`, `pickShellUpdate`, `isBundleTarget`. Uses `adminAuthorized` from `./thumbs` and `withAppCors` from `./appCors`.
- Produces: `appBundlesRoute(req: Request, bucket: AppBundleBucket, adminToken: string | undefined, cache: Cache | null, now?: () => number): Promise<Response | null>` (null for other paths). `AppBundleBucket` = `get`, `head`, `put` from `SnapshotBucket`.

R2 layout:
- `app-bundles/files/<sha256>`
- `app-bundles/<target>/builtins/<version>.json` → `{fingerprint, schema}`
- `app-bundles/<target>/releases/<version>.json` → `ReleaseRecord`
- `app-bundles/<target>/index.json` → `IndexEntry[]`, rewritten on every release PUT, withdraw, restore and apk

Routes:
- `GET /api/app-update?target&builtin&current`: 400 on a bad target or a non-x.y.z version. Looks up the `builtins/<builtin>.json` fingerprint (missing → `{version:null}`), runs `pickRelease`, and loads the chosen record. For `android-apk` it adds `shellUpdate` from `pickShellUpdate`. Response is `cache-control: public, max-age=60`, put in `cache` keyed by URL, and wrapped in `withAppCors` by the caller.
- `GET /api/app-bundles/files/<sha256>`: streams the R2 object, `cache-control: public, max-age=31536000, immutable`; 404 when missing.
- `HEAD` on the same path: 200 or 404 (CI uses it to skip uploads).
- `PUT /api/admin/app-bundles/files/<sha256>` (admin): body sha256 must equal the path, else 400 `hash-mismatch`. Single PUT, no multipart: the largest file is about 11 MB, well under the Worker body limit.
- `PUT /api/admin/app-bundles/<target>/builtins/<version>` (admin): body `{fingerprint, schema}`.
- `GET /api/admin/app-bundles/<target>/builtins/<version>` (admin): the stored `{fingerprint, schema}` or 404 (Task 8's store-release notice).
- `PUT /api/admin/app-bundles/<target>/releases/<version>` (admin): body `ReleaseRecord`. 400 `file-missing` if any manifest `file_hash` lacks an object in `files/`. 400 on a version or target mismatch with the path. Also writes the builtins record if absent.
- `POST /api/admin/app-bundles/<target>/releases/<version>/withdraw` and `/restore` (admin): flips `withdrawn` in the record and the index. 404 if unknown.
- `POST /api/admin/app-bundles/android-apk/releases/<version>/apk` (admin): body `{url}`. Sets `apkUrl`.

- [ ] **Step 1: Write the failing tests:** `app-update: offers newer release with manifest and signature`, `app-update: unknown builtin gets nothing`, `app-update: withdrawn current falls back`, `app-update: android-apk carries shellUpdate`, `files: serves immutable content`, `admin: rejects without token (401)`, `admin: file hash mismatch is 400`, `admin: release with missing file is 400`, `admin: withdraw then restore round-trips the index`.
- [ ] **Step 2: Run** `npm test -- tests/portal/app-bundles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `appBundlesRoute` and wire it into `index.ts` before `thumbsRoute`, passing `edgeCache()` and wrapping the response in `withAppCors(req, res)`.
- [ ] **Step 4: Run** the portal tests (`npm test -- tests/portal`). Expected: PASS, nothing else broken.
- [ ] **Step 5: Commit** `feat(portal): live update bundle routes`

---

### Task 3: CI publish scripts and the additive-migration guard

**Files:**
- Create: `scripts/live-update/fingerprint.ts`, `scripts/live-update/publish.ts`
- Test: `tests/main/live-update-scripts.test.ts`, `tests/main/migrations-additive.test.ts`

**Interfaces:**
- Consumes: Task 1 `signedMessage`, `ManifestEntry`, `BundleTarget`; `MIGRATIONS` from `src/main/db/schema.ts`.
- Produces (CLI, run with `node`, like `scripts/android-version.ts`):
  - `node scripts/live-update/fingerprint.ts <ios|android>` prints a 64-hex fingerprint.
  - `node scripts/live-update/publish.ts upload <target> <webDir> <out.json>`: hashes every file, HEADs and uploads missing ones, PUTs the builtins record, and writes the unsigned release draft to `out.json`.
  - `node scripts/live-update/publish.ts release <out.json>`: signs and PUTs the release record.
  - `node scripts/live-update/publish.ts apk <version> <url>`.
  - Env: `PORTAL_URL` (default `https://app.duelbinder.com`), `PORTAL_ADMIN_TOKEN`, `LIVE_UPDATE_SIGNING_KEY` (PKCS8 PEM, `release` only).
  - Exported, for tests: `fingerprint(files: { path: string; bytes: Uint8Array }[], lockPackages: Record<string, string>): string`, `nativeFiles(platform: 'ios' | 'android'): string[]`, `schemaVersion(): number`, `buildManifest(webDir: string, origin: string): ManifestEntry[]`, `sign(message: Uint8Array, pkcs8Pem: string): string` (ECDSA P-256 SHA-256, `dsaEncoding: 'ieee-p1363'`, base64url).

Fingerprint inputs:
- **ios:** `ios/App/App/**/*.swift`, `ios/App/App/Info.plist`, `ios/App/App/App.entitlements`, `ios/App/CapApp-SPM/Package.swift`, `capacitor.config.ts`.
- **android:** `android/app/src/main/java/**`, `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `android/capacitor.settings.gradle`, `capacitor.config.ts`.
- **Both:** the resolved versions of every `node_modules/@capacitor/*` and `@capgo/*` entry in `package-lock.json`.

Files are sorted by path, and the hash covers path + NUL + bytes.

Manifest: `file_name` is the path relative to `webDir` with `/` separators. Skip `ota-builtin-hashes.json`. `download_url` = `${origin}/api/app-bundles/files/<sha256>`.

- [ ] **Step 1: Write the failing tests:**
  - `fingerprint changes with a plugin version`
  - `fingerprint ignores file order`
  - `buildManifest lists nested files with sha256` (temp dir with `index.html`, `assets/a.js`)
  - `sign output verifies with WebCrypto against signedMessage` (generate a key in the test)
  - `migrations-additive: no DROP COLUMN or RENAME COLUMN after v48`: every `MIGRATIONS` entry with `version > 48`, `sql` (and string `server`) do not match `/\b(DROP|RENAME)\s+COLUMN\b/i`
- [ ] **Step 2: Run** `npm test -- tests/main/live-update-scripts.test.ts tests/main/migrations-additive.test.ts`. Expected: the scripts tests FAIL; the additive test passes already (it guards the future).
- [ ] **Step 3: Implement** both scripts. `schemaVersion()` = `MIGRATIONS.at(-1)!.version`. Upload with `fetch`, 4 files at a time, and throw on any non-2xx so the CI step fails loudly.
- [ ] **Step 4: Run** the tests, then `node scripts/live-update/fingerprint.ts ios` and the same for `android`. Expected: PASS, and two different 64-hex lines.
- [ ] **Step 5: Commit** `feat(live-update): fingerprint and publish scripts, additive-migration guard`

---

### Task 4: The shell plugin

**Files:**
- Modify: `package.json` / `package-lock.json` (`npm i @capgo/capacitor-updater@^8.54`), `capacitor.config.ts`, `ios/App/CapApp-SPM/Package.swift` (written by `cap sync`), Android Gradle files written by `cap sync`
- Modify: `src/phone/main.tsx` (ready signal)
- Test: compile checks only (native)

**Interfaces:**
- Produces: `capacitor.config.ts` `plugins.CapacitorUpdater = { autoUpdate: false, appReadyTimeout: 10000, resetWhenUpdate: true, statsUrl: '', updateUrl: 'https://app.duelbinder.com/api/app-update/none', channelUrl: 'https://app.duelbinder.com/api/app-update/none' }`. The last two never get called with `autoUpdate: false`. Pointing them at our own host means even a stray call can't reach Capgo, and `/api/app-update/none` falls through to a 404.

- [ ] **Step 1: Install and configure.** Run `npm i @capgo/capacitor-updater@^8.54`, edit the config, then `npm run build:ios` and `npm run build:android`. Expected: `ios/App/CapApp-SPM/Package.swift` lists `CapgoCapacitorUpdater`, and `out/*-web/ota-builtin-hashes.json` (or the copied public dir) exists.
- [ ] **Step 2: Ready signal.** In `main.tsx`, before `start()`: `if (isNativeApp()) void import('@capgo/capacitor-updater').then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady())`. Dynamic import, so the web build (`APP_PLATFORM` web) never loads the plugin. Do not await it before rendering.
- [ ] **Step 3: Check that nothing reaches Capgo.** In `node_modules/@capgo/capacitor-updater`, confirm that with `statsUrl: ''` both `sendStats` paths (iOS `CapgoUpdater.swift`, Android `CapgoUpdater.java`) return before any request. Also confirm that `shakeMenu` defaults off. Record the file:line evidence in the commit message. If either doesn't hold, point `statsUrl` at `/api/app-update/none` too.
- [ ] **Step 4: Compile.** Run `cd android && ./gradlew assembleDebug --console=plain`. Expected: BUILD SUCCESSFUL. iOS compiles in the PR's `ios.yml` check (Task 8 opens the PR).
- [ ] **Step 5: Commit** `feat(phone): add the live update plugin to the shells`

---

### Task 5: Check, verify, download

**Files:**
- Create: `src/phone/liveUpdate.ts`, `src/phone/liveUpdateKey.ts` (the public key as a JWK constant; the key itself comes from Task 8 step 1, so use a test key until then and leave a `// replaced in Task 8` note)
- Modify: `src/phone/main.tsx` (start it)
- Test: `tests/renderer/phone-live-update.test.ts`

**Interfaces:**
- Consumes: Task 1 `AppUpdateAnswer`, `signedMessage`, `BundleTarget`; `APP_PLATFORM`, `ANDROID_CHANNEL`, `PORTAL_ORIGIN` from `@/lib/portal`.
- Produces:
  - `interface Updater { getBuiltinVersion(): Promise<{ version: string }>; download(o: { url?: string; version: string; manifest: ManifestEntry[] }): Promise<{ id: string; version: string }>; next(o: { id: string }): Promise<unknown>; set(o: { id: string }): Promise<void>; delete(o: { id: string }): Promise<void>; addListener(e: 'updateFailed', cb: (info: { bundle: { version: string } }) => void): Promise<unknown> }` (the subset of `CapacitorUpdater` we use)
  - `createLiveUpdate(deps: { updater: Updater; fetch: typeof fetch; storage: Storage; now: () => number; target: BundleTarget; current: string; publicKey: JsonWebKey; on(event: 'visible', cb: () => void): () => void }): LiveUpdate`
  - `interface LiveUpdate { check(): Promise<void>; pending(): { id: string; version: string } | null; applyNow(): Promise<void>; dispose(): void }`
  - `bundleTarget(): BundleTarget | null` (null on web)
  - `startLiveUpdate(): LiveUpdate | null`, the module-level instance used by Task 6
  - Storage keys: `duelbinder.liveUpdate.checkedAt`, `.failed` (JSON array of versions), `.pending` (`{id, version}`), `.shown`, `duelbinder.shellUpdate` (`{version, url}` or null)

Behaviour:
- `check()` returns early if the last check was under 10 min ago.
- It GETs `${PORTAL_ORIGIN}/api/app-update?target&builtin&current` and stores `shellUpdate` (or null) under `duelbinder.shellUpdate`.
- If `version` is non-null, not in `.failed`, and not the pending version, it verifies the signature: `crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, key, sig, signedMessage(...))`.
- Then it calls `download`, then `next({id})`, deletes the previous pending bundle, and saves `.pending`.
- Every failure is caught and silent.
- `updateFailed` adds the version to `.failed`.
- `on('visible')` runs `check()`.

- [ ] **Step 1: Write the failing tests** (updater and fetch are mocks; generate a P-256 key pair in the test):
  - `liveUpdate: downloads a newer signed offer and sets it next`
  - `liveUpdate: refuses an offer whose signature doesn't verify` (manifest edited after signing → no `download`)
  - `liveUpdate: skips a version the plugin rolled back` (fire `updateFailed` for 0.102.0, then offer 0.102.0 → no `download`)
  - `liveUpdate: checks at most every 10 minutes` (two checks 5 min apart → one fetch; 11 min → two)
  - `liveUpdate: a newer offer replaces the pending one` (old id passed to `delete`)
  - `liveUpdate: offline is silent` (fetch rejects → no throw, no download)
  - `liveUpdate: stores shellUpdate from the answer`
  - `bundleTarget: android play/apk and ios, null on web`
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-live-update.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `startLiveUpdate()` wires the real plugin (dynamic import), `localStorage`, and `visibilitychange` → visible. `current` is `__APP_VERSION__`. In `main.tsx`, call `startLiveUpdate()` after `notifyAppReady`, and only when `isNativeApp()`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): check, verify and download live updates`

---

### Task 6: Home-idle switch, fade, note, version in Settings

**Files:**
- Create: `src/phone/liveUpdateSwitch.ts`
- Modify: `src/phone/PhoneShell.tsx` (use the hook with `page`), `src/phone/App.tsx` (show the "Updated to X" note once after mount), `src/phone/Settings.tsx` (version line, around line 362)
- Test: `tests/renderer/phone-live-update-switch.test.tsx`

**Interfaces:**
- Consumes: Task 5 `LiveUpdate` (`pending`, `applyNow`) and `startLiveUpdate`. Uses `window.api.account.status()` (`state === 'syncing'`).
- Produces:
  - `useHomeIdleSwitch(page: Page, deps?: { live: LiveUpdate | null; syncing: () => Promise<boolean>; idleMs?: number }): void`. While `page === 'dashboard'` and `live?.pending()`, it arms a 2000 ms timer. `pointerdown`, `keydown` or `touchstart` on `document` re-arms it. When it fires, it checks that `document.querySelector('[role="dialog"]')` is null and `!(await syncing())`. If those pass, it adds `document.documentElement.classList.add('live-update-fade')`, waits 150 ms, then calls `applyNow()`. Otherwise it re-arms. Leaving `dashboard` or unmounting clears it.
  - `LiveUpdate.applyNow()` (Task 5) calls `set({id})` for the pending bundle.
  - `updatedNote(storage: Storage, current: string): string | null`. It returns `Updated to ${current}` when `.shown` is set and differs from `current`. It always stores `current`. On the first run (`.shown` unset), it stores the version and returns null.
  - CSS in `src/phone/phone.css`: `.live-update-fade body { opacity: 0; transition: opacity 150ms; background: #111113 }`.
  - Settings shows `Version 0.103.2 (app 0.101.0)`, with the shell part only when `getBuiltinVersion()` differs from `__APP_VERSION__` (native only).

- [ ] **Step 1: Write the failing tests** (fake timers, mocked `LiveUpdate`):
  - `switch: applies after 2 s idle on Home`
  - `switch: a touch at 1.9 s restarts the wait`
  - `switch: an open dialog blocks the switch`
  - `switch: a running sync blocks the switch`
  - `switch: leaving Home cancels`
  - `switch: nothing pending, nothing armed`
  - `updatedNote: first run silent, later version shown once`
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-live-update-switch.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook, the note (`toast(note, { duration: 2000 })` in `App.tsx` after the Toaster mounts), the CSS and the Settings line.
- [ ] **Step 4: Run** the tests, then `npm run typecheck:phone`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(phone): switch to a live update on an idle Home visit`

---

### Task 7: APK banner from the Worker

**Files:**
- Modify: `src/phone/updateCheck.ts` (replace the GitHub fetch), `src/phone/UpdateBanner.tsx`
- Test: `tests/renderer/phone-update-banner.test.tsx` (rewrite the `checkForUpdate` cases)

**Interfaces:**
- Consumes: the Task 5 storage key `duelbinder.shellUpdate`.
- Produces: `readShellUpdate(storage: Storage): Update | null`, which replaces `checkForUpdate`. `UPDATE_DISMISSED_KEY` is kept. `UPDATE_CHECKED_KEY` and the GitHub URL are removed. `UpdateBanner` reads from `readShellUpdate` on mount and on a `duelbinder:shell-update` window event that `liveUpdate.ts` dispatches after storing a new value.

- [ ] **Step 1: Rewrite the tests:** `banner: shows stored shellUpdate on the APK build`, `banner: hidden on Play and iOS`, `banner: dismissed version stays hidden`, `banner: appears when liveUpdate stores one later` (dispatch the event).
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-update-banner.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the event dispatch in `liveUpdate.ts`. Keep `@shared/androidRelease` (the site still uses `pickApk`).
- [ ] **Step 4: Run** the banner tests and the live update tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): APK update banner reads the Worker's shell update`

---

### Task 8: CI wiring, keys, deploy

**Files:**
- Modify: `.github/workflows/ios.yml`, `.github/workflows/android.yml`, `src/phone/liveUpdateKey.ts` (real public key)
- Owner/secret steps as noted

**Interfaces:**
- Consumes: the Task 3 CLIs. Secrets `PORTAL_ADMIN_TOKEN` (already exists, see the portal-admin-token memory) and `LIVE_UPDATE_SIGNING_KEY` (new).

- [ ] **Step 1: Key.** Run `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out live-update.pem` in a temp dir outside the repo. Set the GH secret with `gh secret set LIVE_UPDATE_SIGNING_KEY < live-update.pem` (no printing). Ask the owner to save the PEM to 1Password Private as "Duel Binder live update signing key". Export the public JWK into `liveUpdateKey.ts`, then delete the local PEM once the owner confirms it's saved.
- [ ] **Step 2: ios.yml.** After "Build the web files", on tags only, add step `Upload the live bundle`: `node scripts/live-update/publish.ts upload ios out/ios-web "$RUNNER_TEMP/ios-release.json"`. At the end of the job, add `Go live` (`if: "!cancelled() && startsWith(github.ref, 'refs/tags/v') && steps.<upload>.outcome == 'success'"`, so it runs even when the TestFlight upload failed). It waits for `gh release view "$GITHUB_REF_NAME"` (60 × 30 s, same loop as android.yml), then runs `publish.ts release`. If the release never appears, the step fails and nothing goes live. The job also needs `permissions: contents: read` (already set) and `GH_TOKEN`.
- [ ] **Step 3: android.yml.** In "Build the signed APK and Play bundle", right after `npm run build:android` (APK), run `publish.ts upload android-apk out/android-web "$RUNNER_TEMP/apk-release.json"`. After the Play `build:android`, run `publish.ts upload android-play out/android-web "$RUNNER_TEMP/play-release.json"`. Both run on tags only. Add a `Go live` step like iOS for both drafts. In "Attach the APK", after the upload, poll `gh release view --json isDraft -q .isDraft` until `false` (60 × 60 s), then run `publish.ts apk "$NAME" "https://github.com/$GITHUB_REPOSITORY/releases/download/$GITHUB_REF_NAME/Duel-Binder-$NAME.apk"`.
- [ ] **Step 4: Store-release notice.** In each `Go live`, compare the fingerprint with the previous tag's (previous version from `git describe --tags --abbrev=0 HEAD^`, fingerprint from Task 2's admin `GET .../builtins/<version>`). On a difference or a 404, print `::notice::Native shell changed: submit a store release for <platform>`.
- [ ] **Step 5: Deploy the Worker first.** From a fresh worktree run `npm ci`, then `npm run deploy` in `workers/portal` (not bare wrangler). Then `curl -s 'https://app.duelbinder.com/api/app-update?target=ios&builtin=0.0.1&current=0.0.1'`. Expected: `{"version":null}`.
- [ ] **Step 6: Open the PR.** It runs the PR `ios.yml` simulator compile and the `android.yml` debug compile. Expected: both green.
- [ ] **Step 7: Commit** `ci: publish live update bundles on tags`

---

### Task 9: Device rollout (owner, with me driving)

Not code: the spec's Rollout section as a checklist, run after merge.

- [ ] Tag release N (shell with the plugin). Install the APK on the owner's Android phone (`.dev` debug recipe for logs). Run `adb logcat | grep -i capgo` and confirm no `capgo.app` hosts appear.
- [ ] Tag N+1 (web-only change). Open the app, wait on Home: fade, reload, "Updated to N+1". Settings shows `N+1 (app N)`.
- [ ] Rollback check without a tag (a tag would also ship desktop builds): build `build:android` locally with the `notifyAppReady` line removed, and set package.json to an untagged N+2 for the build only. Run `publish.ts upload android-apk` and `publish.ts release` from the owner's machine with the 1Password key. Within 10 s of switching, the app reverts to N+1, and N+2 is never downloaded again. Then withdraw N+2. The next real tag simply overwrites that record.
- [ ] Withdraw N+1 with curl. Next check falls back to N (same schema).
- [ ] Repeat the first two checks on TestFlight on the owner's iPhone.
- [ ] Then submit the shell to both stores (owner).
- [ ] Update the `live-updates` memory with what shipped.
