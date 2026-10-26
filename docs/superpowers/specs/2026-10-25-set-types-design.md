# Set types and a filter panel on the Sets page

## Why

A friend of the owner asked for an easier way to tell "proper" sets (booster sets you open packs of)
from decks. Today the Sets page lists all ~1,000 English sets plus the international ones in one
list, mixing core boosters with structure decks, tins, promos and reprint collections.

While adding the type filter, the Sets page toolbar gets tidied: it already carries the Show tabs,
search, count mode, language, sort and view toggles, which is too much for one row.

## Goals

- Every set has a type: **Booster sets**, **Decks**, **Tins**, **Collections**, **Promos**.
- The Sets page can be narrowed to any combination of types.
- The filter and sort controls move into one pull-out panel, leaving the page bar light.

## Non-goals

- No manual override of a set's type. Misfiles of odd products are accepted.
- No second data source (Yugipedia product types etc.). Types come from data we already have.
- No change to the Collection or Browse pages (they may adopt the panel later; not now).
- No database migration and no server change.

## Anti-goals

- Core booster sets (titles with no tell-tale words, e.g. *Cosmo Blazer*, *Phantom Nightmare*,
  *Invasion of Chaos*) landing outside Booster sets. That is the case the friend cares about most.
- Desktop and app.duelbinder.com disagreeing on a set's type.

## Classification

- A pure function in shared code, `setType(set) → 'booster' | 'deck' | 'tin' | 'collection' | 'promo'`,
  working from the set's name and code (plus card count if useful). Used by both the desktop and the
  web build, since they share the renderer.
- Rules are ordered; first match wins. Name keywords cover the obvious groups:
  - Decks: structure deck, starter deck/set, speed duel starter/decks, "Deck:" style names,
    2-player starter, egyptian god decks, etc.
  - Tins: tin / tins.
  - Collections / reprints: legendary collection, legendary duelists, battles of legend,
    rarity collection, maximum gold, hidden arsenal, duelist pack, mega pack, gold series,
    premium gold, king's court, ghosts from the past, duel devastator, anniversary packs, etc.
  - Promos: promotional, prize cards, tournament/championship prizes, OTS packs, sneak peek /
    premiere participation, magazine/book/movie/game/video-game bundles, collaboration cards,
    sweepstakes, special editions.
- **Anything that matches none of these is a booster set.** This is the rule that makes the
  title-only core sets land correctly.
- Promo keywords must be specific phrases, not loose words. An early experiment matching "game" or
  "tournament" alone put 534 of 1,035 sets in Promos.
- A short hand-kept list of exact set names or codes may override the rules for products the
  rules get wrong. This is maintained by us in code, not by the user.
- International sets (Yugipedia-sourced names) go through the same function. They may misfile
  more often; that is accepted.
- Tests pin a spread of real set names (from YGOPRODeck's cardsets list) to their expected type,
  weighted towards core boosters.

## The Sets page

**Page bar:** search box, a **Filters & sort** button showing a badge with the number of active
filters, and the list/grid view toggle. The Show tabs (Started / All / Complete), count mode
toggle, language select and sort select leave the bar.

**Active filter chips:** under the search, each active filter shows as a chip with ✕ (e.g.
"Booster sets ✕", "Decks ✕", "Started ✕"), followed by a "Clear" link that clears the filters
(not the sort, count mode or language).

**The panel** slides in from the right over the page (the existing `sheet.tsx` component). It
closes on clicking away, Esc or its ✕. Changes apply live; there is no apply button. Sections,
top to bottom:

1. **Type:** five checkboxes, each with the number of sets of that type (in the current language
   and progress filter). None ticked means all types.
2. **Progress:** Started / All / Complete.
3. **Sort:** Newest / Most complete / Name (the existing sorts).
4. **Count:** Each card once / Every rarity.
5. **Language:** the existing language select.

A **Reset all** at the bottom returns everything to defaults.

**Remembering:** types ticked, progress, count mode and view persist in localStorage like the
existing `sets.*` keys. Sort and language keep their current behaviour.

**Defaults:** no types ticked (all sets), Progress All, as today.

The page header line ("You've started X of Y sets · Z complete") stays as it is.

**Settled during review (builder's calls, made by us):**
- The badge counts chips: one per ticked type, plus one when Progress isn't All.
- Per-type counts respect language and progress but not the search text.
- A Progress chip ("Started ✕" / "Complete ✕") sets Progress back to All.

## Constraints

- Shared code must not value-import electron, better-sqlite3 or node:* (the web worker bundles it).
- Vitest runs with `--maxWorkers=2`.

## Left to the builder

- Exact keyword lists and the override list, guided by the real cardsets data.
- Whether type shows anywhere else (a small tag on set rows/tiles is optional, not required).
- Panel width, chip styling, and accessible labels, following existing shadcn/ui patterns.
