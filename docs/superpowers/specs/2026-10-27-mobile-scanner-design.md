# Mobile scanner design

## Why

Scanning cards is the part of Duel Binder that most wants a phone: opening packs, and going
through a binder at a friend's place or a shop. Today the scanner only runs in the desktop app.
A throwaway spike (2026-10-27, outside the repo) ran the desktop vision worker unchanged in
iPhone Safari and it worked: card outlines, art matches and set-code reads, at usable speed.

## What it is

Duel Binder on a phone, for every Duel Binder user, not just the owner. The owner's call
(2026-10-27): it's the full app, not just the camera. Dashboard, collection, browse, sets,
friends and settings are all there, at the very least as working pages in a phone shell, and
ideally laid out properly for a phone. The scanner is the reason it exists and gets the most
care. It works like the desktop scan window: point the camera at cards, they build up in a
list, you check each one (fix the printing or rarity if needed), then add them to your
collection. Nothing is added without you confirming it.

It ships two ways from one codebase, in this order (the owner's call):

1. **Phase 1: home-screen web app** at app.duelbinder.com. Free, no store; updated by every
   portal deploy. This ships first and on its own.
2. **Phase 2: store apps** for iPhone (TestFlight, then the App Store) and Android (an
   installable build now; Google Play once the owner opens a Play account), made with Capacitor
   and built by GitHub Actions. App ID `com.duelbinder.app` on both platforms, name "Duel
   Binder" (the owner's call; the ID can never change after the first upload). Phase 2 adds Sign
   in with Apple (see Store rules).

Phase 1 is built so phase 2 only wraps it: same build output, no web-only shortcuts in the
scanner, sync or storage code.

## Goals

- Scan with the phone camera and get the same results the desktop scanner gives: art match,
  set-code and name reads, rarity, language, printing choice and price.
- Review the scanned list and add the cards to your collection, as on desktop.
- The rest of the app on the phone: dashboard, collection (view, edit, remove), browse, set
  checklists, friends' binders and settings. These read the phone's own copy of the data, so
  everything but friends works offline. Edits sync like adds.
- **Works with no signal.** The phone keeps its own copy of the card data and recognition
  files. Cards added offline wait on the phone and sync to the account, and on to the desktop
  app, when it's back online. Nothing added offline is ever lost silently.
- Sign in with the Duel Binder account the portal and sync already use.
- Both ways of getting it (web app and store apps) come from the same code and the same build.
- Android and iPhone builds made by GitHub Actions without a paid build service.

## Non-goals

- Features the desktop doesn't have (wishlists, decks and so on).
- Desktop-only settings on the phone: updates, data folder, backups, image cache.
- Printing-specific scans (the Yugipedia photo of an exact printing) on the phone in phase 1.
  The phone's local printing ids differ from the server's, so phone cards show the card's
  default art. My call; it can come later.
- A condition field. The data model has none and desktop scanning doesn't set one.
- Automatic store submission. CI uploads builds to TestFlight (and later Play's internal
  track); sending a version for review and releasing it stays a manual step for the owner.
- Changing how the desktop scanner behaves.

## Anti-goals (a failure even if it technically works)

- Cards added to the collection without the user reviewing them.
- Adds made offline that disappear, duplicate, or land on the wrong printing after sync.
- A store app that is just a wrapper around the website and doesn't work offline (Apple
  rejects these, and it misses the point).
- Breaking or slowing the desktop scanner while sharing its code.

## Constraints

- **Shared code.** The scanner lives in `src/renderer/src/features/scan/` (engine, resolve,
  tracker, session, vision worker on OpenCV.js) and `src/shared/scan/`. `createScanEngine`
  already takes an injected `api: Api['scan']` and `makeWorker`. The phone supplies its own
  `Api['scan']`; the scan logic itself is not forked.
- **The phone's `Api['scan']`** must answer the same calls the desktop main process answers
  (`src/shared/ipc.ts`): `printingsByCode`, `printingsForSet`, `printingsForCards`, `matchName`,
  `cardsForImages`, `fingerprints`, `refreshFingerprints`, `ocr`, `language`, from data on the
  phone, without the network.
- **Card data on the phone.** The desktop's scan queries (`src/main/repo/scan.ts`) run on the
  `SqlDb` abstraction. My call: the phone holds the scan-relevant catalog tables in SQLite
  compiled to WASM (the official `@sqlite.org/sqlite-wasm` on OPFS, or wa-sqlite if OPFS proves
  unreliable in iOS WKWebView), so those queries run unchanged. Filled from the existing
  `GET /api/catalog/changes` feed, limited to the tables scanning needs (at least cards,
  card_images, card_printings and sets) and applied with the existing shared catalog upsert.
  The builder picks the exact table list from what the scan queries read.
- **Prices.** `scan.ts` reads `market_price`/`set_price` on card_printings and an `intl_prices`
  table. intl_prices isn't in the catalog feed. The phone shows the last price it knows and
  refreshes when online (via `POST /api/sync/prices` or by adding intl prices to the feed;
  builder's choice). Offline prices may be stale; that's acceptable.
- **Recognition files.** Fingerprints come from the public `GET /scan/fingerprints` (ETag),
  cached on the phone and refreshed when online, as desktop does.
- **Text reading.** tesseract.js in a Web Worker on the phone, with the same languages desktop
  ships (eng, jpn, kor, chi_sim). Models are served from the app's own files (not a CDN) and
  bundled in the store apps; the web app downloads the non-English ones the first time they're
  needed and keeps them.
- **Adding cards.** Adds go into a queue on the phone with a client-made uid and the printing's
  `pkey`, and are sent with `POST /api/sync/push`, which already handles retries, conflicts and
  printings the server doesn't know yet. The queue survives the app being closed or killed. The
  phone shows how many adds are waiting to sync.
- **Sign-in.** Only Discord sign-in exists today (`workers/portal/src/auth.ts`). `/api/sync/*`
  and `/api/catalog/*` accept only Bearer (desktop-kind) tokens. So the phone uses a Bearer
  token too:
  - Web app: it's same-origin and the user already has a session cookie; a new same-origin
    endpoint exchanges the session for a device token.
  - Store apps: sign-in opens Discord in the system browser (ASWebAuthenticationSession on
    iPhone, Custom Tabs on Android). The callback returns to the app with a one-time code that
    the app exchanges with its verifier, like the desktop's loopback flow but with an app link
    (universal link / Android app link on app.duelbinder.com) instead of 127.0.0.1.
  - Tokens are revocable one at a time, as desktop tokens are.
- **Cross-origin calls from the store apps.** The bundled app's origin is `capacitor://localhost`
  (iOS) / `https://localhost` (Android). The portal sends no CORS headers today. My call: add
  CORS for exactly those two origins on the API routes the phone uses, Bearer only, no
  cookies, with OPTIONS preflight handling.
- **Content Security Policy.** The web app's CSP needs `'wasm-unsafe-eval'` and `worker-src`
  for OpenCV, SQLite and tesseract. Widen it only for the scanner's page if that's practical.
- **Camera.** getUserMedia, rear camera, as the spike did. Torch where the browser supports it
  (Android Chrome). On iPhone Safari and WKWebView the torch isn't exposed to the page; a
  native torch plugin in the store app is worth trying but is not required. If iOS can't drive
  the torch while the web view owns the camera, iPhone simply has no torch button.
- **Store rules** the design must meet:
  - Camera permission text (iOS `NSCameraUsageDescription`, Android `CAMERA`).
  - A privacy policy page at duelbinder.com/privacy, linked from the app and both store listings.
  - Apple 5.1.1(v): an app that lets people create an account must let them delete it from
    inside the app. The portal has no account deletion today; it gets one in phase 1, in the
    phone's Settings and on the web portal. Deleting removes everything on the server (the
    owner's call): the account, its synced collection, every device's sign-in token and session,
    and its friend links and requests. A desktop app keeps its local copy and is signed out.
    It asks for confirmation first.
  - Apple 4.8: an app that signs in only through a third-party service (Discord) must also offer
    Sign in with Apple or an equivalent privacy-focused option. The owner chose to ship the
    web app first and do iPhone after, so this lands in phase 2: Sign in with Apple is added
    alongside Discord. How an Apple sign-in reaches an existing Discord account (for example,
    linking Apple from Settings while signed in with Discord) is decided when phase 2 is
    planned.
  - Apple 4.2: the app must be useful beyond a web wrapper; the offline scanner covers this.
- **Builds (phase 2).** A GitHub Actions workflow builds the store apps:
  - Android on ubuntu: a signed APK (for installing directly) and an AAB (for Play later),
    attached to the release. Signing key from repo secrets.
  - iPhone on macos-latest: built, signed and uploaded to TestFlight. Signing via App Store
    Connect API key and certificate/profile secrets (fastlane or plain xcodebuild; builder's
    choice). The repo has no Apple secrets saved yet; the owner adds them.
  - The workflow skips a platform whose secrets are missing, with a warning, rather than failing.
  - Play upload is added once the Play account exists (note: new personal Play accounts need a
    closed test with 12 testers for 14 days before going public).
- **Portal deploy stays manual** (`cd workers/portal && npm run deploy`). The web app ships with
  it.
- **Version.** Store apps take the version from `package.json`, built on the same `v*` tags as
  desktop (my call; a separate tag can come later if the cadences diverge). iOS build numbers
  must always rise; derive them from the CI run number.
- Project notes (`CLAUDE.md`) drop "Mobile version" from Out of scope.

## The phone screen

My call, to be refined when we see it:

- A bottom tab bar: Home (dashboard), Collection, Scan (in the middle), Sets, and More (Browse,
  Friends, Settings). The desktop pages are reused. Phone layouts are added only below the
  desktop window's minimum width, so the desktop app looks the same. Side panels (entry
  details, a set's card panel) become full-screen sheets on a phone, and the add-card dialog
  becomes full-screen.

- Signed out: a sign-in screen.
- Signed in, first run: a progress screen while the card data and recognition files download
  (with their size), then the scanner. Scanning needs that data, so first run needs a
  connection.
- Scanner: the camera fills the top of the screen with the card outline drawn on it, as
  desktop does. The scanned list sits in a sheet below that can be dragged up for review.
  Rows reuse the desktop row (`ScanRowItem`, `SessionList`) in a phone layout: name, set code,
  rarity and printing picker, price, quantity. "Add to collection" and "Clear" as on desktop.
- A small status line: offline / syncing / N waiting to sync; and card data age.
- Settings: sign out, delete account, refresh card data, privacy policy link.

## Calls made after the builder check

Marked as my calls; the owner can overrule any of them.

- **Adding a card you already own.** Desktop's add raises the quantity of the existing entry.
  The phone does the same: it also pulls the user's collection entries (`GET /api/sync/pull`,
  small) and keeps them up to date, so an add (online or offline) raises the existing entry's
  quantity under that entry's uid, or makes a new entry with a new uid. Each queued add is
  applied once (it rewrites the entry with its new quantity and edit time), so retrying a push
  can't double it. The rare case of the desktop and phone both changing the same entry while
  apart resolves as sync does today (later edit wins). Pushes that come back `rejected`,
  `merged` or `stale` are shown to the user in a "sync problems" list, like desktop's
  sync issues.
- **Shared code.** Small refactors of the desktop scanner (moving pure logic out of
  `src/main/scan/*`, such as name matching and language detection, into `src/shared/scan/` so
  both use it; removing Electron-only imports from row components) are fine when desktop
  behavior and its tests stay the same. The phone runs the same code against the same test
  fixtures, never a copy.
- **Download size.** Measure the first-run download (scan tables, fingerprints, English text
  model) early in the build. Download it in resumable chunks, show the size beforehand, and warn
  when on cellular. Non-English text models download only when first needed. If the total goes
  past about 100 MB, trim the table and column set before shipping.
- **Cold start.** If paging `GET /api/catalog/changes?since=0` is too slow for a first run, add a
  compressed snapshot of the scan tables (built by the nightly job, like the fingerprints) and
  use the feed only for updates afterwards.
- **Versions and old installs.** The phone's local database and queue carry a format version.
  When the card data format changes, it's re-downloaded. The queue is migrated, never dropped.
  Installed store apps can't update instantly, so API changes the phone uses are additive only.
- **The iPhone home-screen web app is best effort offline.** Safari can clear a site's storage
  after about a week of non-use. The web app syncs queued adds as soon as it's online and warns
  while adds are waiting. The store app is the dependable offline path.
- **Builds on every `v*` tag**, including desktop-only releases. Extra TestFlight builds are
  harmless.

## Left to the builder

- How the phone page is built and served: a separate Vite entry beside `web.html` is likely, at
  a path like app.duelbinder.com/scan, with its own manifest, icons and service worker. The same
  build output is what Capacitor bundles.
- Exact catalog tables, the endpoint shape for the session-to-token exchange, the app link
  setup, and how the delete-account confirmation looks.
- Storage limits: ask the browser for persistent storage; handle iOS evicting web-app data by
  re-downloading, never by losing queued adds silently (if storage is lost, the queue is lost,
  so warn when persistence isn't granted).
- Performance tuning on phones (frame size, how often to read text).
