# Catalog snapshots and an image cache limit

Date: 2026-11-15. Follows v0.95.1 (#317, pull only the games a device uses) and v0.95.2 (#318, the
catalog is applied on a worker in short transactions).

## Why

Opening Magic and One Piece to everyone (#310) made desktops pull Magic's full catalog: about 290k
cards and 1.2M printings, as single changes through the portal's change feed. Each change is
staged as JSON, then applied one at a time. Since #318 this no longer freezes the app, but a first
Magic pull still takes many minutes of feed paging plus about 6 minutes of applying in the
background. Every first pull also reads the whole feed out of the one shared Durable Object (DO),
which slowed the web app before.

Offline-capable collection apps download a prebuilt database file and then fetch small updates.
We do the same for a game's first pull.

Separately, the image folder has no limit. The owner's folder is 2.4 GB and only grows.

## Goals

- A device pulling a game for the first time downloads one compressed file for that game and
  imports it in well under a minute of background work. After that, the existing feed fetches
  only what changed since the snapshot.
- First pulls stop reading the whole feed from the DO.
- Card art and printing photos for cards the user owns are always kept. Everything else in the
  image folder stays under 1 GB, and the least recently used images go first.

## Non-goals

- Using a snapshot for a device that is merely behind on a game it already has. The feed handles
  that, and swapping rows under a collection is where the risk is.
- Changing the one-time Yu-Gi-Oh! switch (`runSwitch`).
- Server-side search, or dropping the local catalog for unused games.
- A setting for the 1 GB limit. It is a constant for now.

## Anti-goals (a failure even if it works)

- The app freezes or a main-process write waits for seconds. The import runs on the catalog
  worker in short, paused transactions, as in #318.
- A collection entry, binder or wishlist row loses its card or printing.
- A bad or partial snapshot leaves a game half-imported with its cursor set, so the gap is never
  filled. The cursor is only set once the import is complete, and any failure falls back to the
  feed.
- Deleting art for an owned card.

## Approaches considered

1. **A prebuilt SQLite file per game, imported with `INSERT … SELECT` (chosen).** CI builds each
   game's catalog tables into a small SQLite file stamped with the feed cursor it is current to.
   The file is gzipped and stored in R2. The desktop downloads it, `ATTACH`es it on the catalog
   worker and copies the rows in. Magic's cards and printings are 223 MB as a file and 43 MB
   compressed. Copying them took 0.3 s into tables without indexes; with the real indexes, expect
   10–30 s, spread over paused chunks.
2. **The since=0 feed pages, prebuilt and served from R2.** This is simpler, because the client
   reuses `applyChanges` unchanged, and it takes the load off the DO. But applying stays row by
   row, about 6 minutes for Magic. It fixes the server load but not the slow first pull.
3. **The DO builds the file on request.** Ruled out: the DO's memory limit is 128 MB, and a long
   build would stall the one shared DO, which caused the web slowness before.

## Design

### Building snapshots (CI)

- A new step in `catalog.yml` runs after the upload step succeeds (also in `workflow_dispatch`).
  It runs under Electron's Node like the rest of the job, so it can reuse the desktop code.
  It builds snapshots for `pkm`, `op` and `mtg`. Yu-Gi-Oh! never qualifies: `runSwitch` sets its
  cursor before `pullDeltas` runs on a fresh install.
- **The snapshots in R2 are the job's memory. There is no new Actions cache entry**, because that
  cache has already gone over 10 GB once. For each game the step:
  1. Makes a fresh database with the desktop's migrations.
  2. Downloads the game's current snapshot from R2, if there is one, and imports it with the
     desktop's own import code (below). This also tests that code every night.
  3. Pulls the feed from that cursor with the desktop's pull path (`pullDeltas` and the in-process
     applier), so only the night's changes come from the DO. Only the very first build, or a
     shape change (below), pulls a game's whole feed.
- **CI reads the feed with the admin token.** `catalogRoute` accepts only desktop sessions today
  (`workers/portal/src/catalogFeed.ts:188`). It will also accept `Authorization: Bearer
  <PORTAL_ADMIN_TOKEN>` for `changes` only, served as an account with every game. `contribute`
  stays desktop-only.
- For each game it writes `snap-<game>.sqlite` containing:
  - The game's rows of every `CATALOG_TABLES` table that lists the game, with the same columns.
  - `card_printings` with `id` left out (each store assigns its own; see Import) but `remote_id`,
    `contributed` and every other column kept.
  - A `snapshot_meta` table with: `game`, `cursor` (that game's feed cursor), `db_version`,
    `shape`, `built_at`, and row counts per table. `shape` is a short hash of the catalog's
    tables and columns (`CATALOG_TABLES` plus `card_printings`' extra feed columns), exported from
    `src/shared` so CI and the app compute it the same way. It is used instead of the whole schema
    version, because migrations land on main often and most don't touch catalog columns.
  - No FTS tables. The desktop rebuilds its search index afterwards.
  - `VACUUM`ed, then gzipped.
- It uploads `catalog-snapshots/<game>/<cursor>.sqlite.gz` to R2, then a manifest
  `catalog-snapshots/<game>/manifest.json` (`{game, cursor, dbVersion, shape, bytes, sha256,
  builtAt}`) through a new admin portal route. When main's `shape` differs from the last
  manifest's, the step writes under `catalog-snapshots/<game>/<shape>/…` and keeps the previous
  shape's manifest too, so released apps keep getting snapshots until they update. Manifests are
  keyed by shape: `catalog-snapshots/<game>/<shape>/manifest.json`. Snapshots whose files the manifest no longer names
  are deleted after 7 days, so a client mid-download keeps its file.

### Serving (portal)

- `GET /api/catalog/snapshot/:game?shape=<hash>`: needs a desktop session, the same check as the
  feed (`currentUser`, then `gamesFor`). That is one small DO read. It returns the manifest for
  that shape plus a download URL signed with HMAC (secret in a Worker secret), valid for 1 hour.
  It returns 404 when there is no manifest for that shape.
- `GET /api/catalog/snapshot-file/<key>?exp=…&sig=…`: checks only the signature and expiry, never
  the DO. It streams the R2 object with `content-length` and supports `Range`, so a broken
  download can resume. After an expiry the client asks for the manifest again, and resumes if the
  cursor is the same.
- `PUT /api/admin/catalog/snapshot/:game` (admin token) writes the file and the manifest. Use
  whatever upload mechanism fits Worker body limits; the builder decides, and a presigned R2 URL or
  wrangler from CI is fine too.

### Using a snapshot (desktop)

In `pullDeltas`, before paging the feed, a game qualifies for a snapshot when all of these hold:

- Its cursor and staging cursor are both null.
- It has no `cards` rows.
- The manifest exists for the app's `shape`.

Otherwise, or on any error below, the game takes today's feed path from its cursor, as now.

1. **Download.** Stream into `userData/catalog-snapshot/<game>-<cursor>.sqlite.gz.part`, resuming
   with `Range` if the part file exists. Status is `downloading`. The SyncStatus may gain an
   optional progress field (bytes done and total) for the banner; this is the builder's call.
2. **Check.** Verify the sha256, then gunzip to `<game>-<cursor>.sqlite` and delete the `.gz`.
3. **Import** on the catalog worker, as a new `CatalogApplyJob` kind `'snapshot'` carrying
   `{game, file, cursor, dbVersion}`:
   - `ATTACH` the file read-only and check `snapshot_meta.game` and `shape`.
   - For each table in parent-first order (`cards` before children), copy rows in rowid ranges of
     about 5,000 per transaction, pausing between transactions as in #318. Use `INSERT OR IGNORE`
     on the table's natural key so a resumed import is safe. For `card_printings`, leave `id` out
     so the local store assigns ids.
   - Record progress in meta `catalog_snapshot:<game>` = `{cursor, file, table, rowid}` so a quit
     resumes where it stopped. That meta also counts as "this game has started" for
     `catalogGames`.
   - A final transaction sets the game's cursor to the snapshot's, sets `db_version`, deletes
     `catalog_snapshot:<game>`, and calls `noteUnannounced` so the FTS `finish` runs.
   - Detach, then delete the file.
4. Then `pullDeltas` continues from the new cursor through the feed as usual, which fetches what
   changed after the snapshot was built.

The rollup triggers on `card_printings` fire per row. They delete from the small `catalog_rollups`
table, which is cheap, but the builder should measure it.

### Image cache limit

- **Owned art:** for every live collection entry (`deleted_at IS NULL`, any `owner_id`), the art
  files named by its `image_id` (`small/`, `full/` and `cropped/` `<image_id>.jpg`; files are named
  by image id, not card id), and the photo of its printing (`printings/` and `printings-small/`
  under the key from `sources.printing`). Wishlist cards aren't owned and share the budget; binder
  slots point at collection cards, so those are covered. Computing the set means one query for
  image ids and one `sources.printing` lookup per owned printing. Owned printing photos only need
  that lookup at eviction time, because an owned printing's photo is usually already on disk.
- **Everything else** (other card art, printing photos, `sets/`, `sprites/`) shares a 1 GB budget.
  `.brief`, `.none` and `.tmp` markers are never counted and are deleted with their image.
- **Last use** is the file's mtime. When the cache serves a file whose mtime is more than a day
  old, it updates the mtime (`fs.utimes`, fire and forget). This avoids relying on atime, which
  Linux and Windows often don't keep.
- **Eviction** runs a few minutes after launch, then again after every 100 MB of new downloads. It
  walks the folder off the hot path, skips owned files, and deletes the oldest by mtime until the
  rest is under 900 MB, which leaves headroom so it doesn't run constantly.
- A file being written (`.tmp`) or in flight is never deleted. Eviction skips any key in
  `inFlight`.
- Settings already shows the cache size and a Clear button (`sizeBytes`, `clear`). Clear stays as
  it is.

## Testing

- **Unit:** snapshot import from a small built file, including resume after a stop partway, a
  cursor that is only set at the end, a printing whose `id` is reassigned with `remote_id` kept,
  and refusal on a schema mismatch. The feed fallback runs on a bad checksum and on a missing
  manifest. Eviction keeps owned files, deletes the oldest others to under 900 MB with tiny
  limits in tests, and leaves `.tmp` and in-flight files alone.
- **Standalone benchmark (≤ 50k rows, outside vitest):** time the import and the longest
  main-process write wait during it.
- **CI dry run** of the snapshot job against the portal before the first real release.
- Data limits as usual: no 100k-row fixtures in vitest.

## Rollout

1. Portal routes plus the R2 layout. Deploy the Worker.
2. CI job. Run it by hand once and check the manifests and files for each game.
3. Desktop import plus the image limit. Release.

## Calls made without the owner (from the builder check)

- Download auth: a signed, short-lived URL from the manifest route, so the file route never reads
  the DO.
- Snapshot compatibility: a catalog shape hash instead of the schema version, and the previous
  shape is kept until apps update.
- CI's state lives in R2's snapshots, not a new Actions cache. CI reads the feed with the admin
  token (`changes` only).
- "Owned" means live collection entries of any local owner. Wishlist cards aren't owned.
- No Yu-Gi-Oh! snapshot.

## Left to the builder

- How CI uploads the file (Worker route, presigned URL or wrangler).
- Whether the banner shows download progress.
- Chunk size and pause tuning, from the benchmark.
- Whether `catalogGames` reads `catalog_snapshot:<game>` or the import sets the staging cursor.
