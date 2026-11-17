# Live updates for the phone apps

2026-11-16 · Status: design, awaiting owner approval

## Why

Duel Binder ships several `v*` tags a day (v0.100 in about three weeks). The iOS and Android
store apps are Capacitor shells around `src/phone`, and today every tag rebuilds the whole app
(`ios.yml` → TestFlight, `android.yml` → Play internal + APK). Once the apps are public, every
release would wait on App Store / Play review (about a day each, one Apple review in flight at a
time), so store users would always be one to three releases behind and every phone fix would wait
on a reviewer.

Live updates let the installed shell fetch each release's web code (JS/CSS/assets) itself, so
only native changes go through store review. Both stores allow this for code that runs in the
system web view, as long as updates don't change what the app is.

## Goals

- Every `v*` tag reaches store and APK installs without a store release, unless the native shell
  changed.
- Invisible to users: no prompts and no "restart to update". The switch happens at a safe moment
  (below).
- Never leave a phone on a white screen: a bundle that doesn't start rolls back by itself, and the
  owner can withdraw a bad release remotely.
- Only download the files that changed.
- Self-hosted on our Worker and R2, with no third-party service and no usage data sent to anyone.

## Non-goals

- Tester or staged channels (everyone gets the latest compatible bundle). Can be added later.
- Updating native code (Swift/Java plugins, Capacitor upgrades, permissions, icons): that still
  needs a store release.
- The web / home-screen app at app.duelbinder.com, which already updates through its service
  worker (`src/phone/sw.ts`).
- An admin UI. Withdrawing a release is a curl with the admin token for now.

## Anti-goals (failure even if it "works")

- A reload in the middle of a scanning session, a sheet, or an unsaved add.
- A bundle running on a shell whose native plugins it doesn't match (crashes in Stream, WebAuth
  or BackButton calls).
- Losing local data on switch (OPFS catalog, saved scans, localStorage, sign-in token).
- Sending device or usage data to Capgo (the plugin does this by default).

## Approaches considered

- **A. Our own native updater** (Swift + Java download/swap/rollback). Diffs could be exactly what
  we want and there's no dependency, but we'd be writing the riskiest code for iOS on a Linux
  machine that can't build or run iOS. A rollback bug means white screens with no remote fix.
  *Rejected.*
- **B. `@capgo/capacitor-updater` (open source, plugin major = Capacitor major, so v8) in manual
  mode, served from our Worker + R2.** It already does download, checksum, swap, the
  `notifyAppReady` rollback and multi-file (per-file) downloads from our URLs. *Chosen by the
  owner.*
- **C. Capgo Cloud / Ionic Appflow.** A paid service for what R2 does free; Appflow is being wound
  down. *Rejected.*

## Decided with the owner

- Approach B.
- Updates are invisible. Download in the background; switch on the next cold start **or** on a
  visit to Home when the app is idle (below).
- A short "Updated to 0.101.0" note after a switch, which the owner may turn off.

## Calls made while writing this (owner can override)

- **Three bundle targets, not two:** `ios`, `android-apk`, `android-play`. `android.yml` already
  builds the Android web code twice per tag (APK, then `ANDROID_CHANNEL=play`), and only the APK
  build shows the shell-update banner, which Play forbids. Each target gets its own bundle and
  release records. Both Android targets share one native fingerprint.
- **Live only after tests pass.** Today a tag with failing tests only reaches testers. With live
  updates it would reach every store user, so the release record (the thing that makes a bundle
  "latest") is only PUT once `release.yml`'s `test` job for that tag has succeeded. Files can
  upload earlier. This costs about 10–15 minutes per release.
- **No going back across a schema change.** The phone database migrates forward only
  (`PRAGMA user_version`, `src/main/db/schema.ts`). Each release record stores its schema
  version, and a withdrawal only falls back to an older release with the **same** schema version.
  Otherwise there's no fallback and the fix has to go forward as a new tag. The plugin's automatic
  rollback to the built-in bundle can't be stopped from crossing a schema change. That's
  accepted, because the 48 migrations so far are additive (`ADD` columns, or table rebuilds that
  keep the name), so older code keeps working on a newer database. **Rule from now on:**
  migrations stay additive, with no dropped or renamed columns that older code reads.
- **The Worker owns the APK shell check.** `/app-update` answers `shellUpdate: { version, url }`
  for `android-apk` when a newer APK exists with a different fingerprint than the phone's shell.
  `updateCheck.ts` stops asking GitHub. "An APK exists" is recorded by the `android.yml` step that
  attaches the APK (only when `vars.ANDROID_RELEASE == 'true'`). It compares against the shell's
  built-in version, never `__APP_VERSION__` (which becomes the live bundle's version).

## Design

### 1. The shell (one store release)

- Add `@capgo/capacitor-updater` v8 to the iOS and Android shells. Configure in
  `capacitor.config.ts`:
  - `autoUpdate: false` (we drive it from JS)
  - `statsUrl: ''`, `channelUrl: ''` and `updateUrl` unused, so **nothing goes to Capgo**. The
    builder should confirm in the plugin source that empty strings disable each call.
  - `appReadyTimeout`: about 10 s (default). The phone app's first paint on a cold start with a
    big catalog must call `notifyAppReady` well before that; see section 3.
  - `resetWhenUpdate: true` (default), so a new store shell drops old live bundles and starts from
    its own built-in one.
  - `publicKey`: our RSA public key, so download checksums must be signed by our private key (see
    Security).
- Memory note: `@capacitor/app` was avoided on iOS because it adds itself to SPM. Check that this
  plugin's iOS install path (SPM vs CocoaPods) works with `ios.yml` before relying on it.
- This shell must ship through TestFlight/Play once before any live update can reach anyone.

### 2. Shell compatibility ("native fingerprint")

A bundle is only offered to shells with the **same native fingerprint**. CI computes it on every
tag, with no manual bumping:

- sha256 over the native sources (`ios/App/App/*.swift`, the Android `java/` plugins,
  `AndroidManifest.xml`, `Info.plist`, entitlements) plus the resolved versions of every
  `@capacitor/*` and `@capgo/*` package in `package-lock.json`.
- Per platform (iOS and Android fingerprints are separate; both Android targets share one).
- The tag's built-in bundle and its live bundle carry the same fingerprint. The phone reports its
  shell's **built-in version** (`CapacitorUpdater.getBuiltinVersion()` → e.g. `0.101.0`), and the
  Worker maps it to that release's fingerprint (stored at upload). The app never has to know its
  own fingerprint.
- Any native change cuts live updates for older shells until the store update installs. That's
  the safe direction. CI prints a notice on tags whose fingerprint changed: "native shell changed:
  submit a store release".

### 3. In the app (`src/phone`)

A new `liveUpdate.ts`, active only when `APP_PLATFORM` is `ios` or `android` (both APK and Play
channels):

- **Ready signal:** call `CapacitorUpdater.notifyAppReady()` first thing in `main.tsx`, before
  the catalog opens or any network request.
- **Check:** at launch and when the app returns to the foreground (at most once per 10 min), ask
  `GET /app-update?target=<ios|android-apk|android-play>&builtin=<builtinVersion>&current=<runningVersion>`.
- **Download:** if a newer version is offered, `CapacitorUpdater.download({ version, manifest,
  checksum })` in the background. Keep one pending bundle only; a newer offer replaces it.
  Failures are silent and retried on the next check.
- **Switch:** with a bundle downloaded, switch via `CapacitorUpdater.set({ id })` when either:
  - **cold start:** `next({ id })` is set as soon as the download finishes, so the plugin uses it
    on the next launch even if the app never reaches the Home switch; or
  - **Home, idle:** the current page is `dashboard`, and for about 2 s there's been no touch, no
    sheet/picker open, no scan saving or uploading (saved-scans queue empty), and no sync in
    flight. Leaving Home cancels the timer.
- **Hiding the reload:** before `set`, fade the screen to the app background (`#111113`) for
  about 150 ms. After the reload, if the running version differs from the last one shown, show
  "Updated to X" for about 2 s, then store the version.
- **Version display:** Settings shows the running bundle version and, when it differs, the shell
  version (e.g. "0.103.2 (app 0.101.0)") so bug reports say what's really running.
- The existing APK UpdateBanner still offers new **shell** APKs, driven by `shellUpdate` from
  `/app-update` (see Calls made). Otherwise the live bundle already brings it up to date.

### 4. Worker (`workers/portal`)

- **`GET /app-update`** (public, CORS for the app origins like the rest of the app API, edge
  cached for about 60 s per query): finds the latest **non-withdrawn** release for the target
  whose fingerprint matches the one recorded for `builtin`. It returns `{ version, checksum,
  manifest: [{ file_name, file_hash, download_url }] }` if that's newer than `current`, else
  `{ version: null }`. If `current` was withdrawn, it returns the newest good release even if
  older, but only one with the same schema version (this is how a bad release gets pulled back).
- **`GET /app-bundles/<target>/files/<sha256>`**: serves files from R2 (`IMAGES` bucket, prefix
  `app-bundles/`), immutable, long edge cache, content-addressed, so unchanged files are never
  re-downloaded or re-uploaded.
- **Admin (admin token, like catalog snapshots):**
  - `PUT /admin/app-bundles/<target>/files/<sha256>` uploads a file (the Worker checks the hash).
  - `PUT /admin/app-bundles/<target>/releases/<version>` stores the release record: version,
    fingerprint, schema version, manifest, signed checksum, `apk` flag (android-apk), created time.
  - `POST /admin/app-bundles/<target>/releases/<version>/withdraw` (and `restore`).
- Release records: small JSON in R2 (`app-bundles/<target>/releases/<version>.json`) plus an
  index object, or a DO table. Builder's call; R2 JSON keeps it off the shared DO, which has been
  a bottleneck ([[web-app-slowness]]).
- Request counts by version go through the existing usage metering if it's cheap; otherwise skip.
- Order: **the Worker deploys before the first tag that uploads bundles** (the usual
  "deploy portal before tag" rule).

### 5. CI (`ios.yml`, `android.yml`)

After each web build on a `v*` tag (`build:ios`; and in `android.yml` after **each** of the APK
and Play builds, before the next build overwrites `out/android-web`):

1. Compute the native fingerprint.
2. For each file in `out/<target>-web`: sha256, HEAD the Worker, and upload if missing.
3. Build the manifest and sign the checksum with the private key (GH secret).
4. Wait for `release.yml`'s `test` job on this tag to succeed (`gh run` poll, with a timeout; on
   failure, publish nothing), then PUT the release record.
5. If the fingerprint differs from the previous release's, print the "submit a store release"
   notice.

This runs even when the TestFlight/Play upload fails, like the APK attach step does today.
Keeping the per-tag TestFlight/Play internal uploads as they are now is fine. Store **submission**
for review stays a manual owner step, needed only when the fingerprint changed.

### Security

- Only CI (admin token) can publish. Files are content-addressed and the Worker checks each hash
  on upload.
- The plugin verifies the bundle checksum signed with our RSA private key (`publicKey` in the
  shell config), so even a compromised Worker or R2 can't push code without the signing key.
  **Builder must confirm** how signing applies in manifest (multi-file) mode. If per-file hashes
  aren't covered by the signed checksum, sign the manifest ourselves and have `liveUpdate.ts`
  verify it (WebCrypto) before calling `download`, or use zip mode for that release.
- The signing key is a GH secret, with a backup in 1Password Private like the Android keystore.
  Losing it means shipping a store shell with a new public key.

### Rollout

1. Worker routes deployed; CI starts uploading bundles on tags (harmless with no shell using it).
2. A shell release with the plugin is checked on the owner's Android phone first (debug `.dev`
   recipe): tag twice, see Home switch, see rollback with a deliberately broken bundle
   (`notifyAppReady` never called), and withdraw a release.
3. Then TestFlight on iPhone with the same checks.
4. Then the shell goes to the stores; from then on most tags ship live.

## Left to the builder

- Exact R2 vs DO storage for release records.
- How "sheet open", "scan saving" and "sync in flight" are read in `src/phone` (existing state in
  `PhoneShell`, `savedScans`, `syncTriggers`).
- Whether the per-file download reuses files already in the built-in bundle (if not, the first
  live update downloads everything, about 33 MB uncompressed; check whether serving with gzip
  helps).
- The fade and toast styling, within the app's existing look.
- Tests: Worker route tests (compatibility match, withdrawal fallback, hash check); unit tests
  for the idle-switch guard with the plugin mocked. No device automation.
