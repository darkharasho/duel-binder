# Duel Binder

A local, offline-first Electron desktop app for cataloging a personal Yu-Gi-Oh! and Pokémon card collection. Users add cards with quantity, set, and rarity, then search and filter them. Card details and images are fetched automatically from the YGOPRODeck API and cached locally. A modern, easy-to-use UI shows collection stats such as total cards and estimated value.

Card data and images come from [YGOPRODeck](https://ygoprodeck.com). This project is not affiliated with or endorsed by Konami; Yu-Gi-Oh! is a trademark of Konami.

Pokémon card data comes from [TCGdex](https://tcgdex.dev). This project is not affiliated with or endorsed by The Pokémon Company, Nintendo, Creatures or GAME FREAK, who own Pokémon.

## Install notes

Release builds are not code-signed by a paid certificate, so the OS warns on first launch:

- **macOS:** the app is ad-hoc signed. Right-click the app and choose Open, or go to System Settings → Privacy & Security and click Open Anyway. Alternatively run `xattr -dr com.apple.quarantine "/Applications/Duel Binder.app"`. The mac build does not auto-update; it shows a notice with a link to the new release.
- **Windows:** the installer is signed (Azure Artifact Signing, publisher Michael Stephens). Older unsigned releases may make SmartScreen say "Windows protected your PC"; click More info → Run anyway.

## Run

```sh
npm install
npm run dev
```

## Test

```sh
npm run typecheck
npm test
```

## Build

`npm run build:linux`, `npm run build:win` or `npm run build:mac` builds an installer for that OS into `dist/` (build on the target OS).

## Release

1. Bump `version` in `package.json`.
2. Commit, then tag `vX.Y.Z` (it must match `package.json`) and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The `Release` workflow tests, then builds Linux (AppImage), Windows (NSIS) and macOS (dmg + zip, universal) and publishes them to a GitHub release along with the `latest*.yml` update feeds.

Windows signing is required: the Windows build signs the installer and `duel-binder.exe` with Azure Artifact Signing (`win.azureSignOptions` in `electron-builder.yml`: account `darkharasho-signing`, profile `public-trust`). It needs the repo secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (set them with `~/.claude/templates/windows-signing/set-azure-signing-secrets.sh duel-binder`), and fails if the installer's signature isn't valid.

macOS signing is optional. Set the repo secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to sign and notarize. Without them the mac build is ad-hoc signed and the app shows a download notice instead of auto-installing updates.

## Android app

The phone app (`src/phone`) in a Capacitor shell (`android/`), like the iOS app (`ios/`).

- Build: `npm run build:android`, then `cd android && ./gradlew assembleDebug` (JDK 21 and the Android SDK; `android/local.properties` points at the SDK).
- Signing: one release key, `~/.android-keys/duel-binder-release.jks` with its passwords in `duel-binder-release.txt` next to it. Keep an offline copy, never replace it: installed APKs (and Google Play, which is set up with this same key) only accept updates signed by it. Certificate SHA-256 `C2:CD:AD:90:43:3C:DC:AB:D5:E5:B8:5F:45:90:F6:E4:E1:81:63:37:41:E7:0A:1E:D4:72:26:1A:4F:FB:38:07`.
- CI: the `Android` workflow builds the signed APK and Play bundle on each `v*` tag (and on a manual run) as artifacts. It attaches `Duel-Binder-<version>.apk` to the release only when the repo variable `ANDROID_RELEASE` is `true`; duelbinder.com and the app's update banner offer the APK once a release has it.
