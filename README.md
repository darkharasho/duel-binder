# yugioh-collection-tracker

A local, offline-first Electron desktop app for cataloging a personal Yu-Gi-Oh! card collection. Users add cards with quantity, set, and rarity, then search and filter them. Card details and images are fetched automatically from the YGOPRODeck API and cached locally. A modern, easy-to-use UI shows collection stats such as total cards and estimated value.

Card data and images come from [YGOPRODeck](https://ygoprodeck.com). This project is not affiliated with or endorsed by Konami; Yu-Gi-Oh! is a trademark of Konami.

## Install notes

Release builds are not code-signed by a paid certificate, so the OS warns on first launch:

- **macOS:** the app is ad-hoc signed. Right-click the app and choose Open, or go to System Settings → Privacy & Security and click Open Anyway. Alternatively run `xattr -dr com.apple.quarantine "/Applications/Yugioh Collection Tracker.app"`. The mac build does not auto-update; it shows a notice with a link to the new release.
- **Windows:** SmartScreen may say "Windows protected your PC". Click More info → Run anyway.

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

macOS signing is optional. Set the repo secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to sign and notarize. Without them the mac build is ad-hoc signed and the app shows a download notice instead of auto-installing updates.
