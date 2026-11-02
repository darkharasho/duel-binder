# Duel Binder accounts and account linking — design

Date: 2026-11-02. Project 1 of 3 (then email + password sign-in, then Google sign-in).

## Why

People who signed in with Apple on their iPhone and with Discord elsewhere have two
separate accounts, each showing half their stuff. Some have cards saved in both. Today an
account *is* a Discord account (`users.discord_id`); Apple accounts are squeezed in as
`discord_id = 'apple:<sub>'` with a random `duelist-xxxxxxxx` username. Every Discord
sign-in overwrites the username with the current Discord username.

The fix: a Duel Binder account that belongs to Duel Binder, with its own username, and
sign-in methods (Discord, Apple; later email and Google) attached to it. Linking adds
another way into the same account, and merges in the other account's contents if the new
sign-in already had one.

## Goals

- Every account has a Duel Binder username. Friends find people by it; no sign-in
  changes it.
- An account can have several sign-in methods; any of them opens the same account.
- Linking a sign-in that already has its own account merges the two, under the person's
  choice of how card counts combine.
- Existing users keep everything, with as little disruption as possible.
- The account model is ready for email + password and Google to attach later without
  another restructuring.

## Non-goals

- Email + password sign-in (project 2) and Google sign-in (project 3). This project only
  has to leave room for them.
- Sign in with Apple on the web portal or desktop app. Apple stays iPhone-app only; an
  Apple user links Discord from the iPhone app, a Discord user links Apple from their
  iPhone.
- A user-facing "undo merge" button.

## Anti-goals

- **Losing cards.** A merge must never silently drop a card. Whatever the chosen rule, the
  result must be exactly what the merge screen said it would be.
- Nagging existing Discord users with a username prompt they don't need.
- A sign-in method attached to two accounts at once, or an account left with no way in.

## Usernames

- Rules (my call): 3–20 characters; letters, digits, `_` and `-`; unique ignoring case;
  first come, first served. Changeable in settings, subject to the same rules.
- Discord sign-in no longer writes `username`. Display name and avatar from Discord may
  keep refreshing as today (my call); the username never does.
- Existing users:
  - Discord users keep their current username silently. Existing usernames that don't
    meet the new rules (e.g. Discord names with `.`, or over 20 characters) are kept as
    they are; the rules apply only when a name is chosen or changed (my call).
  - Users with a generated `duelist-…` name are asked once, at their next app open, to
    pick a username. They can skip; they'll be asked again next time (my call: a
    dismissible prompt, not a wall).
- New accounts made by any sign-in get a generated `duelist-…` name and the same prompt.
  (New Discord accounts may instead pre-fill the prompt with their Discord username if
  it's free and valid — builder's call.)

## Sign-in methods

- A sign-in method is (provider, provider's user id), e.g. (discord, 1234), (apple, sub).
  Each belongs to exactly one account. Leave room for `email` and `google`.
- At most one sign-in per provider per account (my call): no second Discord account. So
  until email and Google exist, Link is only offered where the account lacks that provider
  (in practice: Apple-only accounts linking Discord, and Discord accounts linking Apple on
  iPhone). The admin check stays tied to the account's Discord sign-in.
- Settings → **Sign-in methods** lists what's attached, with **Link** for each provider the
  current platform supports and **Remove** for any but the last.
- Platform support: Discord everywhere (desktop, web portal, iPhone and Android apps);
  Apple in the iPhone app only.
- Linking runs the provider's normal sign-in flow, but attaches the result to the
  signed-in account instead of signing in:
  - The sign-in has no account yet → attach it. Done.
  - It belongs to another account → the merge screen (below).
  - It's already on this account → say so.
- Removing Apple should revoke the stored Apple refresh token, as deleting an account does
  today.

## Merging

The merge screen shows both accounts (username, avatar, card count, binders, wishlist
size) and asks:

1. **How to combine cards** that appear in both (same printing and same image/art, i.e.
   the existing per-user uniqueness of `collection_entries`): one choice for the whole
   merge, not per card.
   - **Keep the higher count** (pre-selected)
   - **Keep only this account's cards** (the other account's collection is dropped)
   - **Keep only the other account's cards**
   - **Add them together**

   Cards in only one account are kept under the first and last options. Under "keep only
   X's cards", the other account's cards are not kept. The screen states this plainly and
   shows the resulting total before confirming.
2. **Which username to keep** (my call): either account's username. The other is
   released when the merge is final (after the 30-day hold, below).

Everything else combines:
- Wishlist and favourites: union. For a wishlist item on both, keep the higher wanted
  count (builder: match whatever fields `wishlist_entries` has).
- Binders: all binders from both. Same-named binders stay separate (page layouts can't be
  safely merged); the builder may suffix one, e.g. "Trade binder (2)".
- Friends: union of friendships and pending requests. A friendship between the two merging
  accounts disappears. If one account is friends with someone and the other has a pending
  request with them, the friendship wins. Blocks carry over; a block between the two
  merging accounts disappears; if anyone is both a friend (via one account) and blocked
  (via the other), the block wins.
- Value history (`value_snapshots`): the survivor's history stays; the builder decides
  whether to sum or ignore the other's (it's derived data).
- Sign-in methods move to the surviving account. The survivor's sessions keep working.
  The closed account's sessions are revoked (my call): those devices are signed out and
  sign in again, and their sign-in now opens the merged account. This keeps old app
  versions safe — they can't understand a "your account changed" signal and would
  otherwise sync a mix of both accounts.
- Admin/usage/price-request logs: builder's call; nothing user-visible.

The account the person is signed in on survives; the other one closes.

### Sync after a merge

- The server's merge is the truth. Devices of both accounts must end up showing exactly
  the merged collection, including the desktop app's offline copy.
- Unsent changes are never thrown away (my call). The device doing the link syncs first.
  Changes still unsent on other devices count as edits made after the merge: when they
  arrive they apply to the merged account like any later edit, even if they bring back a
  card the chosen rule dropped. The merge screen tells people to let their other devices
  sync first.
- A desktop app signed in again after its old account closed holds rows filed under the
  old account and unsent changes. New versions must carry those unsent changes into the
  merged account and then take the merged collection; old versions get whatever their
  existing account-switch behaviour does (builder: check `src/main/cloud/account.ts` and
  `localSync.ts`, and make sure it can't push stale rows over the merge).
- Collection sync is cursor-based on a global `server_seq`. Rows changed by the merge must
  reach the survivor's devices: new seqs for changed rows, tombstones for removed ones.
- Binders, wishlist and favourites sync the same way: whatever each one's sync mechanism
  is, merged results must reach every device.

### 30-day hold

- The closed account's data is kept (hidden, not shown or synced anywhere) for 30 days,
  so the owner can undo a bad merge by hand. It isn't a user button. Through `/admin` is
  enough (my call: a "recent merges" list with an undo action for the owner; restoring
  brings back the closed account as it was at the merge, with its sign-in method; the
  survivor is left as it is now, merged cards and later edits included). Undo can leave
  duplicate cards across the two accounts but never loses any.
- After 30 days the held data is deleted for good.
- Deleting the surviving account within the hold also deletes the held data.

## Hint for new empty accounts

When a sign-in creates a brand-new account (no cards yet), show a note: "Already use Duel
Binder with Discord? Link it in Settings." (Or with Apple, when the new account came from
Discord.) Dismissible, shown until dismissed or until the account has cards.

## Constraints

- The Worker (`workers/portal`, Durable Object SQLite) is the source of truth. Migrations
  run there; the Worker deploy is one-way and needs owner approval. DO SQLite rejects
  ~10-term compound queries: one query per table.
- `users.discord_id` is used widely (admin check `ADMIN_DISCORD_ID`, avatar URLs, friends
  queries). Moving identities into their own table must keep the admin check and Discord
  avatars working.
- Old clients (desktop, iPhone, Android installs that haven't updated) must keep working
  against the new Worker: same sign-in endpoints, same sync, same `/api/me` shape (new
  fields are additive).
- Sign in with Apple guidelines: Apple must stay offered where Discord is (iPhone app).
- Never lose cards; every merge path is covered by tests that count cards before and
  after.

## Left to the builder

- Table design for sign-in methods, the merge record, and the 30-day hold.
- Where the merge runs (one Worker transaction is the obvious choice) and how big
  collections stay within Worker limits.
- How devices learn they need a full resync.
- Exact screens and copy for Settings → Sign-in methods, the merge screen, the username
  prompt and the hint, on desktop, web portal and phone, following existing UI patterns.
- Rate limits on username changes and linking (my call: at least some).
