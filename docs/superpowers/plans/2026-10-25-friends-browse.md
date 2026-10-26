# Friends Round 1 (add friends, browse their collections) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can send, accept and ignore friend requests by Discord username, see a friend list, and browse an accepted friend's collection read-only, on the web and on the signed-in desktop app.

**Architecture:** A `friendships` table and friend queries live in the portal Durable Object. They are exposed as new `friends:*` RPC channels on the existing `/api/rpc/:channel` route, which already accepts both the web session cookie and the desktop Bearer token. The web build calls them through `httpApi`. The desktop main process forwards the same channels through a new `CloudClient.rpc` call via the account service. The shared renderer gets a Friends page and a read-only friend mode of `CollectionPage`.

**Tech Stack:** TypeScript, Cloudflare Workers + SQLite Durable Object, Electron (main/preload/IPC), React 19 + TanStack Query, Tailwind/shadcn, vitest (+ Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-25-friends-browse-design.md` (parent: `docs/superpowers/specs/2026-10-24-web-portal-sync-friends-design.md`)

## Global Constraints

- Friends never see entry notes: strip them on the server (`notes: ''`), not in the UI.
- Only accepted friends' collections are readable, enforced on the server for every friend read.
- A friend's view has no add/edit/remove/quantity controls and calls no write channel.
- Signed-out desktop is unchanged: no Friends nav item, no friend network calls.
- After sending, the sender sees only "Request sent". There is no outgoing list and no cancel. Ignoring is silent.
- Server migrations are append-only. Add a new `server-3` step; never edit `server-1`/`server-2`.
- Run tests with `npm test -- <path>` (root, already `--maxWorkers=2`). The Worker's own tests use `npm --prefix workers/portal test`. Never run vitest without `--maxWorkers=2`.
- Display name for a user everywhere: `displayName ?? username`.

## Review Focus

- **A non-friend asks for a collection** (stranger, pending requester, ex-friend after unfriend) by guessing a user id. Expect a 400 with no entries. Tested in Task 2.
- **Usernames typed with odd case or surrounding spaces** (`"  Alice "`). Expect the request to find `alice`. Tested in Task 1.
- **Crossed and repeated requests**: B requests A while A→B is pending; re-requesting after ignore or unfriend. Expect auto-accept, and a fresh pending row. Tested in Task 1.
- **A friend's deleted (tombstoned) entries.** Expect them never listed or counted. Tested in Task 2.
- **The desktop token is revoked while the user is on the Friends page.** Expect the account to flip to signed-out with `SERVER_SIGNED_OUT`. Tested in Task 3.
- **Your own collection after viewing a friend's.** Expect only your own cards, with no shared cache entries. Tested in Task 5.

---

### Task 1: Friendships table and friend queries (server)

**Files:**
- Modify: `workers/portal/src/migrate.ts` (append `server-3` to `SERVER_STEPS`)
- Create: `workers/portal/src/friends.ts`
- Modify: `src/shared/types.ts` (add friend types)
- Test: `tests/portal/friends.test.ts`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  ```ts
  export interface FriendUser { id: number; username: string; displayName: string | null; avatarUrl: string | null }
  export interface Friend extends FriendUser {
    /** Copies across live entries (sum of quantity). */
    cardCount: number
    /** Latest change to any of their entries, tombstones included; null with none. */
    updatedAt: string | null
  }
  export interface FriendRequest extends FriendUser { sentAt: string }
  export interface FriendsOverview { friends: Friend[]; incoming: FriendRequest[] }
  export type FriendRequestResult = { status: 'sent' } | { status: 'accepted'; friend: FriendUser }
  ```
- Produces, in `workers/portal/src/friends.ts` (all take the caller's user id `me`):
  ```ts
  export class FriendError extends CollectionError {}   // so rpc.ts's existing catch answers 400
  export function friendsOverview(db: SqlDb, me: number): FriendsOverview
  export function requestFriend(db: SqlDb, me: number, username: string, now: Date): FriendRequestResult
  export function acceptFriend(db: SqlDb, me: number, requesterId: number, now: Date): void
  export function ignoreFriend(db: SqlDb, me: number, requesterId: number): void
  export function removeFriend(db: SqlDb, me: number, friendId: number): void
  export function areFriends(db: SqlDb, me: number, other: number): boolean
  ```

- [ ] **Step 1: Write the failing tests** in `tests/portal/friends.test.ts`. Use `seededServerDb()` and `addUser()` from `tests/portal/helpers.ts`, with alice, bob and carol, and `NOW = new Date('2026-10-25T12:00:00.000Z')`.
  - `requestFriend(db, alice, '  BOB ', NOW)` → `{ status: 'sent' }`. `friendsOverview(db, bob).incoming` has one item `{ id: alice, username: 'alice', sentAt: NOW.toISOString() }`. `friendsOverview(db, alice)` is `{ friends: [], incoming: [] }`.
  - Sending the same request again → `{ status: 'sent' }`, and bob still has exactly one incoming request.
  - Crossed request: alice→bob is pending and bob requests `'alice'` → `{ status: 'accepted', friend: { id: alice, username: 'alice', ... } }`. Both overviews then list each other in `friends`, and neither has incoming requests.
  - `acceptFriend(db, bob, alice, NOW)`: both sides list the other as a friend. Accepting with no pending request throws `FriendError`.
  - `ignoreFriend(db, bob, alice)` removes the request. Alice's overview is unchanged. Alice can request again and bob sees it again.
  - `removeFriend(db, alice, bob)` and `removeFriend(db, bob, alice)` each end the friendship for both sides. `areFriends` goes from `true` to `false`.
  - These throw `FriendError` with exact messages:
    - Unknown username: `No Duel Binder user called "zed"`
    - Requesting yourself: `That's you`
    - Requesting a current friend: `You're already friends with bob`
    - Blank username: `Enter a Discord username`
  - `areFriends` is `false` while a request is only pending, in either direction.
  - Friend fields: give bob two live entries (quantities 2 and 3, added with `addEntry(db, …, userScope(bob))`) and one removed entry. `friends[0]` then has `cardCount: 5`, and `updatedAt` equals the latest `updated_at` among all three rows. A friend with no entries has `cardCount: 0, updatedAt: null`.
  - `avatarUrl` is `https://cdn.discordapp.com/avatars/<discord_id>/<avatar>.png` when `avatar` is set, else `null`.
  - The friends list is sorted by display name (case-insensitive). Incoming requests are sorted newest first.

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `npm test -- tests/portal/friends.test.ts`
  Expected: FAIL (cannot resolve `workers/portal/src/friends`).

- [ ] **Step 3: Add the migration step `server-3`**
  ```sql
  CREATE TABLE friendships (
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id));
  CREATE INDEX ix_friendships_addressee ON friendships(addressee_id, status);
  ```
  At most one row exists per pair, in either direction; `requestFriend` keeps it that way.
  Add a case to `tests/portal/migrate.test.ts` only if that file asserts the step list or names.

- [ ] **Step 4: Implement `workers/portal/src/friends.ts`**
  - Look usernames up with `trim()`, using `WHERE username = ? COLLATE NOCASE`.
  - `requestFriend` order:
    1. blank
    2. unknown
    3. self
    4. an accepted row either way → already friends
    5. a pending row from them → accept it and return `accepted`
    6. a pending row from me → `sent`
    7. otherwise insert pending → `sent`
  - Ignore, unfriend and accept-on-cross delete or update the single pair row.
  - Move the avatar URL expression in `auth.ts` `me()` (`auth.ts:416-418`) into an exported `avatarUrl(discordId: string, avatar: string | null): string | null` in `auth.ts`, and use it in both places.
  - `cardCount`/`updatedAt` come from one `LEFT JOIN`/subquery over `collection_entries` per friend:
    - `cardCount` is `SUM(quantity)` over rows with `deleted_at IS NULL`, else 0.
    - `updatedAt` is `MAX(updated_at)` over all rows.

- [ ] **Step 5: Run the tests and confirm they pass**
  Run: `npm test -- tests/portal/friends.test.ts tests/portal/migrate.test.ts tests/portal/auth.test.ts`
  Expected: PASS

- [ ] **Step 6: Commit**
  ```bash
  git add workers/portal/src/migrate.ts workers/portal/src/friends.ts workers/portal/src/auth.ts src/shared/types.ts tests/portal/friends.test.ts
  git commit -m "feat(friends): friendships table and friend queries"
  ```

---

### Task 2: `friends:*` channels on the API, RPC and web client

**Files:**
- Modify: `src/shared/ipc.ts` (add the `friends` namespace to `Api` and its channels to `INVOKE_CHANNELS`)
- Modify: `src/shared/portal.ts` (add the channels to `PORTAL_CHANNELS`)
- Create: `src/shared/friends.ts` (`OFFLINE_MESSAGE`)
- Modify: `workers/portal/src/rpc.ts`
- Modify: `src/renderer/src/web/httpApi.ts`
- Modify: `tests/renderer/mockApi.ts` (default `friends` mocks)
- Modify: `src/main/ipc/handlers.ts` (stub entries so the build stays green; Task 3 replaces them)
- Test: `tests/portal/friends-rpc.test.ts`, `tests/renderer/http-api.test.ts`

**Interfaces:**
- Consumes: Task 1's functions and types.
- Produces, on `Api`:
  ```ts
  friends: {
    overview(): Promise<FriendsOverview>
    request(username: string): Promise<FriendRequestResult>
    accept(userId: number): Promise<void>
    ignore(userId: number): Promise<void>
    remove(userId: number): Promise<void>
    /** An accepted friend's live entries, notes always ''. */
    collection(userId: number, f: CollectionFilters): Promise<EntryView[]>
    facets(userId: number): Promise<Facets>
  }
  ```
  - Channels: `'friends:overview'`, `'friends:request'`, `'friends:accept'`, `'friends:ignore'`, `'friends:remove'`, `'friends:collection'`, `'friends:facets'`.
  - `src/shared/friends.ts`: `export const OFFLINE_MESSAGE = 'Could not reach Duel Binder. Check your connection and try again.'`. `httpApi`'s network-failure throw uses this constant instead of its literal.
- RPC handler context: change `Handler`'s first parameter in `rpc.ts` to `RpcDeps = AppDeps & { userId: number }`, and pass `{ ...deps, userId: user.id }` from `rpcRoute`. Existing handlers are unchanged apart from the type.

- [ ] **Step 1: Write the failing tests** in `tests/portal/friends-rpc.test.ts`. Copy the `deps`/`sessionFor`/`rpc` setup from `tests/portal/rpc.test.ts`.
  - `friends:request` `['bob']` as alice → 200 with `{ result: { status: 'sent' } }`. `friends:overview` as bob → its `incoming[0].username` is `'alice'`.
  - `friends:accept` `[alice]` as bob, then `friends:overview` as alice → `friends[0].username === 'bob'`.
  - After friendship, bob has an entry with `notes: 'secret'` and one removed entry. `friends:collection` `[bob, { sort: 'added', dir: 'desc' }]` as alice returns one entry with `notes === ''`. `friends:facets` `[bob]` as alice → 200.
  - Non-friend reads: carol (stranger), alice while her request is only pending, and alice after `friends:remove` each call `friends:collection` `[bob, {…}]` → status 400 with body `{ error: "You aren't friends with this user" }`. Same for `friends:facets`.
  - `friends:request` `['zed']` → 400 with body `{ error: 'No Duel Binder user called "zed"' }`.
  - `friends:collection` `['x', {}]` → 400 (bad id, from `checkId`).
  - No cookie → 401 (existing behaviour, assert once).
  - A Bearer desktop token works too: insert a session with `kind: 'desktop'` (follow `tests/portal/desktop-auth.test.ts`) and call `friends:overview` with `authorization: Bearer <token>` → 200.

  In `tests/renderer/http-api.test.ts`, the loop over `PORTAL_CHANNELS` already covers the new channels. Run it to confirm.

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `npm test -- tests/portal/friends-rpc.test.ts`
  Expected: FAIL, 404 `unknown-channel`.

- [ ] **Step 3: Implement**
  - Add the handlers to `HANDLERS`:
    - Check ids with `checkId`, the username with `checkString`, and filters as `collection:list` does.
    - `friends:collection`/`friends:facets` throw `new FriendError("You aren't friends with this user")` unless `areFriends(db, userId, friend)`.
    - Then call `listEntries`/`getFacets` with `userScope(friend)`, and map entries to `{ ...e, notes: '' }`.
    - Write handlers pass `now()`.
  - Add the `friends` block to `httpApi` with `call(...)`.
  - Add `friends` defaults to `createMockApi`:
    - `overview` resolves `{ friends: [], incoming: [] }`
    - `request` resolves `{ status: 'sent' }`
    - `collection` resolves `[]`
    - `facets` resolves the same empty facets as `collection.facets`
    - the rest resolve `undefined`
  - In `src/main/ipc/handlers.ts`, add temporary entries that reject with `new Error('Not implemented')` so `Handlers` typechecks.

- [ ] **Step 4: Run the tests and confirm they pass**
  Run: `npm test -- tests/portal/friends-rpc.test.ts tests/portal/rpc.test.ts tests/portal/rpc-write.test.ts tests/renderer/http-api.test.ts && npm run typecheck`
  Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**
  ```bash
  git add src/shared workers/portal/src/rpc.ts src/renderer/src/web/httpApi.ts src/main/ipc/handlers.ts tests/renderer/mockApi.ts tests/portal/friends-rpc.test.ts
  git commit -m "feat(friends): friends RPC channels for web and desktop"
  ```

---

### Task 3: Desktop forwards `friends:*` through the account

**Files:**
- Modify: `src/main/cloud/client.ts` (add `rpc` to `CloudClient`)
- Modify: `src/main/cloud/account.ts` (add `portal` to `AccountService`)
- Modify: `src/main/ipc/handlers.ts` (real `friends:*` handlers)
- Test: `tests/main/cloud-account.test.ts`, plus a client case next to the existing `CloudClient` tests (find them with `grep -l createCloudClient tests/main`), and `tests/main/handlers.test.ts`

**Interfaces:**
- Consumes: `PortalChannel` (`src/shared/portal.ts`), `OFFLINE_MESSAGE` (`src/shared/friends.ts`), Task 2's `Api.friends`.
- Produces:
  ```ts
  // CloudClient
  rpc<T>(channel: PortalChannel, args: unknown[]): Promise<T>   // POST /api/rpc/<channel> { args } → body.result
  // AccountService
  /** Calls a portal channel as the signed-in account. Rejects with Error(FRIENDS_SIGNED_OUT) when signed out,
   *  Error(OFFLINE_MESSAGE) when offline, Error(SERVER_SIGNED_OUT) after a 401 (and signs the account out). */
  portal<T>(channel: PortalChannel, args: unknown[]): Promise<T>
  ```
  - `src/shared/friends.ts` gains `export const FRIENDS_SIGNED_OUT = 'Sign in from Settings to see friends.'`.

- [ ] **Step 1: Write the failing tests**
  - Client: `rpc('friends:overview', [])` posts to `<base>/api/rpc/friends:overview`, with the Bearer header and body `{"args":[]}`, and resolves `result`. A 400 `{ error: 'x' }` rejects with message `'x'`. Existing 401/5xx mapping applies.
  - Account, using the existing fakes in `tests/main/cloudHelpers.ts`:
    - Signed out → `portal` rejects with `FRIENDS_SIGNED_OUT` and makes no client call.
    - The client throws `CloudOfflineError` → rejects with `OFFLINE_MESSAGE`, and the status state is unchanged.
    - The client throws `CloudAuthError` → rejects with `SERVER_SIGNED_OUT`, `status().state === 'signed-out'`, `status().error === SERVER_SIGNED_OUT`, and the token is cleared, matching `run()`'s 401 path (`account.ts:156-162`).
  - Handlers:
    - `'friends:collection'(7, f)` calls `account.portal('friends:collection', [7, f])` and returns entries with `originalArt: false`. Printing ids differ between the server and this computer, so desktop must not show printing scans for a friend's entries.
    - `'friends:overview'()` calls `account.portal('friends:overview', [])`.

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `npm test -- tests/main/cloud-account.test.ts tests/main/handlers.test.ts`
  Expected: FAIL (`portal` / `rpc` not defined).

- [ ] **Step 3: Implement.** Factor the 401 sign-out in `run()` into a local `serverSignedOut()` and call it from both `run()` and `portal`. Each handler is a one-line forward to `account.portal`. `friends:collection` maps `originalArt: false`.

- [ ] **Step 4: Run the tests and confirm they pass**
  Run: `npm test -- tests/main && npm run typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/main/cloud src/main/ipc/handlers.ts src/shared/friends.ts tests/main
  git commit -m "feat(friends): desktop calls friend channels through the account"
  ```

---

### Task 4: Friends nav item, badge and Friends page

**Files:**
- Modify: `src/renderer/src/components/AppShell.tsx` (`Page` gains `'friends'`; the nav item and badge)
- Modify: `src/renderer/src/App.tsx` (render `FriendsPage`)
- Modify: `src/renderer/src/lib/api.ts` (query keys)
- Create: `src/renderer/src/lib/friends.ts` (`useFriendsAvailable`, `useFriendsOverview`)
- Create: `src/renderer/src/features/friends/FriendsPage.tsx`
- Create: `src/renderer/src/features/friends/AddFriendForm.tsx`
- Test: `tests/renderer/friends.test.tsx`

**Interfaces:**
- Consumes: `Api.friends`, `Api.account.status/onChange`, `OFFLINE_MESSAGE`, `FRIENDS_SIGNED_OUT`, `formatRelative` (`@/lib/format`).
- Produces:
  ```ts
  // lib/api.ts queryKeys
  friends: ['friends'] as const
  friendEntries: (id: number, f: CollectionFilters) => ['friends', id, 'entries', f] as const
  friendFacets: (id: number) => ['friends', id, 'facets'] as const
  // lib/friends.ts
  /** Web: always. Desktop: when the account status has a user (subscribes to account.onChange). */
  export function useFriendsAvailable(): boolean
  /** The overview query (key queryKeys.friends), enabled only when available, refetched every 60 s. */
  export function useFriendsOverview(): UseQueryResult<FriendsOverview>
  // FriendsPage
  export function FriendsPage(props: { onBackToMine: () => void }): React.JSX.Element
  ```
  - Keep `queryKeys.friends` out of `mutationInvalidationKeys`. Friend accept/ignore/remove/request invalidate `['friends']`.

- [ ] **Step 1: Write the failing tests** in `tests/renderer/friends.test.tsx`, using `createMockApi`/`renderWithProviders`.
  - **Nav:** `AppShell` shows a "Friends" button between "Browse" and "Settings" on web (`window.api.window.platform = 'web'`, the way the existing tests switch `isWeb`; check `tests/renderer/account-desktop.test.tsx`). Desktop signed out → no "Friends" button. Desktop signed in → shown.
  - **Badge:** with two incoming requests, the Friends nav button's accessible name is `Friends, 2 requests`, with a visible `2`. With none, there's no number.
  - **Add friend:** type `bob` in the textbox labelled `Discord username` and click `Send request`.
    - `api.friends.request` is called with `'bob'` and the text `Request sent` appears.
    - When it resolves `{ status: 'accepted', friend: {…displayName: 'Bob'} }`, the text `You're now friends with Bob` appears.
    - When it rejects with `No Duel Binder user called "bob"`, that message shows inline.
    - The button is disabled while the input is blank.
  - **Requests:** an incoming request from `alice` shows `Accept` and `Ignore`. Each calls `accept(id)`/`ignore(id)` and then refetches the overview.
  - **List:** a friend `{ displayName: 'Bob', username: 'bob', cardCount: 42, updatedAt: <2 days ago> }` shows `Bob`, `@bob`, and `42 cards · Updated 2 days ago`. The exact relative text comes from `formatRelative`.
    - `Unfriend` asks `Unfriend Bob?` with `Confirm`/`Cancel`, and `Confirm` calls `remove(id)`.
    - An empty list shows `No friends yet. Add one by their Discord username.`
  - **Offline:** when `overview` rejects with `Error(OFFLINE_MESSAGE)` (or an Electron-wrapped message containing it), the page shows `OFFLINE_MESSAGE` and a `Retry` button that refetches.
  - **Desktop signed out:** if the Friends page is shown while signed out, it shows `FRIENDS_SIGNED_OUT`.

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `npm test -- tests/renderer/friends.test.tsx`
  Expected: FAIL

- [ ] **Step 3: Implement**
  - Match error messages with `message.includes(OFFLINE_MESSAGE)`, since Electron prefixes IPC errors.
  - Friend rows are buttons that set the page's `viewing` friend. Task 5 renders that friend's collection; in this task, leave a placeholder that Task 5 replaces.
  - Request and friend rows show the avatar: a 32px round `<img>` when `avatarUrl` is set, else a round tile with the name's first letter.
  - The nav item's badge is a small pill after the label.
  - App: if the page is `'friends'` and `useFriendsAvailable()` turns false (desktop sign-out), fall back to `'dashboard'`.
  - Clicking the Friends nav item while viewing a friend returns to the list. Remount `FriendsPage` via a key bumped on each navigate to `'friends'`.
  - Match the existing page layout: `space-y-4 p-8`, `PageHeader`, h1 `Friends`.

- [ ] **Step 4: Run the tests and confirm they pass**
  Run: `npm test -- tests/renderer && npm run typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/renderer/src tests/renderer/friends.test.tsx
  git commit -m "feat(friends): friends page with requests, list and nav badge"
  ```

---

### Task 5: Read-only friend collection

**Files:**
- Modify: `src/renderer/src/features/collection/CollectionPage.tsx` (an optional `friend` mode)
- Create: `src/renderer/src/features/friends/FriendEntryPanel.tsx`
- Modify: `src/renderer/src/features/friends/FriendsPage.tsx` (render the friend's collection)
- Test: `tests/renderer/friend-collection.test.tsx`

**Interfaces:**
- Consumes: Task 4's query keys, `Api.friends.collection/facets`, `Friend`.
- Produces:
  ```ts
  // CollectionPage Props gains:
  /** Shows this friend's collection read-only instead of your own. */
  friend?: Friend
  onBackToMine?: () => void
  // FriendEntryPanel.tsx
  export function FriendEntryPanel(props: {
    entry: EntryView        // the selected entry
    copies: EntryView[]     // this card's entries from the friend's loaded list
    onSelectEntry: (id: number) => void
    nav?: PanelNav
  }): React.JSX.Element
  ```

- [ ] **Step 1: Write the failing tests** in `tests/renderer/friend-collection.test.tsx`. Reuse the `card`/`printing`/`entry` builders, copied from `tests/renderer/collection.test.tsx`. `friend = { id: 7, username: 'bob', displayName: 'Bob', avatarUrl: null, cardCount: 3, updatedAt: null }`.
  - **Data source:** `<CollectionPage friend={friend} onBackToMine={fn} />` calls `api.friends.collection(7, filters)` and `api.friends.facets(7)`. It never calls `api.collection.list`, `api.collection.facets` or `api.stats.get`, and it renders the friend's entries.
  - **Header and banner:** the heading is `Bob's collection`, and a banner reads `Viewing Bob's collection`. Clicking its `Back to mine` button calls `onBackToMine`.
  - **No write controls:** no `Add card` button, even when empty. The empty state reads `Bob hasn't added any cards yet`.
  - **Read-only detail panel:** selecting an entry opens it. It shows the card name, a `Their copies` list and the value. It has no `Quantity` field, no `Notes` field, no `Save changes`, no `Remove`, no `Artwork` radio group and no `Printing` select. `api.collection.forCard` is not called.
  - **Filters:** typing in the search filter calls `api.friends.collection(7, expect.objectContaining({ q: … }))`.
  - **Cache isolation (Review Focus):** render the friend page, then unmount it and render `<CollectionPage />` in the same `QueryClient`. The own page shows `api.collection.list`'s entries only, and the friend's entry names are absent.
  - **Through FriendsPage:** clicking a friend row renders `Bob's collection`, and `Back to mine` calls `FriendsPage`'s `onBackToMine`.

- [ ] **Step 2: Run the tests and confirm they fail**
  Run: `npm test -- tests/renderer/friend-collection.test.tsx`
  Expected: FAIL

- [ ] **Step 3: Implement**
  - In friend mode, `CollectionPage`:
    - swaps its query keys and functions to `queryKeys.friendEntries`/`friendFacets` and `api.friends.*`, and disables the stats query;
    - shows `{n} entries` and drops the "Prices updated" clause in the subtitle;
    - takes `hiddenByLanguage` from `friend.cardCount > 0` instead of `stats.uniqueCards`;
    - renders `FriendEntryPanel` with `copies = list.filter(e => e.card.id === selected.card.id)` instead of `EntryDetailPanel`.
  - `FriendEntryPanel`:
    - reuses `PanelCardArt` (`printingId={scanFor(entry)}`), `CardDetails card={entry.card}`, `EntryValue`/`EbayPriceLine`, and the copies-list markup from `EntryDetailPanel.tsx:248-273`, headed `Their copies`;
    - fetches nothing.
  - Put the banner directly under the `PageHeader`: muted text `Viewing Bob's collection` and an outline `Back to mine` button.
  - The own-collection code path stays byte-for-byte behaviourally the same; the existing `tests/renderer/collection.test.tsx` must still pass.

- [ ] **Step 4: Run the tests and confirm they pass**
  Run: `npm test -- tests/renderer && npm run typecheck && npm run lint`
  Expected: PASS

- [ ] **Step 5: Full verification**
  Run: `npm test && npm --prefix workers/portal test && npm --prefix workers/portal run typecheck && npm run build:web`
  Expected: all green. The web build succeeds; the chunk-size warning is pre-existing.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src tests/renderer/friend-collection.test.tsx
  git commit -m "feat(friends): browse a friend's collection read-only"
  ```

---

## Deploy note (for the owner, not a task)

`server-3` only adds a table, so a Worker rollback after it is harmless. Deploy the Worker before releasing a desktop build that shows Friends. Older desktop builds are unaffected.
