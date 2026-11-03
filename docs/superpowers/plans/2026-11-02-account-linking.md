# Duel Binder accounts and account linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounts own their username and any number of sign-in methods (one per provider), and linking a sign-in that already has an account merges the two under the person's chosen card rule.

**Architecture:** The Worker gets a `sign_ins` table that replaces `users.discord_id` as the sign-in lookup (`discord_id` stays as a derived legacy column so avatars, stats and old code keep working). Linking produces a verified identity, then either attaches it or issues a short-lived merge ticket with a preview computed by the same planner that performs the merge. A merge copies the closed account's data into the survivor (fresh sync seqs), moves its sign-ins, revokes its sessions and leaves its own rows untouched under a closed user for 30 days. Clients learn about merges through `Me.mergedFrom` and move their unsent rows to the survivor.

**Tech Stack:** Cloudflare Worker + Durable Object SQLite (`workers/portal`), better-sqlite3 + vitest tests in `tests/portal`, Electron main (`src/main/cloud`), React renderer shared by desktop, web portal and phone (`src/renderer`, `src/phone`), Capacitor iOS/Android plugins.

**Spec:** `docs/superpowers/specs/2026-11-02-account-linking-design.md`

## Global Constraints

- Usernames when chosen or changed: 3–20 characters; letters, digits, `_` and `-`; unique ignoring case. Existing names that break the rules are kept until changed.
- At most one sign-in per provider per account. Providers: `discord`, `apple` (the CHECK also allows `email`, `google` for later projects).
- Apple sign-in and Apple linking exist only in the iPhone app (`APP_PLATFORM === 'ios'`). Discord is everywhere.
- Card choice values: `'higher' | 'mine' | 'theirs' | 'sum'`, `'higher'` pre-selected. "Mine" = the signed-in (surviving) account.
- Closed account data is held 30 days, then deleted. The undo is owner-only on `/admin`.
- Old clients must keep working: the `/auth/*` endpoints, the sync endpoints and the `/api/me` shape stay the same, and new `Me` fields are optional.
- DO SQLite: no compound query of ~10 terms; one query per table.
- The Worker deploy is one-way and needs owner approval; this plan never deploys.
- Tests: `npm test -- <paths>` (vitest, `--maxWorkers=2` already set). Never build 100k+ row test data.
- Never lose cards: every merge path has a test that counts cards before and after, against the preview's totals.

## Rulings made while planning (from reading the code)

- **Link UI scope.** Desktop, web portal and Android sign in with Discord only, so every account signed in there already has Discord, and nothing is linkable on those platforms in this project. Settings → Sign-in methods appears everywhere (list, Remove, username). The Link buttons, link flows and merge screen are built only in `src/phone`, where only iOS can show them. Web/desktop link flows arrive with email and Google.
  - Cost if wrong: one more flow to add later.
- **Merge copies, it doesn't move.** Closed-account rows stay untouched under the closed user; that copy *is* the 30-day hold, so undo only reopens the closed account. Friendships and blocks are the exception: they move, because friends must not see two people. Undo doesn't restore them.
- **Collection rows get new uids when copied**, because `collection_entries.uid` is globally unique. Binders, binder edits, wishlist and favourites keep their natural keys (`uid`/`pkey`/`card_id`, which are per user), so offline pushes from the closed account's devices land on the copied rows.
- **Offline deletions of collection cards** made on a closed account's device are not carried over. Its dirty tombstones are dropped on re-own, which errs towards keeping cards.
- **Value history:** the closed account's snapshots are ignored. The survivor records a fresh snapshot per game after the merge.
- **Username in a merge with "keep theirs":** the closed row is renamed `merged-<closedId>` and its name moves to the survivor. The survivor's old name is freed at once.

## Review Focus

1. **A merge of two large collections (thousands of entries each) inside one DO request.** It should finish, not time out halfway. Benchmark with a standalone ≤50k-row script, not in vitest; see Task 4 Step 6.
2. **The same card in both accounts at different arts or printings.** It is not a "both" card and must be kept from both sides under `higher` and `sum`. Task 4's test `keeps different arts of one card apart`.
3. **A device on the closed account that is offline during the merge.** When it comes back, its old-session 401 signs it out. On the next sign-in, its unsent edits reach the merged account, and its unchanged rows don't come back as duplicates. Task 6's `adoptMergedData` tests.
4. **The account doing the link already has the provider the other account brings** (e.g. other account = Discord2 + Apple, mine = Discord1). This must refuse, not leave two Discords. Task 3's `refuses a merge that would give two Discord sign-ins`.
5. **A merge ticket replayed after the other account changed** (e.g. it merged elsewhere, or its Apple sign-in was removed). This must fail cleanly. Task 4's `rejects a stale ticket`.

---

### Task 1: Sign-in methods table, legacy `discord_id`, usernames that stay put

**Files:**
- Modify: `workers/portal/src/migrate.ts` (append step `server-30`)
- Create: `workers/portal/src/signIns.ts`
- Modify: `workers/portal/src/auth.ts` (replace `upsertUser`; Apple branch of `exchangeAppleToken`; `isAdminUser`; `loadMe`)
- Modify: `workers/portal/src/stats.ts:33` (Apple/Discord counts from `sign_ins`)
- Modify: `src/shared/cloud.ts` (`Me`)
- Test: `tests/portal/sign-ins.test.ts` (new), `tests/portal/migrate.test.ts`, `tests/portal/auth.test.ts`, `tests/portal/apple-auth.test.ts`

**Interfaces:**
- Produces, in `signIns.ts`:
  - `type Provider = 'discord' | 'apple'`
  - `interface Identity { provider: Provider; subject: string }`
  - `interface DiscordProfile { username: string; displayName: string | null; avatar: string | null }`
  - `findAccount(db, id: Identity): number | null` (skips closed users)
  - `createAccount(db, id: Identity, profile: { username?: string; displayName: string | null; avatar: string | null }, nowIso): number`. It uses `profile.username` when it passes `isValidUsername` and is free, else `generatedUsername(db)`. It sets `username_chosen = 0`, `link_hint = 1`, inserts the sign-in and refreshes the legacy id.
  - `signInWith(db, id: Identity, profile, nowIso): { userId: number; created: boolean }`. An existing account updates only `display_name`/`avatar` (Discord profile only; Apple keeps `COALESCE(display_name, ?)`). A new one goes through `createAccount`.
  - `refreshLegacyDiscordId(db, userId): void`. Sets `users.discord_id` to the Discord subject if the account has one, else `'apple:' + sub`, else `'user:' + userId`.
  - `isValidUsername(name: string): boolean`, matching `/^[A-Za-z0-9_-]{3,20}$/`
  - `generatedUsername(db): string`, moved from `appleUsername` (`duelist-` + 8 characters of `USERNAME_ALPHABET`)
- Produces, in `Me` (`src/shared/cloud.ts`), new optional fields: `usernameChosen?: boolean`, `linkHint?: 'discord' | 'apple' | null`, `mergedFrom?: number[]`. Task 1 fills the first two; Task 4 fills `mergedFrom`.

- [ ] **Step 1: Write the failing tests**

`tests/portal/migrate.test.ts`, new test `server-30 backfills sign-ins from discord_id`:
- Seed users `('123', 'ann')` and `('apple:abc', 'duelist-k3m8qpza')` before `server-30` runs (use the file's existing pattern of running steps up to a name).
- Expect `sign_ins` rows `('discord','123',annId)` and `('apple','abc',appleId)`.
- Expect `username_chosen` to be 1 for ann and 0 for the duelist account.
- Expect `link_hint` 0 for both and `closed_at` null.

`tests/portal/sign-ins.test.ts`:
- `a Discord sign-in no longer overwrites a chosen username`: create via `signInWith` with Discord username `ann`. `UPDATE users SET username='annie', username_chosen=1`. Sign in again with Discord username `ann_new`. Expect username `annie`, display name and avatar updated.
- `a new Discord account takes its Discord username when valid and free, still unchosen`: expect username `bob`, `username_chosen` 0, `link_hint` 1.
- `a new Discord account whose name is taken or invalid gets a generated one`: names `ann` (taken) and `a.b` (invalid) both give `/^duelist-[a-z2-9]{8}$/`.
- `the legacy discord_id follows the sign-ins`: an Apple-only account has `apple:<sub>`. After inserting a Discord sign-in and calling `refreshLegacyDiscordId`, it has the snowflake. After deleting all its sign-ins it has `user:<id>`.
- `findAccount skips closed accounts`: `UPDATE users SET closed_at=…` → null.

`tests/portal/auth.test.ts`, new test `/api/me reports usernameChosen and linkHint`:
- A fresh Discord sign-in gives `usernameChosen: false, linkHint: 'apple'`.
- Once the account has one live collection entry, `linkHint` is `null`.
- After `UPDATE users SET link_hint=0`, `linkHint` is `null`.

`tests/portal/apple-auth.test.ts`, new test `/api/me linkHint suggests Discord for a new Apple account`: `linkHint: 'discord'`. All existing Apple tests must keep passing unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/sign-ins.test.ts tests/portal/migrate.test.ts tests/portal/auth.test.ts tests/portal/apple-auth.test.ts`
Expected: FAIL. `signIns.ts` is missing, the `sign_ins` table doesn't exist, and `usernameChosen` is undefined.

- [ ] **Step 3: Add migration `server-30`**

```sql
CREATE TABLE sign_ins (
  provider TEXT NOT NULL CHECK (provider IN ('discord','apple','email','google')),
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject));
CREATE UNIQUE INDEX ux_sign_ins_user_provider ON sign_ins(user_id, provider);
INSERT INTO sign_ins (provider, subject, user_id, created_at)
  SELECT CASE WHEN discord_id LIKE 'apple:%' THEN 'apple' ELSE 'discord' END,
         CASE WHEN discord_id LIKE 'apple:%' THEN substr(discord_id, 7) ELSE discord_id END,
         id, created_at FROM users;
ALTER TABLE users ADD COLUMN username_chosen INTEGER NOT NULL DEFAULT 1;
UPDATE users SET username_chosen = 0 WHERE username LIKE 'duelist-%';
ALTER TABLE users ADD COLUMN link_hint INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN closed_at TEXT;
```

- [ ] **Step 4: Implement `signIns.ts` and switch `auth.ts` over**

In `auth.ts`:
- Every Discord path (`finishSignIn` web and desktop branches) calls `signInWith(db, {provider:'discord', subject: du.id}, {username: du.username, displayName: du.global_name ?? null, avatar: du.avatar ?? null}, nowIso)`.
- Delete `upsertUser` and its stale-holder rename.
- `exchangeAppleToken` uses `signInWith` with `{provider:'apple', subject: sub}`.
- `isAdminUser` becomes `SELECT 1 FROM sign_ins WHERE user_id = ? AND provider = 'discord' AND subject = ?`.
- `loadMe` adds:
  - `usernameChosen: row.username_chosen === 1`
  - `linkHint`: null unless `link_hint = 1`, the account has no live `collection_entries`, and it has exactly one sign-in. Then `'apple'` if that sign-in is Discord, `'discord'` if it is Apple.

In `stats.ts`, count Apple and Discord accounts from `sign_ins`, excluding closed users.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/portal`
Expected: PASS, the whole portal suite included (friends, sync, account-delete, admin-stats unchanged).

- [ ] **Step 6: Commit**

```bash
git add workers/portal/src/migrate.ts workers/portal/src/signIns.ts workers/portal/src/auth.ts workers/portal/src/stats.ts src/shared/cloud.ts tests/portal
git commit -m "feat(portal): sign-in methods table; usernames no longer follow Discord"
```

---

### Task 2: Account RPCs (username, sign-in list, remove, dismiss hint)

**Files:**
- Create: `workers/portal/src/accountRpc.ts`
- Modify: `workers/portal/src/rpc.ts` (register the handlers; `await` the handler result)
- Modify: `src/shared/portal.ts`, `src/shared/ipc.ts`, `src/shared/account.ts` (new)
- Modify: `workers/portal/src/migrate.ts` (append `server-31`: `account_change_log`)
- Modify: `workers/portal/src/friends.ts:100` (`requestFriend` ignores closed users)
- Test: `tests/portal/account-rpc.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `isValidUsername`, `refreshLegacyDiscordId`, `Provider`.
- Produces, in `src/shared/account.ts`:
  - `type SignInProvider = 'discord' | 'apple'`
  - `interface SignInMethod { provider: SignInProvider; addedAt: string }`
  - `type CardChoice = 'higher' | 'mine' | 'theirs' | 'sum'`
  - `const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/` (the Worker's `isValidUsername` imports it)
  - `usernameProblem(name: string): string | null`, which returns the copy below
- Produces Worker RPC channels, each added to `PORTAL_CHANNELS` and `INVOKE_CHANNELS`, with `Api.account` methods of the same name:
  - `account:signIns()` → `SignInMethod[]`, oldest first
  - `account:setUsername(name)` → `Me`
  - `account:removeSignIn(provider)` → `void`
  - `account:dismissLinkHint()` → `Me`
- Produces in `rpc.ts`: handlers may be async (`const result = (await handler(...)) ?? null`).

Copy (exact):
- Too short or long: `Usernames are 3 to 20 characters`
- Bad characters: `Use letters, numbers, _ and - only`
- Taken: `That username is taken`
- Rate limited: `You've changed your username too often today. Try again tomorrow.`
- Removing the last sign-in: `This is your only way to sign in, so it can't be removed`

- [ ] **Step 1: Write the failing tests** in `tests/portal/account-rpc.test.ts`. They call `handle()` with a Bearer session (the `account-delete.test.ts` pattern) and POST to `/api/rpc/account:*`.
  - `setUsername saves a valid name and marks it chosen`: result `username: 'Ann_2'`, `usernameChosen: true`.
  - `setUsername refuses names that break the rules`: `'ab'`, 21 characters and `'a.b'` give 400 with the copy above.
  - `setUsername refuses a name taken in another case`: another user has `ann`, so `'ANN'` gives 400 `That username is taken`. Setting your own name in a different case (`'Ann'` → `'ANN'`) succeeds.
  - `setUsername allows 5 changes a day`: the 6th within 24 h gives 400 with the rate-limit copy.
  - `signIns lists the account's methods`: a Discord+Apple account gives `[{provider:'discord'},{provider:'apple'}]`, each with `addedAt`.
  - `removeSignIn refuses the last one`: 400 with the exact copy.
  - `removeSignIn of Apple revokes its token and drops apple_tokens`: stub `deps.fetch` for Apple's revoke URL. Expect it called once, the `apple_tokens` row gone, and `users.discord_id` refreshed.
  - `removeSignIn of Discord moves the legacy id to apple:<sub>`.
  - `dismissLinkHint clears the hint`: the returned `Me.linkHint` is `null`.
  - `friend requests can't find a closed account`: a target with `closed_at` set gives the same error as an unknown username.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/account-rpc.test.ts`
Expected: FAIL with 404 `unknown-channel`.

- [ ] **Step 3: Implement**
  - `server-31`: `CREATE TABLE account_change_log (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX ix_account_change_log ON account_change_log(user_id, kind, created_at);`
  - Rate limits use the rolling 24 h window from `friends.ts:121-137`: kind `username` allows 5 per day, kind `link` allows 10 per day (Task 3 uses `link`).
  - `removeSignIn` reads the Apple refresh token before deleting, then calls `revokeAppleToken` after the transaction, logging failures (as `account.ts` does).
  - Throw `CollectionError` for user-facing messages so `rpcRoute` returns 400.

- [ ] **Step 4: Add `Api.account` methods to every client so the build passes**

Each method forwards to the portal channel:
- Desktop `src/main/ipc/handlers.ts`: through `account.portal`. `setUsername` and `dismissLinkHint` then call a new `AccountService.updateUser(me: Me): AccountStatus`, which stores `cloud_user` and emits `account:changed`.
- Web `httpApi.ts`: through rpc. Afterwards, emit the same change that `account.status()` re-reads.
- Phone `src/phone/api.ts`: through `store.portal`. `setUsername`/`dismissLinkHint` then store the returned `Me` with a new store method `updateUser(me)` and `emitAccount()`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- tests/portal tests/main/cloud-account.test.ts tests/renderer/phone-api.test.ts && npm run typecheck`
Expected: PASS, typecheck rc 0.

- [ ] **Step 6: Commit**

```bash
git add workers/portal/src src/shared src/main/ipc/handlers.ts src/main/cloud/account.ts src/renderer/src/web/httpApi.ts src/phone tests/portal/account-rpc.test.ts
git commit -m "feat(portal): username, sign-in list and remove RPCs"
```

---

### Task 3: Starting a link: verified identity → attach, refuse, or merge ticket with preview

**Files:**
- Create: `workers/portal/src/link.ts`, `workers/portal/src/mergePlan.ts`
- Modify: `workers/portal/src/auth.ts` (`startDesktopSignIn` accepts `intent=link`; callback branch writes `link_codes` instead of signing in)
- Modify: `workers/portal/src/migrate.ts` (append `server-32`: `link_codes`, `merge_tickets`)
- Modify: `src/shared/account.ts`, `src/shared/portal.ts`
- Test: `tests/portal/link.test.ts` (new), `tests/portal/merge-plan.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `Identity`, `findAccount`, `refreshLegacyDiscordId`; Task 2 rate-limit helper (kind `link`).
- Produces, in `src/shared/account.ts`:
  ```ts
  interface AccountSummary { username: string; displayName: string | null; avatarUrl: string | null
    cards: number; binders: number; wishes: number }
  interface MergePreview { mine: AccountSummary; theirs: AccountSummary; totals: Record<CardChoice, number> }
  type LinkResult =
    | { status: 'linked' } | { status: 'already' } | { status: 'has-provider' }
    | { status: 'merge'; ticket: string; preview: MergePreview }
  ```
  - `cards` = SUM(quantity) of live entries across all games.
  - `totals[c]` = the survivor's SUM(quantity) after merging with rule `c`.
- Produces, in `mergePlan.ts`:
  - `planCardMerge(db, survivor: number, closed: number, choice: CardChoice): CardOp[]`
  - `CardOp = { kind: 'insert'; from: EntryRow } | { kind: 'update'; id: number; quantity: number; fromUid: string } | { kind: 'tombstone'; id: number }`
  - Keyed by `(printing_id, image_id)` over live rows of both accounts, all games:
    - `higher`: both → update to the max if it differs; closed-only → insert.
    - `sum`: both → update to a+b; closed-only → insert.
    - `mine`: no ops.
    - `theirs`: both → update to theirs if it differs; survivor-only → tombstone; closed-only → insert.
  - `cardTotal(db, survivor, ops): number`
- Produces, in `link.ts`:
  - `beginLink(deps, userId, id: Identity, extra: { profile?: DiscordProfile; appleRefreshToken?: string | null }): LinkResult`
    - Free identity → insert the sign-in, refresh the legacy id, refresh Discord display/avatar if the account's are null, store the Apple token → `linked`.
    - Same account → `already`.
    - Account already has this provider → `has-provider`.
    - Owned by another account that has any provider this account also has → `has-provider`.
    - Otherwise insert a `merge_tickets` row (sha256 of a `randomToken()`, 15 min) → `merge`.
  - The pending Apple refresh token is stored on the ticket row and applied at merge.
- Produces Worker RPC channels in a new `ACCOUNT_LINK_CHANNELS` list. These are not InvokeChannels: `PortalChannel` becomes the union of both lists.
  - `account:linkCode(code, verifier)` → `LinkResult`. Same PKCE check and delete-always rule as `exchangeDesktopCode`, reading `link_codes`.
  - `account:linkApple({ identityToken, nonce, authorizationCode? })` → `LinkResult`. Same verification as `exchangeAppleToken`.
- Produces `GET /auth/desktop/start?...&intent=link`. The callback for a link intent never creates or signs in a user. It writes `link_codes(code_hash, challenge, provider 'discord', subject, profile JSON, expires_at = now + 120 s)` and redirects exactly as today.

- [ ] **Step 1: Write the failing tests**

`tests/portal/merge-plan.test.ts`. Accounts A (survivor) and B. Shared key K has A=3 and B=5. A-only key KA has 2. B-only key KB has 4.
- `higher keeps the larger count and adds the other's cards`: total 3→5 on K, plus KA 2, plus KB 4 = 11.
- `sum adds counts`: 8+2+4 = 14.
- `mine changes nothing`: 5.
- `theirs replaces the collection`: 5+4 = 9, with KA tombstoned.
- `keeps different arts of one card apart`: same printing with a different `image_id` in A and B is two keys under `higher`.
- `cardTotal matches applying the ops` (exercised fully in Task 4).

`tests/portal/link.test.ts`:
- `linkCode attaches a free Discord identity to an Apple-only account`: start with `intent=link`, run the callback with mocked Discord, then `account:linkCode` → `{status:'linked'}`. `sign_ins` now has both. `users.discord_id` is the snowflake. Callback with a link intent creates no `users` row and no session.
- `linkCode answers already for this account's own Discord`.
- `linkCode answers merge with a preview for another account's Discord`: the preview shows both usernames, `cards` sums, and `totals` from the plan.
- `refuses a merge that would give two Discord sign-ins`: other = Discord2+Apple, mine = Discord1, linking Apple → `has-provider`.
- `linkApple attaches a free Apple identity and keeps its refresh token` (reuse the `apple-auth.test.ts` key helpers).
- `link codes expire and work once`: a second use, or one after 120 s, gives 400 `invalid-code`.
- `link attempts are limited to 10 a day`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/link.test.ts tests/portal/merge-plan.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`server-32`:
```sql
CREATE TABLE link_codes (code_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, provider TEXT NOT NULL,
  subject TEXT NOT NULL, profile TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE merge_tickets (ticket_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, subject TEXT NOT NULL, apple_refresh_token TEXT, expires_at TEXT NOT NULL);
```

Prune expired `link_codes` and `merge_tickets` in `pruneExpired`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/portal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/portal/src/link.ts workers/portal/src/mergePlan.ts workers/portal/src/auth.ts workers/portal/src/migrate.ts src/shared tests/portal
git commit -m "feat(portal): link a sign-in, or get a merge preview"
```

---

### Task 4: Performing the merge, the hold, `mergedFrom`, purge

**Files:**
- Create: `workers/portal/src/merge.ts`
- Modify: `workers/portal/src/account.ts` (extract `deleteUserData(db, userId)`; deleting an account also deletes its held merges)
- Modify: `workers/portal/src/auth.ts` (`loadMe.mergedFrom`; `pruneExpired` calls `purgeHolds`)
- Modify: `workers/portal/src/migrate.ts` (append `server-33`: `account_merges`)
- Modify: `src/shared/portal.ts`, `src/shared/ipc.ts` (`account:merge` channel and `Api.account.merge`; desktop and web reject with `Not available here`)
- Test: `tests/portal/merge.test.ts` (new)

**Interfaces:**
- Consumes: Task 3 `planCardMerge`, `cardTotal`, `merge_tickets`; Task 1 `refreshLegacyDiscordId`.
- Produces:
  - `mergeAccounts(db, args: { survivor: number; closed: number; cards: CardChoice; username: 'mine' | 'theirs'; moved: Identity; appleRefreshToken: string | null; now: Date }): void`, run in one transaction.
  - RPC `account:merge(ticket, { cards: CardChoice; username: 'mine' | 'theirs' })` → `Me`.
  - `purgeHolds(db, now: Date): void`.
  - `Me.mergedFrom`: every account id ever merged into this one, transitively, from `account_merges`.

`mergeAccounts` does the following, in order, with every changed or inserted row taking a fresh seq from its table's clock (`NEXT_SEQ`, `NEXT_WISH_SEQ`, … in `scope.ts`):
1. Apply `planCardMerge` ops.
   - Inserts get `crypto.randomUUID()` uids, the source's `created_at`, `updated_at = now`.
   - Updates keep the survivor's notes, or take the closed account's when the survivor's are empty.
2. Wishlist: union by `pkey`, keeping the higher quantity for both.
3. Favourites: union by `card_id`.
4. Binders and binder edits: copy keeping `uid`. A name clash within the same game gets ` (2)`, ` (3)`, …
5. Friendships and blocks: move per the spec's rules (friendship beats pending; block beats friendship; anything between the two accounts disappears). Then delete the closed account's rows.
6. Sign-ins: move all of the closed account's to the survivor, and move `apple_tokens` (or insert `appleRefreshToken`).
7. Username:
   - `'theirs'`: rename closed → `merged-<closedId>`, then survivor → the closed account's old name, `username_chosen = 1`.
   - `'mine'`: the closed account keeps its name, reserved.
8. Delete the closed account's sessions and `desktop_codes`. Set `closed_at`. Call `refreshLegacyDiscordId` for closed, then survivor.
9. Insert `account_merges(closed_id, survivor_id, merged_at, purge_after = now + 30 days, cards, closed_username, moved_sign_ins JSON, moved_apple_token)`.
10. `recordSnapshot` for each game the survivor has entries in.

`server-33`:
```sql
CREATE TABLE account_merges (closed_id INTEGER PRIMARY KEY, survivor_id INTEGER NOT NULL, merged_at TEXT NOT NULL,
  purge_after TEXT NOT NULL, purged_at TEXT, cards TEXT NOT NULL, closed_username TEXT NOT NULL,
  moved_sign_ins TEXT NOT NULL, moved_apple_token INTEGER NOT NULL);
```
No foreign keys: rows outlive the purged user so clients can still map ids.

`purgeHolds` runs `deleteUserData` for each closed user past `purge_after`, then sets `purged_at`.

- [ ] **Step 1: Write the failing tests** in `tests/portal/merge.test.ts`, with the Task 3 fixture.
  - `each card choice leaves exactly the previewed total`: for each of the four choices, `account:merge` gives a survivor live SUM(quantity) equal to `preview.totals[choice]`. The closed account's rows are unchanged.
  - `merged rows reach the survivor's devices`: a `pullSince` from the survivor's pre-merge cursor returns every inserted and updated row, and the tombstones under `theirs`.
  - `wishlist keeps the higher count, favourites union, binders copied with a suffix on clashes`.
  - `friends: pending upgraded, the two accounts' friendship dropped, block wins`.
  - `the closed account's sign-in now opens the survivor, its sessions are gone`: the old Bearer gets 401 on `/api/me`. A Discord sign-in with the moved identity returns the survivor's id.
  - `keeping their username moves it`: survivor `username` = old closed name; closed = `merged-<id>`.
  - `/api/me lists mergedFrom, transitively`: A←B, then C←A gives C `mergedFrom` `[A, B]` (any order).
  - `rejects a stale ticket`: after the other account's Apple sign-in was removed, or past 15 minutes, `account:merge` gives 400 `This link expired. Try linking again.` and changes nothing.
  - `the admin stays admin after merging into an Apple-first account`: a survivor that is Apple-only, with the closed account holding the `ADMIN_DISCORD_ID` Discord sign-in, gets `/api/me` `admin: true`.
  - `holds are purged after 30 days`: at day 31, `pruneExpired` deletes the closed user and its rows, and the `account_merges` row remains with `purged_at`.
  - `deleting the survivor deletes its held accounts too`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/merge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `merge.ts`, the RPC, `mergedFrom`, `purgeHolds`, `deleteUserData`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/portal`
Expected: PASS.

- [ ] **Step 5: Check the queries on real DO SQLite**

Add `workers/portal/test/merge.test.ts` (workerd suite). Run one `mergeAccounts` with the Task 3 fixture via `runInDurableObject`.
Run: `npm --prefix workers/portal test`
Expected: PASS (catches DO-only SQL rejections).

- [ ] **Step 6: Time a large merge**

Write `scripts/bench-merge.ts` (better-sqlite3, two accounts × 20,000 entries, half overlapping; run with `npx tsx`). Report the merge time for `higher`. Expected: well under 5 s. Ledger the number; don't commit data.

- [ ] **Step 7: Commit**

```bash
git add workers/portal tests/portal src/shared scripts/bench-merge.ts
git commit -m "feat(portal): merge two accounts with a 30-day hold"
```

---

### Task 5: Owner undo on `/admin`

**Files:**
- Modify: `workers/portal/src/merge.ts` (`undoMerge`), `workers/portal/src/app.ts` (routes), `workers/portal/src/adminPage.ts` (Merges tab)
- Test: `tests/portal/merge-undo.test.ts` (new), `tests/portal/admin-stats.test.ts` (tab present)

**Interfaces:**
- Produces:
  - `undoMerge(db, closedId: number, now: Date): void`
    - Clears `closed_at`.
    - Restores `closed_username` if free, else a generated name with `username_chosen = 0`.
    - Moves the `moved_sign_ins` identities still on the survivor back, and moves the Apple token back if `moved_apple_token`.
    - Refreshes both legacy ids and deletes the `account_merges` row.
    - Purged holds can't be undone (400 `This merge is past its 30 days`).
  - `GET /admin/merges` → `{ merges: { closedId, survivorId, survivorUsername, closedUsername, mergedAt, purgeAfter, cards }[] }`, unpurged only, newest first.
  - `POST /admin/merges/undo` with JSON `{ closedId }` → 204.
  - Both require `isAdmin(req, deps)` and are otherwise 404. The POST also requires a JSON content type and a public Origin (`fromPublicOrigin`).
- Admin page: add `'merges'` to `TABS`, a nav link and a section listing merges, each with an **Undo** button. The button runs `fetch` with `credentials: 'same-origin'` after `confirm("Undo merge of @closed into @survivor?")`, then reloads the list.

- [ ] **Step 1: Write the failing tests**
  - `undo brings back the closed account with its sign-in and cards`: after a merge, then undo, signing in with the moved identity returns the closed id. Its cards equal the pre-merge set. The survivor keeps the merged cards.
  - `undo when the name was taken gives a generated one`.
  - `undo routes are owner-only`: 404 for a non-admin. A POST without a JSON content type gives 415.
  - `admin page has a Merges tab`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/merge-undo.test.ts tests/portal/admin-stats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/portal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(admin): list recent merges and undo one"
```

---

### Task 6: Clients carry a closed account's unsent changes into the merged one

**Files:**
- Modify: `src/main/cloud/localSync.ts` (`adoptMergedData`)
- Modify: `src/main/cloud/account.ts` (`becomeSignedIn` and the `me()` refresh at ~239 call it)
- Modify: `src/phone/data/store.ts` (`signIn` ~565 and `signedInClient` ~271 call it)
- Test: `tests/main/cloud-local.test.ts`, `tests/main/cloud-account.test.ts`, `tests/renderer/phone-api.test.ts` (or the store's existing test file)

**Interfaces:**
- Consumes: Task 4 `Me.mergedFrom`.
- Produces `adoptMergedData(db, from: number, to: number, now: string): number` (count of collection rows carried), in one transaction:
  - **Collection.** Dirty live rows of `from` get a fresh uid, `owner_id = to`, `updated_at = now`, `dirty = 1`. Dirty tombstones and all non-dirty rows of `from` are deleted.
  - **Wishlist, favourites, binders, binder edits.** Dirty rows move to `to` with `updated_at = now` (`UPDATE OR IGNORE`, then delete what is left of `from`). Non-dirty rows of `from` are deleted.
  - **Cleanup.** `from`'s value snapshots, `sync_pending`, `sync_issues`, `cloud_accounts` and `cloud_game_cursors` rows are deleted.
- Callers run it for each id in `me.mergedFrom ?? []` that has local rows, before `setActiveOwner(to)`, then trigger a sync.

- [ ] **Step 1: Write the failing tests**
  - `carries unsent edits into the merged account with fresh uids`: owner 7 has a dirty live row (qty 4) and a clean row. `adoptMergedData(db, 7, 9, NOW)` gives one owner-9 row with a new uid, qty 4, `dirty = 1`, `updated_at = NOW`, and no owner-7 rows.
  - `drops unsent deletions and clean rows`.
  - `moves unsent wishes, favourites and binders keeping their keys`.
  - Desktop `signing in to a merged account adopts the old owner's unsent rows`: the fake client's `/auth/desktop/token` returns `Me { id: 9, mergedFrom: [7] }` while the active owner is 7. Afterwards the active owner is 9, owner 7 has no rows, and the next push sends the carried row.
  - Phone, the same through `store.signIn`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/main/cloud-local.test.ts tests/main/cloud-account.test.ts tests/renderer/phone-api.test.ts`
Expected: FAIL (`adoptMergedData` missing).

- [ ] **Step 3: Implement and call it from both clients**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/main tests/renderer/phone-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(sync): carry a merged account's unsent changes over"
```

---

### Task 7: Username prompt, Sign-in methods, link hint (desktop, web, phone)

**Files:**
- Create: `src/renderer/src/features/account/UsernameDialog.tsx`, `src/renderer/src/features/account/UsernamePrompt.tsx`, `src/renderer/src/features/settings/SignInMethods.tsx`, `src/renderer/src/features/account/LinkHint.tsx`
- Modify: `src/renderer/src/features/settings/AccountSection.tsx` (desktop and web), `src/phone/Settings.tsx`, `src/renderer/src/App.tsx`, `src/phone/PhoneShell.tsx`
- Test: `tests/renderer/account-linking.test.tsx` (new)

**Interfaces:**
- Consumes: Task 2 `Api.account.signIns / setUsername / removeSignIn / dismissLinkHint`, `usernameProblem`; Task 1 `Me.usernameChosen`, `Me.linkHint`.
- Produces:
  - `UsernameDialog({ user: Me; open: boolean; onClose(): void; onSaved(me: Me): void })`. The input is pre-filled with `user.username` unless it matches `/^duelist-/`. `usernameProblem` shows inline before saving; server errors show inline. Buttons are **Save** and **Not now**.
  - `UsernamePrompt({ user: Me | null })`. Opens `UsernameDialog` once per app run when `user.usernameChosen === false`; **Not now** closes it until the next launch. It is mounted in the renderer `App` (signed-in branch) and in `PhoneShell`.
  - `SignInMethods({ linkable?: SignInProvider[]; onLink?(p: SignInProvider): void })`.
    - Shows "Username: @name" with **Change** (opens `UsernameDialog`).
    - Lists the methods as "Discord" / "Apple", each with **Remove**, disabled with a title of the exact Task 2 copy when only one is left. Remove asks for confirmation first: `Remove Apple sign-in? You won't be able to sign in with Apple until you link it again.`
    - Shows a **Link Discord** / **Link Apple** button for each `linkable` provider.
    - Desktop and web pass no `linkable`; the phone passes Task 8's list.
  - `LinkHint({ user: Me | null })`. Shown when `user.linkHint` is set, with a × button that calls `dismissLinkHint`. Copy:
    - `'discord'`: `Already use Duel Binder with Discord? Link it in Settings.`
    - `'apple'` on iOS: `Already use Duel Binder with Apple? Link it in Settings.`
    - `'apple'` elsewhere: `Used Duel Binder with Apple on iPhone? Link it from Settings on your iPhone.`
    - Mounted at the top of the renderer `App` content and in `PhoneShell` next to `UpdateBanner`.

- [ ] **Step 1: Write the failing tests** (Testing Library, fake `window.api` as `settings.test.tsx` does)
  - `prompts an unchosen username once and saves it`: `usernameChosen: false` opens the dialog; typing `Ann_2` and pressing Save calls `setUsername('Ann_2')`.
  - `doesn't prompt a chosen username`.
  - `Not now closes the prompt until the next launch`: a re-render in the same mount doesn't reopen it.
  - `shows the rule problem before saving`: `a.b` shows `Use letters, numbers, _ and - only`, and Save is disabled.
  - `pre-fills a real name but not a generated one`.
  - `lists sign-in methods and blocks removing the last`.
  - `removing asks first, then calls removeSignIn`.
  - `the link hint shows the right copy and dismisses`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/renderer/account-linking.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**, following the existing dialog and settings patterns (shadcn `Dialog`, the existing Settings row components). On the phone, register back with `useBackHandler` while the dialog is open (an open Radix dialog already gets Escape).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(account): username prompt, sign-in methods, link hint"
```

---

### Task 8: Linking and the merge screen in the phone app

**Files:**
- Modify: `src/phone/nativeSignIn.ts` (`intent` option), `src/phone/Settings.tsx`, `src/phone/data/store.ts` or `src/phone/api.ts` (link calls)
- Create: `src/renderer/src/features/account/MergeDialog.tsx`, `src/phone/linking.ts`
- Test: `tests/renderer/phone-native-signin.test.ts`, `tests/renderer/phone-linking.test.tsx` (new)

**Interfaces:**
- Consumes: Task 3 `LinkResult`, `MergePreview`, channels `account:linkCode` and `account:linkApple`; Task 4 `account:merge`; Task 7 `SignInMethods`.
- Produces:
  - `nativeSignIn({ app, intent?: 'link' })`. With `intent: 'link'` the start URL gets `&intent=link`, and it returns `{ code, verifier }` instead of trading them for a token.
  - `linkableProviders(platform: 'web' | 'ios' | 'android', methods: SignInMethod[]): SignInProvider[]`. Returns `discord` when it's missing on a native platform, and `apple` when it's missing and the platform is `ios`.
  - `linkSignIn(provider, deps): Promise<LinkResult>`, in `src/phone/linking.ts`.
    - Discord: `nativeSignIn` with the link intent, then `store.portal('account:linkCode', [code, verifier])`.
    - Apple: `appleSignIn`'s plugin step, then `store.portal('account:linkApple', [{ identityToken, nonce, authorizationCode }])`.
    - A cancelled sheet resolves to null.
  - `MergeDialog({ preview: MergePreview; onMerge(choice: { cards: CardChoice; username: 'mine' | 'theirs' }): Promise<void>; onCancel(): void })`.
    - Shows both accounts (avatar, `@username`, cards, binders, wishlist).
    - Card radio, `higher` pre-selected, each option labelled with its resulting total:
      - `Keep the higher count (N cards)`
      - `Keep only @mine's cards (N cards)`
      - `Keep only @theirs's cards (N cards)`
      - `Add them together (N cards)`
    - Under the two "only" options: `@other's cards won't be kept.`
    - Username radio: `@mine` / `@theirs`, default `@mine`.
    - Note: `Let your other devices sync first. Devices signed in as @theirs will be signed out; sign in again to see the merged account.`
    - Buttons: **Merge accounts** / **Cancel**.
  - Result copy in phone Settings:
    - `linked`: toast `Discord linked` / `Apple linked`.
    - `already`: `That Discord account is already linked here`.
    - `has-provider`: `This account already has a Discord sign-in, so that one can't be added` (or the Apple equivalent).
  - After a successful merge, store the returned `Me` (`store.updateUser`), then `syncNow()`.

- [ ] **Step 1: Write the failing tests**
  - `nativeSignIn with a link intent returns the code and verifier`: the start URL contains `intent=link`, and no `/auth/desktop/token` call is made.
  - `linkableProviders offers Apple only on iOS`.
  - `linking a free Discord shows Discord linked and refreshes the list`.
  - `a merge result opens the merge screen with higher pre-selected and the right totals`.
  - `choosing keep theirs warns that this account's cards won't be kept, and merging sends the choice`: `account:merge` is called with `[ticket, { cards: 'theirs', username: 'mine' }]`, then `syncNow` runs.
  - `a cancelled sign-in sheet does nothing`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/renderer/phone-native-signin.test.ts tests/renderer/phone-linking.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the full suite, typecheck and lint**

Run: `npm test > /tmp/linking-suite.txt 2>&1; tail -5 /tmp/linking-suite.txt && npm run typecheck && npx eslint src workers/portal/src tests`
Expected: all pass, typecheck rc 0, no new lint errors.

- [ ] **Step 5: Build the phone bundles**

Run: `npx cross-env NODE_ENV=production vite build --config vite.phone.config.ts --mode ios && npx cross-env NODE_ENV=production vite build --config vite.phone.config.ts --mode android` (web bundles only; no `cap sync`)
Expected: build succeeds. Native plugin code is unchanged; the iOS app needs no Swift change, because `appleSignIn` and `start` already exist.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(phone): link Discord or Apple and merge accounts"
```

---

## Hand-off (after the final review)

These are owner steps, not tasks:
- Approve the Worker deploy. Migrations `server-30`…`server-33` run on first request.
- On an iPhone build: Apple-only account → Link Discord → merge (each card choice once on test accounts). Discord account → Link Apple. Check that the closed account's other device signs out and comes back merged.
- Release the clients. The username prompt and Sign-in methods appear on desktop, web and phone.
