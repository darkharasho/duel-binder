# Friend page redesign

## Why

A friend's binder looks too much like your own. Their name only appears in a heading, and the page
has just Collection and Wishlist. The owner wants it obvious whose page you're on, and a small
dashboard and set progress for that friend.

## What the owner decided

- The friend's avatar and name show that you're on their page.
- No "Back to mine" button.
- No separate card or banner for the user: the normal darker blurred header, like other pages.
- Tabs: Dashboard, Collection, Sets, Wishlist. Dashboard is its own tab, with some stats.

## Calls made while designing (the builder's to keep unless the owner objects)

- The binder opens on Dashboard.
- "All friends" shows on desktop as well as phone, since "Back to mine" is gone.
- The Dashboard stats: total value, cards, unique cards, "You both own", most valuable, by rarity,
  by card type, recently added. It reuses the sections of the owner's own dashboard.
- "You both own": distinct cards of the shown game that both people have live entries for.
- No value-over-time chart. History is stored on the server, but it wasn't in the approved mockup,
  and it would show friends something they can't see today. `valueHistory` is sent empty.
- Sets lists only sets the friend has started, closest to complete first, and follows the app's
  language filter.
- Everything is read-only. Friend pages can't change anything.

## Behaviour

**Header.** One `FriendHeader` inside the existing `PageHeader` on every tab: an "All friends"
button, avatar, name, `@username · Updated <relative>`, then the tabs. The Collection tab keeps its
entry count, view toggle, search and filters under it. "Viewing X's collection" goes. The current
tab survives moving between tabs; opening another friend starts on Dashboard.

**Dashboard.** Art wash from the friend's top entry, as on your own dashboard. Picking a card opens
it in the Collection tab, in the read-only panel. A friend with no cards in this game reads
"<name> hasn't added any cards yet". Load failures show `friendsErrorMessage` with Retry. Copies
with no price are never counted as $0, and the "≈ includes" and "Leaves out" notes stay.

**Sets.** The list uses `SetsList`; opening a set uses `SetChecklist` read-only with the friend's
counts: no Bulk add, and no price requests. An owned tile opens `FriendEntryPanel` with that
friend's copies of the card; a missing tile does nothing and isn't a button action. No started sets
reads "<name> hasn't started any sets in this game".

**Wishlist.** As today, under the new header.

## Server

Three new portal calls, all checked with `friendId` so only accepted friends get an answer, and all
in the caller's game like `friends:collection`:

- `friends:stats(id)`: `getStats` for the friend's scope plus `sharedCards`. Every entry list has
  `notes: ''`. `valueHistory` is `[]`.
- `friends:sets(id)`: `listSets` for the friend's scope.
- `friends:checklist(id, setName, language)`: `getChecklist` for the friend's scope.

`friends:*` wiring follows the existing path: `src/shared/ipc.ts`, `src/shared/portal.ts`, desktop
handlers, `src/phone/api.ts`. Desktop and phone set `printingScan: false` on friend entries, as
`friends:collection` does, because printing ids differ between server and device.

## Constraints

- Yu-Gi-Oh wire format stays compatible; older apps keep working on the new portal. These are
  added calls only.
- Deploy the portal before releasing the desktop app.
- A friend's notes must never reach the client through the new calls.
- Works on desktop, the web app and the phone screens, which all use `FriendsPage`.

## Non-goals

Comparing collections, trade features (out of scope for the product), the value chart, sets
filters and sort on the friend's Sets tab.

## Build order

1. Portal calls with tests: friendship check, notes stripped, sharedCards, game scoping.
2. Wiring: types, ipc, desktop handlers, phone api, query keys.
3. Split dashboard sections so both dashboards share them; `FriendDashboard`.
4. `FriendHeader`, Collection and Wishlist under it, tabs, open-entry handoff.
5. `FriendSets` and read-only `SetChecklist`.
6. Tests, type check, visual check with sample data, PR, portal deploy, release.
