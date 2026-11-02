# Android app — design

Date: 2026-11-02. Project 1 of 3 (Android app → account linking → Google sign-in).

## Why

Android users are asking for Duel Binder on their phones. Today they only have the home-screen web app at app.duelbinder.com/scan/. iPhone users have the App Store app (a Capacitor shell around `src/phone`); Android users should get the same app.

## What it is

The phone app (`src/phone`) inside a Capacitor Android shell, the same way `ios/` wraps it. Same features as the iOS app: scan (both games), Stream mode, collection, Rip, binders, friends, settings. One codebase: a fix to the phone app reaches web, iOS and Android together.

Distributed two ways, from the same code and the **same signing key** so a user can move from one to the other without reinstalling:

1. **APK** (first): a signed release APK attached to every GitHub release (`v*` tag) and linked from duelbinder.com. Ships as soon as it works, no review wait.
2. **Google Play** (second): the owner's Play developer account is not yet identity-verified. Verification, the store listing and (for a personal account) Google's 12-tester / 14-day closed test are owner tasks that run in parallel; the build side only has to produce a Play-ready bundle (AAB).

## Goals

- Android app with feature parity with the iOS app, minus Sign in with Apple (see non-goals).
- Discord sign-in works natively: Custom Tab to `/auth/desktop/start?app=android`, PKCE, back into the app by deep link, Bearer token stored like iOS.
- Signed APK on each GitHub release, built by GitHub Actions on `v*` tags; AAB built alongside.
- APK users are told when a newer version exists (the APK can't update itself).
- duelbinder.com offers the APK to Android visitors.
- Admin usage stats count Android separately from iOS and the web scanner.

## Non-goals (this project)

- Google sign-in and account linking — projects 2 and 3. Discord is the only sign-in on Android for now.
- Sign in with Apple on Android. The button is hidden. An Apple-only user can't sign in on Android until account linking ships; accepted for now.
- Automated upload to Google Play. The AAB is a CI artifact; the owner uploads it by hand until the account is verified and the closed test is under way. Automating upload is a later step.
- Tablets, Android TV, Chromebooks. Phone, portrait — except during a stream, which may rotate to landscape, like iOS.
- Desktop or iOS changes beyond what sharing code requires.

## Anti-goals (would make it a failure even if it works)

- Android pretending to be iOS: usage stats saying `ios`, iOS wording, an Apple button that can't work.
- Content under the status bar or the gesture/navigation bar (Android 15+ forces edge-to-edge).
- The Android back button exiting the app from inside a sheet or a sub-screen.
- The APK and Play builds signed with different keys, stranding APK users.
- Breaking the iOS app or the web scanner.

## Decided

- **Capacitor Android platform** next to `ios/`, `@capacitor/android` at the same version as `@capacitor/ios` (8.5.x). App id `com.darkharasho.duelbinder`, name "Duel Binder", background `#111113`.
- **Platform is a real value, not "native = iOS".** Today every native branch keys off `isNativeApp()` (`VITE_PORTAL_ORIGIN` non-empty) and assumes iOS (e.g. `src/phone/api.ts:311` and `:315` report `'ios'` for usage and errors, `SignIn.tsx` shows the Apple button, `src/phone/stream/device.ts` calls the iOS `Stream` plugin). Add a platform notion (`web` / `ios` / `android`) and branch on it where behaviour differs: usage platform, Apple button, sign-in plugin, update check.
- **Sign-in:** Worker accepts `app=android` wherever it accepts `app=ios` (`workers/portal/src/auth.ts` start + cookie format), returning to `duelbinder://auth/callback`. The app registers the `duelbinder` scheme with an intent filter and opens the start URL in a Custom Tab. A small local Android plugin exposing the same `WebAuth.start({url, callbackScheme})` contract as `ios/App/App/WebAuthPlugin.swift` is the preferred shape, so `src/phone/nativeSignIn.ts` stays one code path. Cancel (user closes the tab) rejects with `CANCELLED` like iOS.
- **CORS:** `workers/portal/src/appCors.ts` allows the Android app's origin (Capacitor default `https://localhost`; the update check reads GitHub's latest-release API directly — the app has no CSP of its own, only the portal-served page does) in addition to `capacitor://localhost`, Bearer-only and never with credentials, same routes. The Worker deploy goes out before the first APK.
- **Usage platform:** add `'android'` to the allowed values for usage and error reports (`src/shared/usage.ts`, `workers/portal/src/adminPage.ts`, wherever error reports validate platform) and show it on the admin dashboard.
- **Stream mode:** an Android `Stream` plugin with the same `enter()` / `exit()` contract as `ios/App/App/StreamPlugin.swift`: `enter` unlocks rotation (not upside down) and keeps the screen on; `exit` (also called at start) goes back to portrait and lets the screen sleep. Rotating must not restart the activity or reload the WebView (handle the configuration change), and insets must hold in landscape. *(Builder-check call: parity includes Stream.)*
- **Back button:** closes the open sheet/dialog if any, else goes back one screen, else leaves the app (Android default).
- **Camera:** `CAMERA` permission in the manifest; the existing `getUserMedia` path is used unchanged. If the user denies, the existing camera-error UI shows.
- **Update check (APK builds only):** on launch (at most once a day) compare the app version with the latest GitHub release of `darkharasho/duel-binder`; if newer, show a dismissible banner linking to the release's APK. Play builds skip it (Play updates them). How the build tells APK from Play is the builder's call (build flag or install-source check).
- **Signing:** one release key, generated once **on this machine** with `keytool` (owner's decision), RSA, long validity. The keystore lives outside the repo at `~/.android-keys/duel-binder-release.jks` (my call) with its passwords alongside; it is never committed. CI gets it as GitHub Actions secrets (keystore base64, store password, key alias, key password), set with `gh secret set` without printing values. The owner copies the keystore and passwords to an offline backup — losing it means APK users can never update. When the Play account is set up, enrol in Play App Signing **with this same key** (upload your own app signing key), not a Google-generated one, so APK installs can update from Play.
- **Versioning:** `versionName` = package.json version; `versionCode` must always increase across APK and Play builds (e.g. derived from the semver, or the CI run number as iOS does — builder's call, but it must be monotonic for both channels).
- **CI:** a workflow like `.github/workflows/ios.yml` (`ubuntu-latest`): on PRs touching Android/Capacitor/phone-build files, an unsigned debug build as a compile check; on `v*` tags with secrets, a signed release APK and AAB. The APK is attached to the GitHub release that `release.yml` creates (name it e.g. `Duel-Binder-<version>.apk`); the AAB is uploaded as a workflow artifact.
- **Website:** `workers/portal/src/site/` gets an Android download — the hero button for Android user agents (today `os.ts` returns null for Android) and a row in the download table — pointing at the latest release's APK, with a short "allow installs from this source" note.

## Testing

- Unit tests (vitest, `--maxWorkers=2`) for the platform helper, update-check version compare, Worker `app=android` and CORS origin.
- The builder can run the app on an Android emulator on this Linux machine: sign-in round trip, navigation, back button, insets, collection and sync.
- Camera scanning and Stream rotation need a real phone. The first signed APK comes from a manual (`workflow_dispatch`) run as a workflow artifact; the owner sideloads it and checks the camera. Only after that do `v*` tags attach the APK to GitHub releases and the website link go live — a repo variable or similar switch, off until then. *(Builder-check call.)*

## Left to the builder

- Build output layout (`--mode android`, separate `out/android-web`, or a shared app build), `minSdk`/`targetSdk` (Capacitor 8 defaults; targetSdk must meet Play's current requirement).
- How insets reach the page (Capacitor's system-bars/edge-to-edge handling or native padding) as long as the anti-goal above holds.
- App icon and splash from the existing icon assets.
- Exact back-button wiring, update-check banner placement and copy.
- Whether the Android plugin is a local plugin in `android/` (like iOS) or a small package.

## Owner tasks (not code)

- Finish Google Play identity verification; create the app listing; recruit 12 closed testers if the account is personal.
- Copy `~/.android-keys/duel-binder-release.jks` and its passwords to an offline backup once it is generated.
- Test camera scanning on a real Android phone.
