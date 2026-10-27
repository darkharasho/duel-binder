# Rip: simulated pack openings

## Why

The Scan design parked a **Rip** tab: "a tab that simulates opening packs from a set with realistic
odds, without adding to the collection." The owner wants it as a fun side thing to do in Duel
Binder, and to see what they've ripped over time.

Success: the owner picks a booster set and a number of packs, flips through each pack card by card,
gets a real thrill when a Secret or Starlight Rare turns over with a holo shine, and can later open a
History tab to see their best pulls ever and how much they've opened.

## Goals

- Pick an English booster set and a number of packs, then open them.
- Each pack's contents follow the set's real pack layout and pull rates.
- Cards flip one at a time. Rares and above get a big reveal, bigger for higher rarities.
- Secret Rares and Starlight Rares get a holo effect (see **Holo**).
- A summary after the last pack, and a History tab with all-time best pulls and totals.
- Every opened pack is saved locally.

## Non-goals

- **No prices anywhere in Rip.** No pack value, no session value, no total value ripped. The owner
  decided against it. Best pulls are ranked by rarity.
- Not on the phone app or app.duelbinder.com. Desktop only for now.
- No sync of rip history. It lives on this computer.
- No international sets. Their card lists and rarities are often incomplete.
- No box-level guarantees (e.g. "a box of 24 always has N Secrets"). Every pack is rolled
  independently. A possible later extra.

## Anti-goals

- Rip touching the real collection in any way: no collection entries, no effect on Dashboard stats,
  value snapshots, sync, or what friends see.
- A Secret Rare holo that spills outside the card's artwork box, or doesn't line up with it.
- Odds that feel fake: a Secret in every other pack, or a set's top rarity never showing up.

## Where it lives

- A new **Rip** page in the sidebar, next to Scan. Hidden on the web build, the same way Scan is
  (`isWeb()` in `AppShell.tsx`).
- The page has two tabs: **Open packs** and **History** (the app's existing `UnderlineTabs`).

## Open packs

**Picking.** A searchable grid of English sets **that have a researched pack layout** (see
**Odds**), using the same pack art tiles as the Sets page (`SetArt`). Newest
first. Selecting a set shows a bar with the set name, a short line about the pack ("9 cards a pack ·
1 rare or better" or whatever that set's layout is), quick picks **1 / 5 / 24 (box)**, a stepper for
any count, and a **Rip N packs** button.

Only sets with a researched layout are offered (the owner's call). The `setType` "booster" bucket
holds ~237 English sets, many of which aren't normal packs (Speed Duel boxes, Duel Terminal, Battle
Packs, Retro Pack, box sets, Deluxe/Super/Advance Editions); none of these get a generic fallback.
Start with the core booster sets plus well-known special packs, and add more over time. A
researched set whose local card list can't fill a pack (missing rarity slots, too few cards) is
also hidden.

**Opening.** One pack at a time. The pack's cards sit face down. The owner flips them in order with
a click or Space. Commons and other low slots flip quickly and drop into a row along the top. The
rare-or-better slot flips last and comes up large in the centre with its rarity badge and name. The
bigger the rarity, the bigger the moment (glow, hold time, holo). Controls: flip next, **Skip pack**
(flip the rest at once), **Next pack**. A progress line shows "pack 2 of 5" and the session's best
pull so far.

**Summary.** After the last pack: "N packs of <set>", card count, a hits line (e.g. "1 Secret · 1
Ultra · 3 Super"), the session's best pulls as cards (ranked by rarity), and buttons **Rip N more**,
**Pick another set**, **See all cards** (every card from the session).

Leaving mid-session keeps the packs already opened (each pack is saved as it's opened).

## History

- Totals: packs opened, cards pulled, sets ripped.
- **Best pulls ever**: the highest-rarity cards pulled, as cards with holo where it applies, ranked
  by rarity, newest first within a rarity.
- **Sessions**: a list of past sessions (set, packs, date, best pull). Opening one shows its
  summary.

## Odds

The pack's slots and rates come from the set's real distribution. The builder researches these per
era (pre-2008 sets, the 9-card core boosters of the modern era, sets with Starlights/Quarter Century
Secrets, etc.) and encodes them as data: slot counts and per-rarity odds for the rare slot, plus
any extra foil slot where a product has one. Per-set overrides where a set is known to differ.

Layouts are keyed by set (an era layout can be shared by many sets, listed explicitly). A set with
no entry is not rippable.

Cards for each slot are drawn from the set's English printings (`card_printings` with
`language = 'en'`) by `set_rarity`, uniformly by **card** within a rarity. Where a card has several
printings at that rarity (alternate art, Overframe), pick the card first, then one of its printings,
so a card with two arts doesn't come up twice as often (Claude's call). Short Prints and Super Short Prints
are commons for slot purposes but drawn less often where that's the real behaviour.

Rolling is a pure, seedable function in shared code so it can be unit-tested for distribution.

## Rarity ranking

For best pulls, hits lines and reveal size, from top:

Starlight Rare, Quarter Century Secret Rare, Prismatic Secret Rare, Ghost Rare, Ultimate Rare,
Secret Rare, Ultra Rare, Super Rare, Rare, Super Short Print, Short Print, Common.

Other real rarities slot in by what they are (Claude's call): Platinum Secret Rare with the
Secret family just under Quarter Century Secret; Collector's Rare beside Ultimate Rare; Gold /
Premium Gold Rare beside Ultra Rare; Starfoil, Shatterfoil, Mosaic and Parallel rares beside Super
Rare; coloured rares such as "Rare (Green)" with Rare. Anything still unknown ranks just above
Common. Colours come from `lib/rarityColors.ts`.

## Holo

Prototyped with the owner and approved:

- **Secret Rare** (and every rarity with "Secret" in the name: Prismatic, Quarter Century,
  Platinum): fine diagonal lines (about 1.2px line,
  3.4px pitch, 135°) showing a rainbow that slides with the card's tilt and the pointer. It is clipped
  to the card's **artwork box only** and must line up with it. Standard frame art box on a
  421×614 card image is about 11.9% in from each side, 18.1% from the top, 29.6% from the bottom.
  Pendulum cards have a different, wider art box and need their own outline (from `frame_type`).
  Link and other frames share the standard box unless they visibly don't. Overframe printings,
  where the art fills the card, get the whole-card holo instead (Claude's call).
- Rip always shows the standard YGOPRODeck full card image (the existing image cache), not
  `printing_art` photos, because the art box is measured against it (Claude's call).
- **Starlight Rare**: the same diagonal-line holo across the whole card.
- No holo on other rarities (the owner didn't ask for one; an Ultra sheen was offered and dropped).
- Holo builds on the existing `TiltCard` (tilt + glare). Respect `prefers-reduced-motion`: no
  animation, a static shine.
- Holo shows on the reveal, the summary and History.

## Storage

A local SQLite table (or two) in the existing database, via a schema migration in
`src/main/db/schema.ts`: sessions (id, set, pack count, started_at) and pulled cards (session, pack
number, slot). A pull stores a stable reference plus a small snapshot (card id, card name, set
code, rarity, frame type, image id), **not** a bare foreign key to `card_printings`: catalog sync
deletes printings no collection entry uses (`catalog/apply.ts`, `catalog/switch.ts`
`pruneUnlisted`, `tcgplayer/catalog.ts`), and History must not lose cards or block those deletes
(Claude's call). Not tied to an account, never part of sync. Images come from the
existing image cache.

## Left to the builder

- Exact per-era pack layouts and odds (research, with sources noted in code).
- Animation timing and the reveal's look beyond what's above, in the app's existing style.
- How the session list paginates once it grows.
