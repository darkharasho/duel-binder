# Duel Binder: marketing site and logo

## Intent

Duel Binder needs a front door and a face. The front door is a page at
`duelbinder.com` that a friend can land on to see what the app does, see what
it looks like, and download it. Signed-in use moves to `app.duelbinder.com`,
the same split Dex uses (`dextcg.com` / `app.dextcg.com`). The face is a new
logo that holds up as a square app icon, a Discord avatar (cropped to a
circle), and a 16 px browser-tab icon, plus a proper "Duel Binder" wordmark.

The owner's reference for the site is https://dextcg.com/. Their direction
after the first mockup was "make it less AI-sloppy and implement much closer
to our in-app theme". The approved mockup follows the app's look closely.

## Goals

- `duelbinder.com` explains the app in one screen, shows real screenshots,
  and offers a download for Windows, macOS and Linux.
- `app.duelbinder.com` hosts everything that needs an account: Discord
  sign-in, the API, and later the web app.
- A new logo used everywhere: the desktop app (window, installer, sidebar),
  the site, the favicon, and the Discord application.

## Non-goals

- Pricing, reviews, testimonials, creator quotes, a blog or a newsletter.
  The audience is the owner and a circle of friends.
- Analytics, cookie banners or tracking of any kind.
- A new desktop release. Shipping the new icon in installers happens at the
  next release, which the owner triggers.

## Anti-goals

The site fails if it looks generic or AI-made, even when everything works.
In particular, avoid:

- glowing radial gradients and gradient-filled headline text;
- small uppercase eyebrow labels over headlines;
- centered "call to action" bands;
- emoji or icon-studded buttons;
- placeholder or illustrated screenshots.

It must read as the same product as the desktop app.

## Decisions (owner)

- The marketing site is at `duelbinder.com`, and the signed-in app and API
  are at `app.duelbinder.com`.
- Site content: what the app does, screenshots, and a download link,
  modelled on dextcg.com.
- The logo is the gold Eye of Horus mark below ("R·1, refined eye"), with a
  square version and a circle version.
- The site uses the app's theme. The approved page structure is under
  "Page" below.
- The owner has registered the domain, created the Discord app and put the
  secrets in `.env` (Plan 1 Task 9 prerequisites).

## Logo

### Mark

The mark is a gold Eye of Horus (wedjat) on deep purple. The eye has:

- a tapered brow with rounded ends;
- an open almond outline;
- a solid pupil tucked under the upper lid;
- a short line off the outer corner;
- a vertical mark and a spiral below.

Every line is one weight. The approved artwork is below; treat it as exact
copy and change it only to fix rendering bugs.

```svg
<defs>
  <radialGradient id="glow" cx=".5" cy=".42" r=".62">
    <stop offset="0" stop-color="#6d28d9"/><stop offset="1" stop-color="#1e1047"/>
  </radialGradient>
  <linearGradient id="au" gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="0" y2="50">
    <stop offset="0" stop-color="#fbe9b0"/><stop offset=".45" stop-color="#ebbd5c"/><stop offset="1" stop-color="#c08a2a"/>
  </linearGradient>
  <linearGradient id="auf" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="62">
    <stop offset="0" stop-color="#fbe9b0"/><stop offset=".5" stop-color="#e2b14d"/><stop offset="1" stop-color="#b07d22"/>
  </linearGradient>
  <!-- The eye, on a 64×64 grid -->
  <g id="eye" transform="translate(-0.7 3.2)">
    <path d="M14 18.5C23 12.5 38 11.5 50 14.6Q51.4 15.7 50 17C38 14.2 23 15.6 14.8 21.2Q13.3 20 14 18.5Z" fill="url(#au)"/>
    <g fill="none" stroke="url(#au)" stroke-width="2.8" stroke-linejoin="round">
      <path d="M14.5 28.5C21 20.8 36 19.8 46 26.5C37 32.4 23 33.4 14.5 28.5Z"/>
      <path d="M46 26.6H52" stroke-linecap="round"/>
      <path d="M27.2 32.6L26.4 43.6" stroke-linecap="round" stroke-width="3"/>
      <path d="M33.4 32.2C35 39 38 43.5 43 43.5C47 43.5 48.5 40 46.5 37.8C45 36.2 42.5 36.8 42.3 38.8" stroke-linecap="round"/>
    </g>
    <circle cx="29" cy="26.6" r="4" fill="url(#au)"/>
  </g>
</defs>

<!-- Square: app icon, site header, sidebar -->
<svg viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="url(#glow)"/>
  <rect x="4.5" y="4.5" width="55" height="55" rx="10.5" fill="none" stroke="url(#auf)" stroke-width="1.8"/>
  <rect x="7.6" y="7.6" width="48.8" height="48.8" rx="8" fill="none" stroke="url(#auf)" stroke-width=".8" opacity=".6"/>
  <g transform="translate(32 32) scale(1.04) translate(-32 -32)"><use href="#eye"/></g>
</svg>

<!-- Circle: Discord application icon, social avatars -->
<svg viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="32" fill="url(#glow)"/>
  <circle cx="32" cy="32" r="29" fill="none" stroke="url(#auf)" stroke-width="1.8"/>
  <circle cx="32" cy="32" r="25.8" fill="none" stroke="url(#auf)" stroke-width=".8" opacity=".6"/>
  <g transform="translate(32 32) scale(.94) translate(-32 -32)"><use href="#eye"/></g>
</svg>

<!-- Small: favicon and anything at 32 px or less (no frame) -->
<svg viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="url(#glow)"/>
  <g transform="translate(32 32) scale(1.32) translate(-32 -31.5)"><use href="#eye"/></g>
</svg>
```

### Wordmark

"Duel Binder" is set in IBM Plex Sans semibold, the app's font, in the app's
off-white (`#ecebe8`), with no gold or gradient text. Beside the mark it reads
on one line, in the site nav, or on two lines, in the app sidebar as today.

### Where it goes

- **Sources:** `resources/brand/` holds standalone SVGs for square, circle
  and small. Each file is self-contained, with its gradients inlined.
- **Desktop:**
  - `build/icon.png` (1024 px, from square). electron-builder derives the
    `.ico` and `.icns` from it.
  - `resources/icon.png`, the window icon.
  - The sidebar logo in `AppShell.tsx` uses square, replacing
    `src/renderer/src/assets/logo.png`.
- **Site:**
  - favicon: `.ico` built from small at 16, 32 and 48 px, plus an SVG
    favicon;
  - Apple touch icon, from square at 180 px;
  - an Open Graph image, 1200×630: square mark plus wordmark on `#111113`.
- **Discord:** a 1024 px PNG of circle, which the owner uploads to the
  Discord application by hand.

## Page

The approved mockup is a single scrolling page on `duelbinder.com`.

**Theme (from `src/renderer/src/index.css`):**
- background `#111113`, text `#ecebe8`, muted text `#8f8d88`;
- hairline dividers at `rgb(255 255 255 / 6%)`;
- IBM Plex Sans for body text, IBM Plex Mono for codes, prices, file names
  and versions, with tabular numbers;
- radius 6–10 px;
- the main button is solid off-white with dark text; the second button is
  outlined at `rgb(255 255 255 / 14%)`.

The only colors on the page come from card art and the logo. The hero has
the app's art wash behind it: a heavily blurred card image at 30% opacity,
fading out downward, the same as `ArtWash.tsx`.

**Sections, top to bottom:**

1. **Nav.** It sits on frosted glass with a hairline bottom border, like the
   app's page header. It holds:
   - the square mark (28 px) and "Duel Binder";
   - muted links: Features, Download, GitHub (`https://github.com/darkharasho/duel-binder`);
   - "Sign in" on the right, linking to `https://app.duelbinder.com`.
2. **Hero.** Left-aligned, max width about 1040 px.
   - Headline: "A binder for your Yu-Gi-Oh! collection." (about 44 px,
     semibold, off-white).
   - Lead paragraph, about 15 px, 75% off-white: "Log what you own by set,
     rarity and condition. Prices update on their own. It runs on your
     computer and works offline. Sign in with Discord to see your friends'
     binders on the web."
   - Buttons: "Download for <detected OS>" (main) and "Open the web app"
     (outlined, linking to `app.duelbinder.com`).
   - A mono meta line: `v<latest> · Windows, macOS, Linux · free`.
3. **Hero screenshot.** The desktop app's Collection grid, full width, in a
   frame with a thin border and a soft shadow.
4. **Feature rows.** Each row has a narrow text column on the left (heading
   about 20 px semibold, 14 px body) and a screenshot on the right, divided
   by hairlines. They don't alternate sides.
   - "What it's worth": total value, card counts and most valuable pulls,
     from the latest prices. Screenshot: Dashboard.
   - "Finish your sets": every set and printing from the full catalog, with
     a checklist of what you still need. Screenshot: Sets checklist.
   - "Friends": sign in with Discord, add friends, and look through each
     other's binders at app.duelbinder.com. Screenshot: a friend's binder on
     the web, added when the web app exists. Until then the row ships as
     text only, in the same layout (my call: no mock-ups stand in for it).
5. **Download** (anchor `#download`). The same row layout, styled as a
   catalog table: one row per platform with the platform name, a mono file
   name with size, and an outlined "Download" button. Small print: "The app
   checks for updates itself."
6. **Footer.** "Duel Binder is not affiliated with Konami. Card data and
   images from YGOPRODeck." and a GitHub link.

**Screenshots** are real captures of the desktop app at 2× scale, saved as
WebP. They show a sample collection of classic cards, not the owner's own.
They are site assets checked into the repo, not rendered at request time.
*My call:* the sample collection is the mockup's: Blue-Eyes White Dragon,
Dark Magician, Red-Eyes Black Dragon, Dark Magician Girl, Mirror Force,
Summoned Skull, Pot of Greed, Monster Reborn, Kuriboh, Exodia the Forbidden
One, Mystical Space Typhoon, Change of Heart, plus enough LOB cards to make
the set checklist look real.

*My call:* the hero's art wash is a small, pre-blurred WebP of Dark
Magician's art, checked into the site's assets. Nothing is hotlinked from
YGOPRODeck.

**Downloads always point at the latest GitHub release.**
- The Worker reads `GET https://api.github.com/repos/darkharasho/duel-binder/releases/latest`.
  It caches the result for an hour and picks the assets ending in `-setup.exe`,
  `.dmg` and `.AppImage`. Blockmaps and `latest*.yml` are ignored.
- If GitHub is unreachable, or an asset is missing, that button links to
  `https://github.com/darkharasho/duel-binder/releases/latest`.
- OS detection for the hero button uses the request's User-Agent on the
  server. Unknown systems get "Download" pointing to `#download`.
- The repo is public, and v0.2.1 is a published release, so `releases/latest`
  answers today. electron-builder creates releases as drafts
  (`releaseType: draft`), and drafts are invisible to `releases/latest`, so
  a new version appears on the site once the owner publishes its draft. If
  no release is found, the meta line drops the version and reads
  `Windows, macOS, Linux · free`.
- No release is needed for the site to work. Current assets are still named
  `yugioh-collection-tracker-*`, and the next release produces `duel-binder-*`
  (the package was renamed). Matching by suffix covers both.

## Hosting

- One Worker (`duel-binder-portal`) serves everything; there's no new paid
  service. It routes by host:
  - `duelbinder.com` → the marketing page and its assets;
  - `www.duelbinder.com` → 301 to `https://duelbinder.com` (same path);
  - `app.duelbinder.com` → the existing app handler (`/auth/*`, `/api/*`,
    `/admin/*`, and the web app later);
  - the `workers.dev` host → the app handler, as today.
- `PUBLIC_URL` becomes `https://app.duelbinder.com`. Plan 1's canonical-host
  redirect then sends sign-ins from other hosts there.
- The owner adds `https://app.duelbinder.com/auth/discord/callback` to the
  Discord app's redirects. The existing `duelbinder.com` redirect can stay
  or go.
- Plan 1 Task 9's text says `duelbinder.com` where it now means
  `app.duelbinder.com`; update it.
- *My call:* host routing happens in the Worker's outer `fetch`, before the
  Durable Object. Only app-host requests reach `STORE`, so the marketing
  page never wakes the database.
- *My call:* the domain is assumed to be on the owner's Cloudflare account,
  so the plan adds `custom_domain` routes in `wrangler.toml` for the apex,
  `www` and `app`. Cloudflare creates the DNS records for those. The plan's
  deploy step checks this first, and stops for the owner if the zone isn't
  there.
- Nothing shipped depends on the old `PUBLIC_URL`. Desktop sync is Plan 2
  and isn't built, and no sessions exist yet, so moving to the `app` host
  needs no compatibility step.
- The marketing page is static HTML and CSS with self-hosted Plex WOFF2 files
  (from `@fontsource`). There's no client framework and no client JS, beyond
  what's needed for the art wash's fade-in, if any. Only the download links
  and hero OS label are filled in by the Worker.

## Constraints

- vitest always runs with `--maxWorkers=2`.
- No secrets in the repo; `.env` stays untracked.
- Deploying, pushing, merging and uploading to Discord need the owner's
  go-ahead.
- Text contrast meets WCAG AA on `#111113`. The page works at 360 px wide:
  feature rows stack and the screenshot follows its text.

## Signed-in links ship on day one (owner)

The "Friends" row, the hero's "Open the web app" button and the nav's
"Sign in" all ship with the first version of the page, because the web app
will follow soon. They link to `https://app.duelbinder.com` as written.
What that host shows at `/` before the web app exists belongs to the web app
plan, not this one (my call).

## Left to the builder

- How assets are served (Workers static assets binding versus inlined),
  provided one Worker handles all hosts.
- How screenshots are captured (Playwright driving Electron, or a seeded dev
  build), and the exact sample collection.
- Exact spacing and type sizes, within "matches the app" and the approved
  mockup.
- Tests: host routing, the `www` redirect, release-asset picking and its
  fallback, and OS detection. Snapshot or visual tests for the page are
  optional.
