# Art wash theme — design

Date: 2026-11-13 · Branch: `worktree-art-wash-theme`

## Why

The app looks like "the generic dark shadcn look, feels like every other app". The owner wants a look of
its own. The direction the owner chose after several mockups is a **colour wash built from the live card art**
on screen. It sits behind every page, with bold condensed type on top and no boxes around page content.

Reference mockups are in the main checkout's `.superpowers/mockups/` (git-ignored):
- `e-wash-collection.html`, the agreed state. It has dark and light themes, the random pick and the D mark.
- `wash.js`, the colour engine to port.

## Goals

- The background of every page is a soft field of colour pools taken from one card's art on that page.
  It must not read as blurred art.
- **Random pick:** each time a page is opened, one card shown on it is picked at random, and the whole wash
  comes from that card. Hover does **not** change the wash; that is the owner's call, replacing an earlier
  hover-following version. The pick skips grey art (see below) when the page has a more colourful card.
- **Variable pool count:** 1–5 pools, as many as the art has distinct colour families. Single-colour art
  gets a second pool so it never looks flat.
- **Text always legible:**
  - Every pool colour is pushed in lightness until white text (dark theme) or ink `#16121c` (light theme)
    has at least 4.5:1 contrast on it.
  - Text is fully opaque, with no faded labels.
- **Dark theme** is the default. A **light theme** comes with a Dark/Light switch in Settings.
- **Logo:** the sidebar shows only the D binder mark (`src/renderer/src/assets/logo-mark.svg`), with no
  "Duel Binder" wordmark beside it.
- **New type and layout:**
  - Bricolage Grotesque, condensed (wdth 75), weight 800 for page titles and 400–800 for body text.
  - Geist Mono for numbers, set codes, prices and small uppercase labels.
  - Big page titles (about 96 px on desktop).
  - The sidebar is plain text links: the current page is bold with a dot, and section labels are small mono caps.
  - Page content sits directly on the wash, with no card or panel boxes around it.

## Non-goals

- No light theme on the phone app (`src/phone`) for now. The phone gets the new wash in dark only. Scan is
  camera-first and stays dark.
- No colour precomputation on the portal or in the catalogue, and no Worker or database changes.
- No changes to the marketing site or emails.

## Anti-goals (a failure even if it works)

- The wash looks like a blurred photo, or flickers or jumps while you use a page.
- Any text becomes hard to read over a bright or busy pool.
- Opening a page feels slower because of the wash.
- It ends up looking like the old shadcn app with a gradient behind it.

## Approaches considered

**Where colours are worked out**
1. **In the renderer, when needed (chosen).**
   - Draw the card's *small* image onto a 32×32 canvas, then work out families → fitted pools.
   - Cache the result by image id, in memory and in localStorage.
   - One code path covers desktop, web and phone, and costs a few ms per new card.
2. *Main process, at image-cache time, stored in SQLite.* Rejected: desktop only, so web and phone would
   still need option 1.
3. *Portal precompute shipped with the catalogue.* Rejected for now: Worker and catalogue work for a visual
   feature. Revisit only if option 1 measures slow.

**Rollout**
1. **Staged on this one branch (chosen).** Each stage is checked in the real app before the next starts:
   wash engine, then dark redesign, then light theme.
2. *Everything in one pass.* Rejected: nothing can be checked until the whole token sweep is done.
3. *Wash and light theme only, keeping today's type and layout.* Rejected: it drops the part that makes the
   app stop looking generic.

## Design

### Stage 1: wash engine

Port `wash.js` to TypeScript, for example `src/renderer/src/lib/wash/`, with unit tests for the pure parts.

- **Sampling:**
  - Draw the image to a 32×32 canvas and convert pixels to OKLab/OKLCH.
  - Put hues in 20° bins, weighted by chroma.
  - A family counts if it has at least 15% of the top family's weight.
  - Merge families within 50° of each other, and keep at most 5.
- **Grey art:**
  - Art is grey when its mean chroma is under 0.045.
  - Grey Yu-Gi-Oh! art uses the frame colour as its main family (the `FRAME` table in `wash.js`: normal,
    effect, ritual, fusion, synchro, xyz, link, spell, trap).
  - The art's own top family is kept as a second, weaker pool when it is more than 50° away.
  - For other games, and for unknown frames, grey art falls back to the game's current glow colour from
    `ArtWash.tsx`.
- **Second pool:** single-family art gets a second pool by shifting the family's hue. Port this as it is in `wash.js`.
- **Fit to theme:**
  - Walk each pool's OKLCH lightness until WCAG contrast with the theme's ink is at least 4.5:1.
  - The base colour comes from the top family: dark and low-chroma for the dark theme, pale for the light theme.
- **Field:**
  - One radial-gradient pool per family, sized by sqrt(share).
  - Place them with per-card jitter seeded from the card id, so the same card always looks the same.
  - Add the base, a bottom shade gradient, and the feTurbulence grain overlay (`GRAIN` in `wash.js`) on top.
- **Two layers that cross-fade** (about 0.7 s) when the wash changes between pages. With
  `prefers-reduced-motion`, there is no fade.
- **Random pick:**
  - When a page mounts, or its card list first arrives, pick uniformly at random from the cards in its
    first screenful. Skip grey-art cards if any colourful one exists.
  - The pick stays put for that visit, including when the user scrolls, filters or hovers.
  - Re-opening the page picks again.
- **Replaces today's `ArtWash`:**
  - Remove the blurred image layer and the static glow.
  - Keep the `ArtWashContext` / `useArtWash` shape, but pages pass a *list of candidate cards*
    (image id and frame type), not a single image.
  - The callers to update are:
    - CollectionPage
    - BrowsePage
    - DashboardPage
    - FriendDashboard
    - SetsPage
    - SetChecklist
    - PhoneShell
- **Pages with no cards** (Settings, Scan, Friends list, empty pages) keep the last wash. If there is none
  yet, they use a quiet default made from the game's glow colour.
- **Wash strength:**
  - Full on the card-grid pages.
  - About half on dense table or settings-style pages.
  - None on Scan, where it stays as it is today.

### Stage 2: dark redesign

- **Fonts:**
  - Bundle Bricolage Grotesque (variable: opsz, wdth, wght) and Geist Mono locally, because the app is
    offline-first. Do not load them from Google Fonts at runtime.
  - They replace IBM Plex in `index.css`.
- **Sidebar:**
  - The D mark at top-left, about 46 px.
  - Grouped plain links: Dashboard, then Yours / Look up / Add / People, matching the current sections.
  - The active page is bold with a dot.
- **Page headers:** a big condensed title, with stats on the right in Geist Mono and small caps labels
  under them.
- **Filters:**
  - The search is an underline field.
  - Filters are pill chips: the active pill is solid ink, the others are translucent.
- **Card tiles:**
  - Art with a soft shadow.
  - The name in 600 weight below it.
  - The set code and price in mono on one line.
- **Boxes removed:** shadcn `Card` / panel borders around page sections come off. Popovers, dialogs and
  menus keep a solid surface for legibility.
- **Order:** do Dashboard, Collection, Browse and Sets first, then the rest of the pages.
- **Status pills:** status and rarity badges move to the same pill style.

### Stage 3: light theme

- **Tokens:** add a `.light` token set in `index.css` next to the dark one. `main.tsx` stops forcing
  `dark` and applies the saved choice instead (default dark).
- **Hard-coded colours:** replace about 350 of them across about 47 files with theme tokens:
  - `bg-white/…`, `text-white`, `bg-black`, raw hex/rgb, and `slate-`/`zinc-`/`neutral-`.
  - Colours that sit on card art or photos, like overlays on images, may stay fixed. Mark each one with a short comment.
- **Switch:** a Dark/Light switch in Settings → Appearance, saved in local settings. It also flips the
  wash fit (light base and ink).
- **Scope:** desktop and web only. The phone keeps forcing dark.

## Constraints

- Card art URLs: `ygo-img://` on desktop, and portal `/img/` on the web, which is same-origin, so canvas
  reads are allowed. Check that the canvas isn't tainted on both before relying on it.
- Run vitest with at most 2 workers (machine rule).
- Tests on the branch started green: 6322 passed, 18 skipped.

## Release (owner's decision)

- Stages 1 and 2 ship together: nothing merges until the dark redesign is done.
- The owner checks screenshots of the real app after each stage.
- Stage 3, the light theme, follows as its own release.

## Calls made after the builder check

- **Colours come from the art, not the whole card.**
  - Yu-Gi-Oh! samples the `cropped` image, which is what the mockup used.
  - Pokémon, Magic and One Piece have no art-only image, so they sample a fixed art box per game inside the
    small image, roughly the top-centre art window.
  - Otherwise frame colour and text boxes would dominate, and the grey-art rule would never fire.
- **Text over the wash is ink only.** Coloured text, such as price up/down, warnings, rarity colours and the
  accent, appears only inside solid surfaces: pills, popovers, dialogs and menus. Muted grey text over the
  wash becomes ink at a lighter weight or a smaller size, not lower opacity.
- **Phone:** it gets the new wash and the new fonts (shared tokens in `index.css`) but no layout rework.
- **Standard controls get the new look** through the shared `components/ui` files, so pages don't need
  editing one by one:
  - button, input, select, tabs, toggle, badge and table;
  - pill buttons and chips, underline inputs, and tables with hairline rules and no boxes.
- **Every page that shows cards picks from its own cards.** That includes Binders, Wishlist, Pokédex,
  Sessions and the card detail panel. Sets and the set checklist pick from the set's cards, not the
  pack or logo image.

## Left to the builder

- File layout of the wash module, the localStorage cache key or version, and the cache size cap.
- Exact gradient shapes, sizes and the jitter range, starting from `wash.js` and judged against the mockup.
- How "first screenful" is worked out per page. The first 12–24 cards in sort order is fine.
- Per-page wash strength values.
- How to split stage 3 into reviewable commits.
