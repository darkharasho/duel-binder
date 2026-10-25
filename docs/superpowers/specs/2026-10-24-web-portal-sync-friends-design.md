# Duel Binder Web Portal, Sync & Friends — Design

Date: 2026-10-24
Builds on: `2026-10-23-yugioh-collection-tracker-design.md`, `2026-10-23-sets-page-design.md`,
`2026-10-23-non-english-sets-design.md` (v0.2.1, shipped)

## Intent

Today the collection lives in one SQLite file on one computer. The owner wants
it online so that they and a circle of friends can each keep a collection,
use it from a browser as well as the desktop app, and above all answer **"does
anyone I know have this card I need?"** without asking around.

That takes persistent shared storage: a server, accounts, and sync between
the desktop app's local database and the shared one.

## Goals

- **Accounts via Discord sign-in** (OAuth). No passwords stored.
- **Web portal = the full app**: the same Dashboard, Collection, Browse, Sets
  and Add Card screens as desktop, editing included, in a browser. A user can
  start a collection on the web with no desktop app at all.
- **Desktop sync**: a signed-in desktop app uploads its existing collection,
  then keeps local and cloud in step whenever online. It keeps working fully
  offline.
- **Friends** (request and accept), with three surfaces that work together:
  - a **Friends page** (new sidebar item): search one card across all
    friends; pending requests; friend list; add a friend by Discord username;
  - **"Friends who have it"** on every card's side panel (Browse, Sets,
    Collection);
  - **a friend's collection**: the normal Collection screen showing their
    cards, read-only, with a "Viewing X's collection · Back to mine" banner.

Mockups of the three friend surfaces were reviewed and approved in the
brainstorming session; layout matches the existing app shell (sidebar nav,
dark catalogue palette, IBM Plex).

## Non-goals

- Trading, marketplace, offers, messaging (still out of scope app-wide).
- Mobile app (the web portal may happen to work on a phone; not a goal).
- Open public sign-up as a product. The audience is the owner and friends.
- Offline access to friends' collections.
- Real-time collaborative editing / live push between devices.

## Anti-goals

- **Losing or duplicating cards through sync.** A deleted entry must not come
  back; the same card entered on two devices must not double the count.
- **Breaking the offline desktop app.** Signed-out, the desktop app behaves
  exactly as v0.2.1 does. Signed-in but offline, everything except friends
  works.
- **Leaking private data to friends.** Friends never see entry notes.
- **Hotlinking YGOPRODeck images** from the web portal (their API terms ask
  apps to download and host images themselves).

## Decisions

Owner-decided:

- Host on **Cloudflare** (Workers for the server and web app). The owner
  already runs `ygo-ebay-prices.project96.workers.dev`.
- *Revised during planning (my call, flagged to the owner):* the shared
  database is **SQLite inside one Durable Object** rather than D1. DO SQLite
  has a synchronous API (like better-sqlite3), FTS5, transactions and 10 GB,
  so the desktop's existing repo queries run on the server unchanged instead
  of being rewritten for D1's async API. One object is ample for a circle of
  friends. "D1" below means this store.
- **Discord OAuth** sign-in.
- **Latest edit wins** on sync conflicts.
- **Request-and-accept** friendships.
- Web portal is the **full app, same screens**.
- All three friend surfaces.
- Audience: the owner and a circle of friends.
- **Cloudflare Workers Paid ($5/month) is approved.** Simplicity and
  robustness over squeezing into the free tier (e.g. full nightly catalog
  reloads into D1 are fine).
- **Desktop sign-out / account switching** (owner approved the proposal):
  signing out keeps the local collection; edits made while signed out are
  tracked and pushed when the **same** account signs back in. Signing in as a
  **different** Discord account than the one the local data last synced with
  prompts: *merge these cards into that account* or *start fresh* (start fresh
  = the local collection is replaced by that account's cloud collection; the
  previous local data is not uploaded). First-ever sign-in on a desktop with
  cards uploads/merges without a prompt.
- **Setup approved:** a Discord application for OAuth; the portal lives in the
  same Cloudflare account as the eBay price Worker; this repo's GitHub
  Actions may run the scheduled catalog job with a Cloudflare API token
  (D1/R2 write) stored as a repo secret.

Calls made by me (Claude) during brainstorming, not confirmed by the owner:

- "Latest" = the time the edit was **made** on the device, not when it reached
  the server. Deletes are edits (tombstones) and win or lose by the same rule.
- Each collection entry gets a **globally unique ID** (UUID). Printings are
  identified across devices by a **natural key**, never by local integer IDs
  (see Sync).
- When two devices independently create an entry for the same printing + art
  while apart, they **converge to one entry; the most recent quantity wins**
  (not summed — summing would double-count a card entered twice).
- Desktop sign-in is **optional**; signed-out desktop is v0.2.1 behaviour.
- Desktop sign-in opens the system browser for Discord and returns to the app
  (loopback redirect or custom protocol — builder's choice).
- Friends are found by **Discord username**. Either side can unfriend.
- Friends see cards, printings, quantities, art choice and value totals;
  **not notes**.
- Anyone with a Discord account may sign in (no invite list); friendship gates
  visibility.
- Friend features show an offline state on desktop when there's no network.
- Card images and other artwork are mirrored into **R2** and served from the
  portal's own domain.
- Pending friend requests show as a count badge on the Friends nav item.

## Current state (relevant facts from the codebase)

- Renderer talks to the backend only through `window.api`, typed by `Api` in
  `src/shared/ipc.ts` and accessed via `src/renderer/src/lib/api.ts`. This is
  the seam for the web build: same React tree, an HTTP-backed `Api`.
- `collection_entries` (`src/main/db/database.ts`): integer `id`,
  `printing_id` → `card_printings(id)` (local integer), `image_id` →
  `card_images(image_id)` (YGOPRODeck's ID, stable), `quantity >= 1`, `notes`,
  `created_at`, `updated_at`, `UNIQUE (printing_id, image_id)`.
- `removeEntry` hard-deletes. `addEntry` sums into an existing
  (printing, image) row; `updateEntry` merges into an existing row when the
  edit makes a duplicate (`src/main/repo/collection.ts`).
- `card_printings.id` is **not stable**: English printings are rebuilt on
  catalog refresh; international printings come from Yugipedia; TCGplayer art
  variants become separate printings (`variant`, `tcg_product_id`).
- Natural uniqueness today: English `(card_id, set_code, set_rarity)`;
  international `(card_id, language, set_name, set_code, set_rarity)`
  (partial unique indexes in SCHEMA_V3). Variants (SCHEMA_V6/V7) split one
  code+rarity into several printings, so the natural key must include
  `variant` (or `tcg_product_id`) — builder to confirm what is actually unique.
- The catalog is built locally by `src/main/sync/*` (YGOPRODeck, Yugipedia
  international sets, TCGplayer/TCGCSV product photos, Konami/Yugipedia set
  logos, pack art) using synchronous better-sqlite3.
- Images are served via the `ygo-img://` Electron protocol from a local cache
  (`src/main/images/`): card art by size+id, printing photos, set art.
- Prices: YGOPRODeck prices for English; the owner's eBay price Worker for
  international printings (`src/main/prices/`).
- Repo queries in `src/main/repo/*` are synchronous better-sqlite3 calls;
  D1 is async.

## Design

### Pieces

1. **Server Worker** (Cloudflare Workers + D1 + R2): auth, collection API,
   sync API, friends API, catalog read API, image serving; also serves the
   web build's static assets.
2. **Shared catalog**: cards, printings, images, sets, logos, pack art, art
   and price data the screens need, in D1, with artwork in R2.
3. **Web build** of the existing renderer with an HTTP `Api` implementation.
4. **Desktop sync** in the Electron main process.
5. **Friends** UI in the shared renderer (both builds).

### Accounts & auth

- Discord OAuth2 (`identify` scope). Users table keyed by Discord user ID;
  store current username, display name, avatar.
- Web: session cookie (HttpOnly, Secure, SameSite=Lax).
- Desktop: after browser sign-in, the app holds a long-lived bearer token
  (revocable, stored with Electron `safeStorage`). Sign-out clears it.
- Settings page (both builds) gets an Account section: signed-in identity,
  sign in/out, last synced time, "Sync now".

### Shared catalog

The server needs the same catalog the desktop builds locally so the web
screens (Browse, Sets, search, Add Card, prices, art) work.

- *My call:* build it by **reusing the existing Node catalog code** in a
  scheduled job outside Workers (e.g. a nightly GitHub Actions run) that
  produces the catalog SQLite, then uploads **only rows that changed since
  the last successful upload** to the server, and uploads new artwork to R2. Rewriting Yugipedia/TCGCSV scraping for Workers is not worth it.
  A builder may choose a different mechanism if it keeps one source of truth
  for catalog logic.
- Every printing in the shared catalog carries its **natural key**; that's
  what sync and friends match on.
- **Printing photos and international (eBay) prices are resolved on demand,
  not in the nightly job** (*my call*, after builder review): as on desktop
  (`src/main/yugipedia/artResolver.ts`, `src/main/prices/refresh.ts`), the
  Worker resolves a printing's photo / price the first time it's needed,
  caches the result in D1 (photo bytes in R2), and refreshes stale prices on
  the same cadence desktop uses. The resolver logic is fetch + parse and
  should be shared with desktop rather than rewritten. A background pass may
  pre-resolve printings that someone owns so friends' value totals are
  filled in.
- Desktop keeps building its own local catalog as today (offline-first). It
  does not need to download the server's catalog.
- Prices: web reads the same sources (YGOPRODeck price fields in the catalog;
  eBay Worker for international).

### Collection data model (server, D1)

`entries`: `id` (UUID), `user_id`, printing natural key fields, `image_id`,
`quantity`, `notes`, `created_at`, `updated_at` (edit time, device clock),
`deleted_at` (tombstone, nullable), `server_seq` (monotonic per user, assigned
on write, used for pull cursors). Live rows unique on
(user, printing key, image_id).

### Desktop local changes

New migration (append-only, never edit shipped steps):

- `collection_entries` gains `uid` (UUID, backfilled) and the printing
  natural key (or the ability to resolve it), plus tombstones: deletes keep
  a row with `deleted_at` rather than removing it, **only when sync is
  enabled** — or always; builder's choice, but every existing query must
  exclude tombstones.
- A `sync_state` (meta keys): signed-in user, **the account the local data
  belongs to** (kept after sign-out), pull cursor, last sync time. Changes
  are tracked whether or not anyone is signed in.
- `addEntry`'s sum-into-existing and `updateEntry`'s merge stay as local UX;
  a merge emits an edit to the survivor and a tombstone for the absorbed
  entry.
- If a pulled entry's printing doesn't exist locally (desktop catalog older
  than server's), keep it pending and retry after the next catalog refresh;
  never drop it.

### Sync protocol

- **Push**: local entries changed since last push (by `updated_at`/dirty
  flag) are sent with their `uid`, natural key, fields, `updated_at`,
  `deleted_at`.
- **Server merge** per entry: match by `uid`, else by (user, printing key,
  image_id) among live rows; newer `max(updated_at, deleted_at)` wins; ties
  broken deterministically. If two different UIDs land on the same key, keep
  one (the newer), tombstone the other, and tell the client the mapping.
- **Pull**: client sends its cursor, receives all rows (including tombstones)
  with `server_seq` > cursor, applies with the same rule.
- Triggers: app start, after each local edit (debounced), on regaining
  network, periodic while open, and "Sync now".
- **First sign-in on a desktop with an existing collection**: upload it. If
  the account already has entries (e.g. from the web or another computer),
  merge by the rules above — no "pick one side" prompt.
- Device clocks are trusted for ordering (*my call*; acceptable for one
  person's devices). Server should clamp edit times far in the future.
- Web portal writes go straight to the server (no local store); it's always
  online.

### Web build

- Same React app, built for the browser with an `Api` implementation that
  calls the server Worker. Electron-only bits (title bar, updater, image
  cache size/clear, catalog "sync" banner tied to local refresh) are hidden or
  replaced on web.
- Images: `ygo-img://…` URLs become HTTPS URLs to the Worker/R2. The
  renderer should get image URLs from one helper so both builds work.
- Signed-out web shows a sign-in page; no anonymous use.

### Friends

- Tables: `friendships` (requester, addressee, status pending/accepted,
  timestamps). Unfriend deletes the row; ignoring a request deletes it
  silently (requester sees nothing). Re-requesting is allowed.
- Add friend: look up an existing user by Discord username (case-insensitive).
  Only users who have signed in at least once can be found.
- **Who-has search**: by card (any printing); returns each friend with their
  matching printings, art and quantities. Card-level, not printing-level.
- **Card panel**: "Friends who have it" with per-friend quantity; hidden when
  signed out or no friend has it.
- **Friend's collection**: Collection page in a read-only mode for a friend's
  user ID: same filters, grid/table, stats; no add/edit/remove; notes
  stripped server-side. Banner with "Back to mine". *Builder's call* whether
  Sets progress for a friend is included (not required).
- Friends list shows card count and last-synced time per friend.
- All friend APIs authorize: only accepted friends' collections are readable.

## Constraints

- Cloudflare Workers Paid plan; design for a handful to a few dozen users.
- Keep the desktop app's existing test suite green; run vitest with
  `--maxWorkers=2` (machine memory limit; already in `npm test`).
- Desktop DB migrations are append-only (`MIGRATIONS` in `database.ts`).
- YGOPRODeck rate limits apply to the catalog job.
- Secrets (Discord client secret, session signing key) live in Worker
  secrets / GitHub Actions secrets, never in the repo or the desktop binary.
  Desktop OAuth must not embed the client secret (use PKCE or a server-side
  exchange).
- Update `CLAUDE.md`: "Cloud sync or user accounts" moves out of
  "Out of scope".

## Left to the builder

- Repo layout (monorepo folders for the Worker and web build vs. separate
  packages), routing, and how to share code between the Electron main repo
  layer and the Worker (shared pure logic vs. duplicated queries against D1).
- Exact natural-key definition after checking real uniqueness of printings
  with variants.
- Desktop OAuth return mechanism; token format.
- Sync batching sizes, debounce intervals, retry/backoff.
- Domain/subdomain for the portal.
- Order of delivery. Suggested: server + auth + catalog → web build →
  desktop sync → friends.
