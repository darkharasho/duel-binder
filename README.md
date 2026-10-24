# yugioh-collection-tracker

A local, offline-first Electron desktop app for cataloging a personal Yu-Gi-Oh! card collection. Users add cards with quantity, set, rarity, and condition, then search and filter them. Card details and images are fetched automatically from the YGOPRODeck API and cached locally. A modern, easy-to-use UI shows collection stats such as total cards and estimated value.

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
