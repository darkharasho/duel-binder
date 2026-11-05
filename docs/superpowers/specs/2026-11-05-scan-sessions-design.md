# Scan Sessions — design

Date: 2026-11-05. Approved by the owner 2026-11-05. Follows Rip Replay (`2026-11-05-rip-replay-design.md`), on the same branch.

## Why

After ripping packs the owner wants to come back to it: remake the replay the next morning, dig up a
session from weeks ago, and let friends look back through those sessions. Today the scanner forgets a session as soon as its cards are added or the list is
cleared, and a replay can only be made from the list on screen.

## Wording: "session", never "night"

Owner, 2026-11-05: a day can hold several sessions, so the app says **session**, not night. That
covers new copy and the existing copy it touches: the replay's "TOP PULL OF THE NIGHT" becomes "TOP
PULL OF THE SESSION" (`replay/draw.ts`), and the scan window summary's "Hit of the night"
(`window/SummaryScreen.tsx`) becomes "Hit of the session". Code comments that say "night" follow
when touched.

## What a session is

**One tap of "Add to collection" from the scanner is one session** (owner's rule: "that's the
signal"). Phone and desktop already share that button (`useSessionCommit` → `session.commit()` in
`src/renderer/src/features/scan/session.ts`), so one hook point covers both.

- It holds **every card that was actually added** in that tap: card, printing, image, quantity,
  name, set code, rarity, game, and **the price it had at that moment**, so the total and replay of
  an old session never change when prices move.
- **A card with no price at Add time gets its price filled in once**, the first time one is known
  (owner, 2026-11-05: prices often arrive later; Asian ones can take days via the eBay sweep). A
  price a card already has is never changed. That fill is the only change a saved session ever
  takes, and it has to sync like any other change. Until then the card shows no price, doesn't count
  in the total and can't make the replay.
- Rows that fail to add are not in it. Cleared rows that were never added never make a session.
- A commit is already one game (`inGame(r, game)`), so a session belongs to one game.
- An Add with nothing added (all failed) makes no session.
- This holds on phone Stream too: a stream with three Adds is three sessions (owner: a day can have
  several). Stream's own end-of-stream Make replay stays as it is, over the whole stream's record.
- *My call:* retrying failed rows later makes its own small session; it is not folded into the
  earlier one.
- *My call:* a scan from before this ships has no session. Past sessions can't be rebuilt: the
  collection keeps when a card first went in, not each add, and keeps no old prices.

## Where it lives

- **On the account**, so phone and desktop show the same history and friends can see it. It needs
  a new Worker table and push/pull like binders and wishlist (`workers/portal/src/binderSync.ts`,
  `wishlist.ts`, the `/api/sync/*` routes). The Worker deploy is one-way and goes live only with
  the owner's approval.
- Desktop is offline-first: it keeps sessions in its own SQLite and syncs them when signed in, as
  it does binders. Signed-out desktop users still get their own history on that machine.
- Sessions are kept forever. The owner can delete a whole session; nothing inside one is edited.
- *My call:* a session is never lost because the server isn't ready (Worker not yet deployed,
  offline, signed out on phone mid-session): each client keeps unsent sessions and pushes them later.
  So the clients may ship before the Worker deploy without losing history; order and any tester
  flag are left to the builder.
- *My call:* the owner's own feed follows the game picked in the app (desktop) or the scanner
  (phone), like the rest of the app, so headers need no game label.

## What you see (mock approved 2026-11-05)

A **feed**: each session is a header with a grid of small, clickable card tiles under it.

- **Header:** date and time, card count, total, **Make replay** with the MP4/GIF switch, and a
  **⋯** menu holding **Hide from friends** and **Delete**. A hidden session carries a small
  "hidden" tag in the owner's own feed.
- **Tiles:** card art with the price under it, most valuable first; a ×N badge for more than one
  copy; a gold ring on the cards the replay would use (the existing `pickReplayPulls` rule: priced
  at $1.00 or more, top 8). Clicking a tile opens that card's usual details.
- **Long sessions** show two rows of tiles, then a "+N more" tile that expands the rest.
- Newest session first.

### Places

- **Desktop:** a new **Sessions** page in the sidebar, right under Scan. The scan page itself is
  untouched (owner worried about its vertical space).
- **Phone:** a history button in the scanner's top bar beside Stream / Sound / Settings opens the
  same feed in a sheet.
- **Friend page:** a **Sessions** tab after Binders, same feed, no ⋯ menu and no **Make replay**.

## Make replay from a session

The same replay as Rip Replay release 1, built on the device that taps it, from the saved cards and
saved prices (not today's prices). We store the list, never the video: storage stays tiny and later
improvements to the replay apply to old sessions too. `MakeReplay` takes `ScanRow[]` today; a session
must feed it the same pulls (adapter or a small widening of its input — builder's choice).
The header line in the video uses the session's date, not today's.

## Friends

- Every session is visible to friends by default; **Hide from friends** per session (like a
  binder's `friendsVisible`). A hidden session doesn't reach friends at all, nor does the fact that
  it exists (same as `friendBinders.ts`).
- Friends see the feed only: no **Make replay** (owner's call, 2026-11-05), and they cannot hide,
  delete or change anything.
- The friend page is per game (`userScope(friend, game)`), so the tab shows that game's sessions.

## Non-goals

- No storing or uploading of videos.
- No editing a session's cards; no merging or splitting sessions.
- No backfill of sessions before this ships.
- No camera moments (Rip Replay release 2).
- No comments, likes or notifications on friends' sessions.

## Anti-goals

- The scan page must not lose vertical space.
- Adding cards must not get slower or able to fail because of sessions: recording a session can
  fail quietly; the cards are what matters (see scan speed priority).
- A hidden session must never be inferable by a friend.

## Left to the builder

- Wire format, table schema, push/pull mechanics (follow binders), id scheme.
- How the phone writes a session (it adds cards through the portal API, not local SQLite).
- Exact tile size, how the feed pages or lazy-loads, art loading (reuse the existing art paths and
  edge cache).
- Copy for empty states ("No sessions yet — add cards from the scanner").
