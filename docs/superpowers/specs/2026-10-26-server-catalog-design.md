# Plan 4: Everything through our server — design

## Intent

Today the desktop app talks to nine outside sources itself: YGOPRODeck (catalog, card images),
Yugipedia (international sets, set logos, printing photos), TCGCSV/TCGplayer (catalog, prices,
printing photos), yugioh-card.com and konami.com (pack art, logos), and the `ygo-ebay-prices`
Worker when signed out. Every install rebuilds the same catalog from scratch: a daily YGOPRODeck
sync, a weekly ~4-minute Yugipedia international set sync, weekly TCGplayer and Konami scrapes.
Meanwhile the nightly GitHub Actions catalog job already runs that exact refresh and uploads the
result to the portal.

The owner wants all of that consolidated into one call path: **the desktop talks only to our
services** (the portal at app.duelbinder.com). The server fetches from the outside world once and
keeps one shared copy; each desktop pulls a quick delta of what changed.

Why (as understood): one place to fix things when a source changes or breaks; no heavy per-client
catalog rebuild or intl sync; no client hammering outside services; and friends' views stop missing
cards whose printings the server didn't know (`unknown-printing`).

## Decisions made by the owner

- **Everyone goes through our server** for catalog, international sets, images and prices.
- **Sign-in is required to use the app.** No signed-out mode remains. (Discord sign-in, as today.)
- **Offline keeps working from cached data** once signed in. The desktop never falls back to the
  original sources.
- **Anti-goal: losing any card during the switch.** If the switch technically works but a single
  collection entry is lost or re-pointed to the wrong printing, it failed.

## Goals

1. The desktop main process makes no requests to YGOPRODeck, Yugipedia, TCGCSV, TCGplayer CDN,
   yugioh-card.com, konami.com/img.konami.com or `ygo-ebay-prices`. Its only network peers are the
   portal, GitHub (auto-updater), and the browser for sign-in.
2. The portal serves the catalog as a snapshot for first install and as deltas since a cursor
   afterwards. Covered tables: everything in `src/shared/catalogTables.ts` (cards, card_images,
   card_printings incl. international and TCGplayer-only printings and `market_price`, sets of
   every language, pack_art, set_logos, konami_logos, tcgplayer_groups, tcgplayer_products).
3. All images (card art in three sizes, set images, pack art, logos incl. Konami, printing photos)
   come from the portal's `/img` routes, cached on disk locally as today.
4. Prices: TCGplayer market prices arrive with the catalog delta; eBay/international prices come
   from the existing `POST /api/sync/prices`. The signed-out direct eBay path is removed.
5. Printing photos (today `artResolver` on the desktop) are resolved by the portal only.
6. The app opens to a sign-in screen when no account is signed in. Existing local data (owner 0)
   is adopted into the account on first sign-in, as `adoptLocalData` already does.
7. Every collection entry survives the switch, pointing at the same printing (same pkey) as before.

## Non-goals

- Moving the catalog job off GitHub Actions into a Worker. (Builder's call to revisit; see below.)
- Changing the auto-updater: it keeps reading GitHub releases directly so a broken server can never
  block a fix from shipping.
- Discord avatar `<img>` loads and `shell.openExternal` links stay as they are.
- Scan fingerprints: already served by the portal; unchanged except that they now ride the new
  catalog cadence.
- Performance work on `sets:list` (~870 ms), parked separately.
- Breaking older desktop versions: they keep calling sources directly and must keep working
  against the updated portal. The public `ygo-ebay-prices` endpoint stays up for them.

## Constraints

- **Deploy order:** the portal Worker deploys before any desktop release (as always). Server
  migrations are fix-forward; server-2 is one-way.
- **Catalog parity gate:** before the desktop release, the server's catalog must contain every
  pkey a freshly built desktop catalog contains (English, every international language, and the
  TCGplayer-only printings). Verify by building a catalog locally with today's desktop code and
  diffing pkey sets against the portal; zero missing pkeys is the bar.
- **Identity:** printings are matched across stores by `pkey` (generated column, formula in
  `schema.ts` V10 and `catalogLoad.ts` `PKEY_SQL`). Row ids differ between desktop and server and
  must never be assumed equal. Cards and card_images use YGOPRODeck ids, which are global.
- **Auth:** catalog, image and price endpoints require a signed-in user (Bearer token, as the
  existing `/api/*` routes). Images already in R2 may stay publicly readable as today.
- **Abuse:** signed-in `/img` upstream fetches are currently not rate-limited (parked item). Add a
  per-user limit on upstream (R2-miss) fetches; R2 hits stay unlimited.
- Tests run with `vitest --maxWorkers=2`. Repo-wide lint already fails on main; don't add new errors.

## How it works

### Server: catalog changes feed

- Each catalog table in the DO gets a change sequence: every upsert or delete performed by the
  admin loader (`catalogLoad.ts`) stamps a monotonically increasing `catalog_seq`; deletes leave a
  tombstone (table + key + seq). The loader already upserts by key, so server row ids stay stable.
- `GET /api/catalog/changes?since=<seq>&limit=N` returns rows and tombstones after `since`, in seq
  order, paged, with the next cursor and whether more remain. Rows use the same column sets as
  `CATALOG_TABLES` (printings keyed by pkey, plus the server printing id — see printing photos).
- **First install / far-behind clients:** `GET /api/catalog/snapshot` returns a whole-catalog
  snapshot and the seq it reflects; the client then pulls changes from that seq. **My call:** the
  snapshot is exported from the DO's actual contents (not the job's `work.sqlite`, which drifts
  from the DO and lacks server printing ids), e.g. a Worker export to R2 triggered after each
  catalog `finish`, served with an ETag. Builder's call on format and compression. If tombstones are pruned, a client whose cursor is
  older than the prune horizon gets told to re-snapshot.
- The nightly job's daily TCGplayer price pass changes `market_price` on many printings; that's
  expected delta volume. Builder may split prices into their own feed if deltas get large.
- Konami logos: the desktop cuts white out of them (`prepareLogo`) and the portal refuses `km-`
  today. The processed logo must be produced server-side or by the nightly job and stored in R2
  under `set/km-*`, so the desktop just downloads it.

### Desktop: applying the catalog

- `refreshCatalog()` and its source clients (YGOPRODeck, Yugipedia, TCGCSV, Konami, pack art,
  set logos, TCG prices, eBay price refresh, art resolver) are no longer called by the app. The
  nightly job still uses that code — it stays in the repo for `scripts/catalog/*`.
- A new catalog pull runs at startup and on the existing sync schedule: snapshot if never pulled,
  else changes since the stored cursor. Applied in one transaction per page, upserting **by pkey**
  for printings (local ids are kept) and by key for the other tables, exactly like the server's
  loader. FTS (`cards_fts`) is updated alongside.
- A server tombstone for a printing that a local collection entry (any owner, including deleted
  entries still syncing) references is not deleted locally; the row is kept and marked
  `missing_from_api = 1`, matching today's behaviour when YGOPRODeck drops a printing.
- After a pull that touched cards/images, the scan fingerprints refresh as today.
- Image cache (`images/cache.ts`): every kind resolves to `<portal>/img/<kind>/<id>` with the
  auth header. On-disk layout and the limiter stay.
- Printing photos: the portal's `/img/printing/<id>` is keyed by the server printing id. The
  delta includes it; the desktop stores it (e.g. a `remote_id` column) to build the URL. Builder may
  instead add a pkey-addressed route; either is fine.

### The switch (first run of the new version) — card safety

Runs once, before the first catalog pull is applied:

1. **Backup.** Copy the SQLite database (consistently, e.g. `VACUUM INTO`) to
   `<userData>/backups/<date>-pre-server-catalog.sqlite` and keep it. If the backup fails, the
   switch doesn't run and the app keeps its existing catalog until the next launch.
2. **Count before.** Record per owner: number of live entries, total quantity, and the multiset of
   (pkey, image_id, quantity) for live entries.
3. **Apply the snapshot** by pkey upsert as above. Local-only printings that no entry references
   are removed so the catalog matches the server; referenced ones are kept and flagged
   `missing_from_api = 1`. Collection rows are never written by this step.
4. **Count after** and compare with step 2. Any difference rolls the transaction back, keeps the
   old catalog, logs the diff, and retries next launch.
5. Mark the switch done in `meta`.

**If the switch can't finish** (backup fails, counts differ, offline on first launch of the new
version): the app keeps working on its existing catalog and shows a clear, persistent warning that
the catalog can't update, with the reason. It retries on every launch (and when the portal becomes
reachable). There is no fallback to direct source calls — owner's decision.

### Printings that exist only on desktops (owner: yes, the server accepts them)

Real databases hold pkeys no fresh build produces (older Yugipedia parses, rarities or set names
renamed upstream, rows from before the 0.6.1 intl fix). These must not stay invisible to friends.

- After the switch, and whenever a push answers `unknown-printing`, the desktop sends the server
  the printing rows (all `card_printings` columns from `CATALOG_TABLES`) for pkeys its entries
  reference that the server lacks. New endpoint, e.g. `POST /api/catalog/contribute`.
- The server validates before inserting: `card_id` exists in `cards`, the entry's `image_id`
  exists in `card_images` for that card, language is one the catalog uses, string lengths are
  bounded, and the computed pkey isn't already present. Per-user cap per day (builder picks).
- Contributed rows are marked (e.g. `contributed_by` user id) and the nightly loader never deletes
  them. If the loader later upserts the same pkey from a source, it becomes a normal row.
- **My call:** contributed printings ride the catalog feed so friends' desktops and the web can
  resolve those entries, but they're hidden from search, the Sets page and add-card pickers; they
  only show where an entry references them.
- Once contributed, the pending push retries and succeeds, so the entry reaches the account and
  friends' views.

Entries whose printing still isn't on the server (contribution rejected or pending) are shown in
the UI (e.g. a badge and a filter on the collection page) and in the sync status, instead of
staying silently dirty — this closes the parked "unknown-printing stays dirty silently" item.

Before release, run the switch on a copy of the owner's real database and confirm counts match and
that, after contribution, zero entries remain unknown to the server.

### Sign-in gate

- No signed-in account → a full-window sign-in screen (Discord via the existing browser flow).
  The rest of the app isn't reachable until sign-in succeeds.
- Signed in but offline, or the token expired while offline: the app works fully from cached data.
  It asks to sign in again only once the portal is reachable and rejects the token.
- Fresh install needs to be online once: sign in, then the snapshot downloads with visible progress.
- Sign-out returns to the sign-in screen; local cached catalog and images stay on disk.

## Left to the builder

- Snapshot format, compression, and whether R2 or the DO serves it; delta page size; tombstone
  pruning horizon.
- Whether `catalog_seq` is per table or global (global is simpler for one cursor).
- How the Konami logo processing moves (nightly job vs Worker).
- Per-user `/img` upstream rate-limit values.
- Which now-unused desktop tables/meta keys (`tcgplayer_prices`, `tcgplayer_price_groups`,
  `*_synced_at` stamps, desktop `printing_art`) to drop, and when.
- Exact sign-in screen design, matching the existing UI.
- Whether the catalog job eventually moves into a Worker (out of scope here).
