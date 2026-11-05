# Scan Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scanner "Add to collection" is saved as a session on the account; the owner and their friends can browse sessions as a feed of card tiles and remake the Rip Replay from any of them.

**Architecture:** A new synced entity, `scan_sessions`, modelled on wishlist/binders sync: one row per session holding its cards as JSON, a desktop/phone local SQLite table (phone runs the same schema and data handlers in wasm), push/pull through `/api/sync/sessions-*`, and a friend read over RPC. The renderer records a session after `session.commit()`, and shows a shared `SessionFeed` on a new desktop page, a phone sheet and a friend-page tab. `MakeReplay` takes a ready `ReplaySource` (pulls + header) so it can be fed from scan rows or from a saved session.

**Tech Stack:** Electron + React + TypeScript, better-sqlite3 / wasm SQLite, Cloudflare Worker + Durable Object SQLite, vitest (+ @cloudflare/vitest-plugin), TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-05-scan-sessions-design.md`

## Global Constraints

- Wording: "session", never "night", in all new and touched copy (owner, 2026-11-05).
- One successful tap of Add to collection = one session, on desktop, phone and phone Stream alike; only rows actually added are in it; nothing added → no session.
- Each card keeps the price it had at Add time; a null price is filled once later; a price is never changed.
- Sessions are visible to friends by default (`friendsVisible: true`); a hidden one never reaches friends, nor its existence.
- Friends can view and Make replay only; no hide/delete/edit.
- Recording a session must never slow, fail or toast on an Add: failures are swallowed.
- Sessions are never lost when the server lacks the route yet: they stay dirty locally and push later.
- No video is stored; replays are rebuilt on the device, from saved prices, with the session's date in the header.
- The scan page's layout is untouched; desktop Sessions is its own sidebar page, hidden on web like Scan.
- Tests: `npm test -- <file>` (maxWorkers=2 is in the script); Worker: `cd workers/portal && npx vitest run --maxWorkers=2 test/<file>`. No 100k+ synthetic rows. Skip whole suites/builds while the machine is under memory pressure; say so.
- Migrations: desktop `SCHEMA_V41` (`server: false`); Worker `server-38`. Never edit a shipped step.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, PR or Worker deploy without the owner.

## Review Focus

1. Add where some rows fail → the session holds only the rows that landed; all fail → no session (Task 4 test).
2. A row's quantity raised while Add runs → the session records the quantity that was added, not the new one (Task 4 test).
3. Hidden, deleted and other-game sessions never come back from `friends:sessions` (Task 5 test).
4. Fill-once: a card priced at Add keeps its price even when today's differs; a null one fills; a second fill changes nothing (Task 3 test).
5. A malformed or oversized push (bad card, > `MAX_SESSION_CARDS`) is a 400, not a stored row (Task 5 test).

---

### Task 0: Commit the pending replay work

The worktree holds uncommitted Rip Replay work (backdrop looks, WebCodecs encoder, logo). Land it before starting.

- [ ] **Step 1:** `npm test -- tests/renderer/replay-*.test.ts*` → all pass; `npm run typecheck` → clean.
- [ ] **Step 2:** Commit `package.json package-lock.json src/renderer/src/features/scan/replay tests/renderer/replay-*` as `feat(replay): blurred art backdrop, frame-by-frame MP4, logo beside the watermark`. Commit the spec and this plan as `docs: scan sessions design and plan`.

### Task 1: "Session", not "night"

**Files:** Modify `src/renderer/src/features/scan/replay/draw.ts` (~696), `src/renderer/src/features/scan/window/SummaryScreen.tsx` (~38–42), comments in `replay/MakeReplay.tsx`, `replay/pulls.ts`, `window/summary.ts`. Tests: `tests/renderer/replay-draw.test.ts:128`, `tests/renderer/scan-summary.test.tsx:104,113,123`.

- [ ] **Step 1:** Change the tests first: `'TOP PULL OF THE NIGHT'` → `'TOP PULL OF THE SESSION'` (and add a positive assertion that the best pull's segment end shows `'TOP PULL OF THE SESSION'`); region name `'Hit of the night'` → `'Hit of the session'`.
- [ ] **Step 2:** Run both files → the positive assertion and the region lookups FAIL.
- [ ] **Step 3:** Change the copy (`'TOP PULL OF THE SESSION'`; aria-label and heading `Hit of the session`); reword "night" in the named comments. Check the long caption still fits its max width in `draw.ts` (it is drawn with `centredText`'s max width; shrink only if the test harness or a rendered frame shows clipping).
- [ ] **Step 4:** Run both files → PASS. `grep -rni "night" src/renderer/src/features/scan` shows no copy left.
- [ ] **Step 5:** Commit `fix(scan): say session, not night`.

### Task 2: Replay from any source

**Files:** Modify `src/renderer/src/features/scan/replay/pulls.ts`, `replay/MakeReplay.tsx`, `src/phone/stream/StreamScreen.tsx:249`, `src/renderer/src/features/scan/ScanPage.tsx` (MakeReplay call). Tests: `tests/renderer/replay-pulls.test.ts`, `tests/renderer/replay-button.test.tsx`.

**Interfaces — Produces:**
```ts
// pulls.ts
export interface ReplaySource { pulls: ReplayPull[]; header: string }
export interface PullCandidate extends ReplayPull { guess: boolean }
export function choosePulls(candidates: PullCandidate[]): ReplayPull[]   // the existing rule: !guess, price ≥ REPLAY_MIN_PRICE, dearest REPLAY_MAX_PULLS, play order
export function rarityOf(row: ScanRow): string | null                     // now exported
export function replaySourceOfRows(rows: ScanRow[]): ReplaySource        // { pulls: pickReplayPulls(rows), header: replayHeader(rows) }
// MakeReplay.tsx
type Make = (source: ReplaySource, format: ReplayFormat, opts: {...}) => Promise<SaveResult>
export function MakeReplay(props: { source: ReplaySource; variant: 'phone' | 'desktop'; make?: Make })
```
`pickReplayPulls(rows)` keeps its signature and delegates to `choosePulls`.

- [ ] **Step 1:** Tests: `choosePulls` drops a `guess: true` candidate and one at $0.99, keeps the dearest 8 of 10 in play order; `replaySourceOfRows(rows).header === replayHeader(rows)`; in `replay-button.test.tsx` switch renders to `source={replaySourceOfRows(rows)}` and add "disabled with 'No pulls to replay' when `source.pulls` is empty" and "passes the same source to make".
- [ ] **Step 2:** Run → FAIL (missing exports / props).
- [ ] **Step 3:** Implement. `makeReplay` loads art for `source.pulls` and uses `source.header`; it no longer sees rows. Update the two callers to `source={replaySourceOfRows(rows)}` (memoised on rows).
- [ ] **Step 4:** Run `tests/renderer/replay-*.test.ts*` and `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `refactor(replay): Make replay from a ready source`.

### Task 3: Session data on the device

**Files:** Create `src/shared/scanSessions.ts`, `src/main/repo/scanSessions.ts`, `tests/main/scanSessions.test.ts`. Modify `src/main/db/schema.ts` (`SCHEMA_V41`, `MIGRATIONS`), `src/main/repo/scope.ts` (new `sessions` scope field, LOCAL), `workers/portal/src/scope.ts` (server `sessions` scope with `NEXT_SESSION_SEQ`; the Worker table lands in Task 6 but the scope type must compile).

**Interfaces — Produces:**
```ts
// src/shared/scanSessions.ts
export const MAX_SESSION_CARDS = 1000
export interface ScanSessionCard {
  cardId: number; printingId: number; imageId: number; photoId: number | null
  name: string; setCode: string | null; rarity: string | null
  quantity: number; price: number | null; guess: boolean; addedAt: number
}
export interface ScanSession {           // what lists return
  uid: string; game: GameId; cards: ScanSessionCard[]; friendsVisible: boolean
  createdAt: string; updatedAt: string
}
export interface WireScanSession extends ScanSession { deletedAt: string | null }
export type ScanSessionPushResult = /* as BinderPushResult, over WireScanSession */
export interface ScanSessionPullResponse { sessions: WireScanSession[]; cursor: number; more: boolean }
export function sessionTotal(cards: ScanSessionCard[]): { value: number; priced: number; unpriced: number }   // price × quantity over priced cards
export function checkSessionCards(v: unknown): ScanSessionCard[]   // throws CollectionError on any malformed card, empty list or > MAX_SESSION_CARDS
// src/main/repo/scanSessions.ts (all take scope = LOCAL last)
export function recordScanSession(db, s: { uid: string; game: GameId; cards: ScanSessionCard[] }, scope?): void   // idempotent on uid; no-op on empty cards
export function listScanSessions(db, game: GameId, scope?): ScanSession[]          // live only, newest createdAt first
export function setScanSessionHidden(db, uid: string, hidden: boolean, scope?): void
export function deleteScanSession(db, uid: string, scope?): void                   // tombstone
export function fillScanSessionPrices(db, game: GameId, scope?): number            // cards with price null get the printing's current price (printingPrice(scope), repo/sets.ts:308); returns sessions changed
```
Desktop table (`server: false`), following wishlist V25 / binders V30: `owner_id INTEGER NOT NULL DEFAULT 0, uid TEXT NOT NULL, game TEXT NOT NULL, cards TEXT NOT NULL (JSON), friends_visible INTEGER NOT NULL DEFAULT 1, created_at, updated_at, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1`, primary key `(owner_id, uid)`, partial index `WHERE dirty = 1`.

- [ ] **Step 1:** Tests (`seededDb`): record then list returns it with `friendsVisible: true`; recording the same uid twice keeps one; other game not listed; newest first; hide flips `friendsVisible` and marks dirty; delete drops it from the list and leaves a dirty tombstone; **fill-once** — a card recorded at `price: 5` with today's price 9 stays 5, a `null` card becomes 9, a second `fillScanSessionPrices` returns 0; `sessionTotal` ignores null prices and multiplies quantity; `checkSessionCards` rejects a card missing `printingId`, a negative quantity and `MAX_SESSION_CARDS + 1` cards. `databaseAt(40)` migrates to 41 with data intact.
- [ ] **Step 2:** Run `npm test -- tests/main/scanSessions.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npm test -- tests/main/schema.test.ts tests/main/wishlist.test.ts` still PASS.
- [ ] **Step 5:** Commit `feat(sessions): keep scan sessions on the device`.

### Task 4: Record a session on every Add

**Files:** Modify `src/shared/ipc.ts` (`Api.sessions`, `INVOKE_CHANNELS`), `src/main/ipc/dataHandlers.ts` (`DATA_CHANNELS`, handlers; writes wrapped in `edited`), `src/phone/api.ts` (`EDITS` gets the three write channels; `dataPart('sessions')`), `src/renderer/src/lib/api.ts` query keys, `src/renderer/src/features/scan/session.ts` (`commit`). Create `src/renderer/src/features/scan/sessionCards.ts`. Tests: `tests/main/dataHandlers*.test.ts` (whichever covers wishlist channels), `tests/renderer/scan-session.test.ts`.

**Interfaces — Produces:**
```ts
// Api.sessions (channels sessions:record / sessions:list / sessions:setHidden / sessions:delete)
record(s: { uid: string; game: GameId; cards: ScanSessionCard[] }): Promise<void>
list(game: GameId): Promise<ScanSession[]>          // runs fillScanSessionPrices first
setHidden(uid: string, hidden: boolean): Promise<void>
delete(uid: string): Promise<void>
// sessionCards.ts
export function sessionCardOf(row: ScanRow, quantity: number): ScanSessionCard | null   // null when the row has no printing; price = priceOf(row), photoId = photoFor(row), rarity = rarityOf(row), guess = !!row.guess
```
In `commit`, inside the per-row success branch, push `sessionCardOf(row, row.quantity)` (the snapshot `row` from `batch`, so a quantity raised meanwhile isn't counted). After the `finally`, if any were saved: `void api.sessions.record({ uid: crypto.randomUUID(), game, cards }).catch(() => undefined)`. `commit`'s return value and toasts are unchanged.

- [ ] **Step 1:** Tests: `sessions:*` channels are in `DATA_CHANNELS` and round-trip through the handlers; in `scan-session.test.ts` with a mocked `api`: three rows, one `collection.add` rejects → `sessions.record` called once with the two added cards and their prices; all reject → not called; a row whose quantity is raised from 1 to 3 while its add is pending → recorded quantity 1; `sessions.record` rejecting → `commit` resolves with the same `{added, failed, cards}` and no error is thrown.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement. The `invokeChannelsMatchApi` compile check must pass.
- [ ] **Step 4:** Run both files and `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(sessions): record a session on every Add to collection`.

### Task 5: Worker — store, sync and friend read

**Files:** Create `workers/portal/src/scanSessions.ts`. Modify `workers/portal/src/migrate.ts` (`server-38`), `workers/portal/src/sync.ts` (`POST_PATHS`/`GET_PATHS`, pull dispatch, push branch), `workers/portal/src/rpc.ts` (`'friends:sessions'` with `friendId(...)`), `src/shared/portal.ts` (`PORTAL_CHANNELS`), `workers/portal/src/merge.ts` (copy sessions on account merge, like wishlist ~90–97) and `link.ts` counts, `workers/portal/src/account.ts` comment listing tables. Client wiring for `friends.sessions`: `src/main/ipc/handlers.ts` (`account.portal`), `src/phone/api.ts` (`portal(...)`), `src/renderer/src/web/httpApi.ts`; `Api.friends.sessions(friendId: number, game: GameId): Promise<ScanSession[]>` in `src/shared/ipc.ts`. Tests: `tests/portal/scanSessions.test.ts`, `workers/portal/test/scanSessions.test.ts` (Miniflare).

**Interfaces — Produces:**
```ts
export function checkSessionPush(body: unknown, now: Date): WireScanSession[]   // uses checkSessionCards, checkTime; 400 on anything malformed
export function applySessionPush(db, userId, entries, games): ScanSessionPushResult[]
export function sessionPullSince(db, userId, game, cursor): ScanSessionPullResponse
export function friendSessions(db, friend: number, game: GameId): ScanSession[]   // live, friends_visible = 1, that game, newest first
```
Server table: `scan_sessions (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, uid TEXT NOT NULL, game TEXT NOT NULL, cards TEXT NOT NULL, friends_visible INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, seq INTEGER NOT NULL, PRIMARY KEY (user_id, uid))` + unique `seq` index + `(user_id, seq)` index, as binders (server-19). One query per table (DO SQLite rejects big compound queries).

- [ ] **Step 1:** Tests (`tests/portal`, `seededServerDb`/`addUser`): push then pull round-trips; an older push is `stale` with `current`; a push with a bad card or `MAX_SESSION_CARDS + 1` cards throws `CollectionError`; `friendSessions` returns a friend's visible session and omits a hidden one, a deleted one and another game's; account delete removes the rows; merge copies them. Miniflare: `migrateServer` creates `scan_sessions`; one push + pull through `syncRoute`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -- tests/portal/scanSessions.test.ts` and `cd workers/portal && npx vitest run --maxWorkers=2 test/scanSessions.test.ts` → PASS; also `test/migrate*.test.ts` if present.
- [ ] **Step 5:** Commit `feat(portal): store and sync scan sessions; friends can read visible ones`.

### Task 6: Sync sessions (desktop and phone)

**Files:** Modify `src/main/cloud/client.ts` (`sessionsPush(entries)`, `sessionsPull(cursor, game)` → `/api/sync/sessions-push`, `/api/sync/sessions-pull?cursor&game`), `src/main/cloud/localSync.ts` (`dirtySessions`, `markSessionsPushed`, `applyRemoteSession`, `purgeCleanSessions`; add `'sessions'` to `SyncStream`; add the table to `hasLocalData`, `adoptLocalData`, `OWNED_TABLES`, `adoptMergedData`), `src/main/cloud/engine.ts` (`syncSessions`, called from `syncOnce` beside `syncBinders`), `src/phone/data/store.ts` (account-delete table list). Tests: `tests/main/cloud-sync.test.ts`, `tests/main/cloud-local.test.ts` (`inProcessPortal`).

Behaviour as `syncBinders`: pull per game, then push dirty in `MAX_PUSH` batches; LWW by edit time; a `stale` result applies `current`. A 404 from an old portal must leave rows dirty and not fail the rest of `syncOnce` (spec: never lose a session before the Worker deploy).

- [ ] **Step 1:** Tests: a session recorded on device A appears on device B after both sync; hiding on B reaches A; delete on A removes it on B; signing in adopts a signed-out session (owner 0 → user); a portal answering 404 on `sessions-*` leaves the row dirty and the collection still syncs.
- [ ] **Step 2:** Run → FAIL (client and engine have no sessions stream yet).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `tests/main/cloud-sync.test.ts tests/main/cloud-local.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(sessions): sync sessions with the account`.

### Task 7: The session feed

**Files:** Create `src/renderer/src/features/sessions/SessionFeed.tsx`, `SessionBlock.tsx`, `sessionDate.ts`, `tests/renderer/session-feed.test.tsx`.

**Interfaces — Produces:**
```ts
export function SessionFeed(props: {
  sessions: ScanSession[]
  owner: boolean                      // ⋯ menu only when true
  variant: 'phone' | 'desktop'
  onOpenCard: (card: ScanSessionCard) => void
}): React.JSX.Element
export function replaySourceOfSession(s: ScanSession): ReplaySource   // choosePulls over cards; header "<date> · N cards · $total" from createdAt + sessionTotal
export function sessionDate(iso: string, now?: Date): string          // "Today · 9:42 PM", "Yesterday · 8:15 PM", else "Nov 2 · 8:15 PM"
```
Per session: header (date; "hidden" tag when `owner && !friendsVisible`; card count; total in green; `<MakeReplay source variant/>`; owner ⋯ menu with **Hide from friends** / **Show to friends** and **Delete**). Delete asks first: "Delete this session? The cards stay in your collection." Tiles: `CardArt size="small"` with the price under it (or "—"), ×N badge when quantity > 1, gold ring when in `replaySourceOfSession(s).pulls`, dearest first, a button each calling `onOpenCard`. Collapsed to two rows: `columns × 2` tiles then a "+N more" tile that expands; columns from the container width via `ResizeObserver`, 8 when unmeasured. Empty: "No sessions yet. Add cards from the scanner and they show up here." Mutations call `api.sessions.setHidden/delete` and invalidate the list key.

- [ ] **Step 1:** Tests: header shows date, "42 cards", total; tiles ordered dearest first; the replay's pulls (and only they) carry the ring (`data-replay` or an accessible label); 40 cards show 16 tiles + "+24 more", clicking expands to 40; owner sees ⋯ with Hide/Delete, friend doesn't; Delete confirms before calling `api.sessions.delete`; hidden tag only for owner; clicking a tile calls `onOpenCard` with that card; `sessionDate` covers today, yesterday, older; no "night" anywhere in rendered text.
- [ ] **Step 2:** Run `npm test -- tests/renderer/session-feed.test.tsx` → FAIL.
- [ ] **Step 3:** Implement, styled as the approved mock (dark glass, pill buttons, green prices, gold ring).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(sessions): the session feed`.

### Task 8: Where it lives — desktop page and phone sheet

**Files:** Modify `src/renderer/src/components/AppShell.tsx` (`Page` gets `'sessions'`, `NAV` entry `{ page: 'sessions', label: 'Sessions' }` right after Scan, hidden on web like scan/rip), `src/renderer/src/components/pageSwitch.tsx`, `src/renderer/src/App.tsx` if Scan's page is passed there; `src/phone/ScannerScreen.tsx` (history button, `aria-label="Sessions"`, `ROUND` class, placed after Stream at `left-[6.5rem]`, opens the sheet as ReviewSheet does). Create `src/renderer/src/features/sessions/SessionsPage.tsx` (queries `api.sessions.list(game)`, opens `CardSheet`+`CardPanel` as `WishlistPage.tsx:47`), `src/phone/SessionsSheet.tsx` (`useBackHandler(true, onClose)`, same feed, `variant="phone"`). Tests: `tests/renderer/sessions-page.test.tsx`, a phone scanner test if one exists for the top bar.

- [ ] **Step 1:** Tests: the nav lists Sessions after Scan on desktop and not on web; SessionsPage lists the current game's sessions; clicking a tile opens the card sheet; the phone scanner's Sessions button opens the sheet and back closes it.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `ScanPage.tsx` layout is not changed.
- [ ] **Step 4:** Run → PASS; `npm run typecheck` → clean.
- [ ] **Step 5:** Commit `feat(sessions): Sessions page on desktop, sheet on the phone scanner`.

### Task 9: Friend page tab

**Files:** Modify `src/renderer/src/features/friends/FriendHeader.tsx` (`BinderTab` + `'sessions'`, label "Sessions" after Binders, a `showSessions` prop like `showBinders`), `FriendBinder.tsx` (query `api.friends.sessions(friendId, game)` with `retry: false`; tab hidden on error or empty; renders `SessionFeed owner={false}`, tiles open `FriendCardSheet`). Test: `tests/renderer/friend-binder.test.tsx`.

- [ ] **Step 1:** Tests: the Sessions tab shows when the friend has visible sessions and shows their feed without ⋯; hidden when the call fails (old portal) or returns none; Make replay is present.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(friends): a Sessions tab on the friend page`.

### Task 10: Verify

- [ ] `npm run typecheck`, `npm run lint` → clean.
- [ ] All test files touched above → PASS. Full `npm test` and `npm run build` only when the machine isn't under memory pressure; otherwise report them as not run.
- [ ] Real run on desktop (`run` skill): scan or seed a list, Add → a session appears on the Sessions page with tiles and prices; Make replay from it saves a video whose header shows the session's date and whose best caption reads "TOP PULL OF THE SESSION"; hide/delete work; scan page unchanged.
- [ ] Note for the owner: the Worker needs a deploy (`server-38`, routes, RPC) before sessions reach other devices and friends; until then they wait on each device.
