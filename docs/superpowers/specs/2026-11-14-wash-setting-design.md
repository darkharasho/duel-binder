# Background colour setting — design

Short design (owner-approved in chat, 2026-11-14). Builds on the art wash (PR #305).

## Intent

The art wash changes colour with every page. Some people will want one colour scheme they like, or no
colour at all. A "Background" setting lets them choose, and it follows their account to every device.

## The setting

Three choices:

- **Random** (default): today's wash. Each page takes its colours from one of its cards.
- **Locked**: one colour scheme everywhere. A **Randomize** button rolls a new scheme; the person
  keeps rolling until they like one, and it stays. Locked holds the *colours only* (owner chose
  option a): the scattered blob pattern still differs from page to page.
- **Colourless**: close to the old look, a much dimmer grey with a faint hint of colour that never
  changes.

## Decisions

Owner's:
- Synced across devices, through the account.
- Random is the default.
- Locked keeps the colours and lets the pattern vary per page.
- Ships on its own branch and PR, after #305.

Claude's calls (correctable):
- **Storage:** one JSON column `users.prefs` (server step `server-45`), read and written with RPCs
  `prefs:get` and `prefs:set(patch)`. The Worker validates and merges known keys only, so later
  settings reuse the same column. Shape: `{ wash?: { mode: 'random' | 'locked' | 'colourless',
  locked?: Families } }`.
- **Local copy:** each device keeps the last value in localStorage. That makes the wash right at
  startup with no network wait, keeps the setting working offline and signed out, and the most
  recent write wins. When signed in, the portal value replaces the local one when it loads; a
  change writes the local copy first, then the portal.
- **Picking up another device's change:** the prefs query refetches on window focus and every 5
  minutes. Nothing else in the app refetches on focus, so this one query opts in.
- **Randomize:** takes the colours of a random card the device has already read (real art palettes
  look good). If it has none, it uses the game's colours turned to a random hue. Each roll shows
  straight away, as a cross-fade on the live background.
- **Colourless:** a neutral near-black base, with the current game's two colours heavily
  desaturated and at low strength, in the fixed unseeded layout. It ignores the page's card.
- **Where the choice is applied:** in `ArtWash`, so desktop, web and phone all follow it. Random
  passes the page's wash through. Locked swaps in the locked colours but keeps the page's seed.
  Colourless replaces the wash.
- **UI:** desktop and web Settings › App (web gets the App section for this one row), and phone
  Settings. A three-way segmented control; under Locked, a small swatch of the locked colours and
  a Randomize button.
- **Signed out:** the setting still works on the device, local only.

## Non-goals

- A custom colour picker.
- Per-game settings: one setting covers every game.
- Light mode (stage 3, separate plan).

## Rollout

The Worker gets deployed before a client release tags. Older clients ignore the new column.
