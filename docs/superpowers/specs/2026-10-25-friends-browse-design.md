# Friends, round 1: add friends and browse their collections

Date: 2026-10-25. Builds on the Friends section of
`2026-10-24-web-portal-sync-friends-design.md` (the "parent design"). Where the
two disagree, this document wins for this round.

## Intent

The owner wants to look through friends' Yu-Gi-Oh! collections, mostly
browsing for fun ("checking out their collection"), not hunting for a
particular card. The marketing site already advertises friends' binders.

## Goals

- Send a friend request by Discord username; accept or ignore incoming ones.
- See a friend list.
- Open a friend and browse their cards on the Collection screen, read-only.
- Works in the web app (app.duelbinder.com) and in the signed-in desktop app.

## Non-goals (this round)

- The search across all friends ("who has X") and the "Friends who have it"
  section on card panels. Both stay in the parent design for a later round.
- A friend's dashboard, value chart, top cards or set progress. The owner
  asked for "just the cards".
- Notifications outside the app, messaging, trading.
- Offline access to friends' collections.

## Anti-goals

- **Leaking private data.** Friends never see entry notes (strip them on the
  server, not in the UI). Nobody who is not an accepted friend can read a
  collection, even by calling the API directly.
- **Letting a friend's view edit anything.** No add, edit, remove or quantity
  controls, and no write call that could land on the viewer's own collection
  while they are looking at a friend's.
- **Breaking signed-out desktop.** Signed out, the desktop app is unchanged.

## Behaviour (owner-decided, from the parent design and this session)

- **Friends page**: a new sidebar item, "Friends". It holds:
  - an "Add friend" box: type a Discord username (case-insensitive) and send
    a request. Only users who have signed in to Duel Binder at least once can
    be found;
  - incoming requests, each with Accept and Ignore;
  - the friend list: avatar, display name / username, card count and a
    last-synced time for each friend, plus Unfriend.
- **Sending**: after sending, the sender sees only an inline "Request sent".
  There is no outgoing-requests list and no cancel, so an ignored request is
  never revealed. Sending again to someone with a request still pending is a
  no-op that also says "Request sent".
- **Requests**: ignoring deletes the request silently (the requester is not
  told). Re-requesting later is allowed. Either side can unfriend, which
  removes the friendship for both.
- **Badge**: the Friends nav item shows a count of pending incoming requests.
- **Friend's collection**: clicking a friend opens the normal Collection
  screen showing their cards, read-only. Same filters, grid/table toggle,
  search and value totals as your own. Card detail panel opens but shows no
  edit controls and no notes. A banner reads "Viewing <name>'s collection ·
  Back to mine". Friends see cards, printings, quantities, art choice and
  value totals.
- **Desktop**: the Friends item appears only when signed in. With no network
  it shows an offline state instead of the list. Signed out it is hidden.

- **Known gap, accepted by the owner**: a friend's view shows what the server
  holds. Desktop entries the server answers `unknown-printing` (mostly
  non-English printings and some alternate art) don't upload until Plan 4
  moves the catalog to the server, so a few cards may be missing from a
  friend's view and card count. No notice is shown. Plan 4 follows this round.

## Constraints and existing pieces

- Server is one SQLite Durable Object (`Store`, `workers/portal/src/index.ts`).
  Users are in `users` (`migrate.ts`, server-1) with a case-insensitive
  unique `username`. New tables go in a new `SERVER_STEPS` entry (append
  only; server-2 is already one-way).
- Collection queries are per user through `userScope(userId)`
  (`workers/portal/src/scope.ts`). A friend read can reuse `listEntries` /
  `getFacets` with the friend's scope after the friendship check, then strip
  `notes`.
- Web app calls go through `/api/rpc/:channel` (`workers/portal/src/rpc.ts`,
  allowed list in `src/shared/portal.ts`). Every handler there is bound to the
  caller's own scope, so friend reads need their own channels or endpoints
  that do the friendship check, never a user-id argument on existing ones.
- Desktop reaches the portal only through `CloudClient`
  (`src/main/cloud/client.ts`, Bearer token); its own collection is local.
  Friend calls on desktop go through new `CloudClient` methods exposed to the
  renderer over IPC.
- The renderer is shared by both builds (`isWeb()` switches). Pages are state,
  not URLs (`Page` in `AppShell.tsx`). `CollectionPage` already makes
  `onAddCard` optional.
- Keep the existing test suite green; vitest with `--maxWorkers=2`.

## Left to the builder

- Table shape. Parent design suggests `friendships` (requester, addressee,
  status pending/accepted, timestamps); unfriend and ignore delete the row.
  A request to someone who already requested you could simply accept.
- API shape (RPC channels vs. REST routes under `/api/friends`), as long as
  web and desktop share it and every friend read checks an accepted
  friendship.
- How `CollectionPage` takes a read-only "whose collection" mode (prop,
  context, or a wrapper), including query keys so friend and own data never
  share a cache entry.
- **Last-synced time**: no such field exists yet. Builder's call (mine,
  not the owner's): use the friend's most recent collection change
  (`MAX(updated_at)` over their entries, including tombstones), labelled
  "Updated <relative time>".
- Card images in a friend's view on desktop: the friend may own printings or
  art the desktop has not cached. Use whatever the existing image path does
  for uncached art, falling back to the portal's `/img` route if needed.
- Friend entries whose printing the desktop doesn't know locally: render from
  the server's `EntryView` data rather than local lookups.
- How often the badge count refreshes (on app focus / page change is enough).
- Self-requests, duplicate requests and unknown usernames: show a plain inline
  message.
