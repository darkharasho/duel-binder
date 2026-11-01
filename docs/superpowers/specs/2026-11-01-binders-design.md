# Binders

Date: 2026-11-01. Written against `origin/main` at 0.44.2 (`26c45fb`).

## Intent

Collectors chase themes that sets do not capture: every Blue-Eyes White Dragon, every Asako Ito card. Today the app can track completion by set, and it has one flat wishlist, but it has no way to make your own group of cards.

A **binder** is a user-made group of cards with its own completion goal. Cards come from a rule, from hand picks, or from both. A binder shows what you own and what you are still missing, so it works as a completion tracker for a theme you define.

## Goals

- Create, edit and delete binders on desktop, web and phone.
- Fill a binder by rules (such as name, artist, card type), by hand, or by both.
- Show missing cards as well as owned ones, with progress and an estimated cost to finish.
- Let each binder choose its own completion goal and its own languages.
- Friends can see binders, with a per-binder private toggle.

## Non-goals

- Share links or public binders. Friends see binders through the existing friend page.
- Binders that span games. A binder belongs to one game, as the whole app switches by game.
- Yu-Gi-Oh! artist rules. No data source in use has artists.
- Nested binders, or any OR logic between rules.
- Trading or marketplace features (project-wide).

## Anti-goals

These would make it a failure even if it technically works:

- A binder that silently undoes a hand edit when the catalog or rule changes.
- Progress that changes when a card is wrongly counted, such as hidden or contributed printings.
- A rule query that stalls the Worker for everyone, or freezes the desktop app.

## Decisions by the owner

- Binders track missing cards, not just owned ones.
- Each binder picks its completion goal.
- Each binder picks its languages.
- Friends can see binders, with a per-binder private toggle.
- No share link. The estimated value to finish stays.
- Rules are checked per printing: only copies that match the rule count (see Rules).
- The mockup's screens are the direction: a Binders list, a binder page with missing slots, and an edit form with a live preview.

## Decisions by Claude

The owner handed over the first of these ("go with what you think") and has seen the rest in the mockup, without objecting to them.

- Every binder can mix rules and hand edits. A manual binder is just a binder with no rules.
- A hand-added card stays until removed. A removed card stays out and does not count toward completion, even if the rule or catalog changes.
- Multiple rules narrow the results: a card must match all of them.
- New binders are visible to friends by default.

These are not in the mockup, and are Claude's calls:

- Within one rule, several values mean any of them (Attribute is LIGHT or DARK). This is not OR between rules.
- Name rules offer "is" and "contains". On Pokémon they check both `name` and `local_name`.
- Binder cards can be changed from the binder page, and "Add to binder" appears in the shared card panel.
- A binder's languages limit which printings count. Hand-added cards count regardless of language, since the user chose them.
- The "Binder" tab label and friend-page wording that mean a whole collection are renamed "Collection". The binder placeholders PDF keeps its name, because it refers to physical binders.
- Friends see a binder's cards, progress and missing slots against the owner's collection. If nothing is visible to friends, there is no Binders tab on the friend page.

## Rules

| Field | Yu-Gi-Oh! | Pokémon |
|---|---|---|
| Name | yes | yes |
| Artist | no | `pokemon_cards.illustrator` |
| Card type | `type`, `frame_type`, `race` | category, `types`, `stage` |
| Attribute | yes | no |
| Level / link | yes | no |
| Archetype | yes | no |
| Set | yes | yes |
| Rarity | yes | yes |

**Rules are checked per printing (owner's decision).** A printing is in the binder only if that one printing satisfies every rule and is in a selected language. A card or art slot exists if at least one of its printings qualifies, and only an owned copy of a qualifying printing fills it. With Rarity = Secret Rare and One of each card, a copy owned only as a Common does not fill the slot. Set = LOB plus Rarity = Ultra needs a single printing that is both. A set rule matches that set in every language the binder selects, by `set_code` prefix or equivalent; the builder must confirm the mapping per game.

Hand-added cards are not subject to this: any owned copy of the added target fills its slot. For Yu-Gi-Oh! One of each art, a rule match still needs the art check above, since a qualifying printing has no artwork id: the slot exists for each artwork of a card with a qualifying printing, and is filled by an owned copy with that image on a qualifying printing.

The form only offers the fields the current game supports. Artist coverage is about 78% of Pokémon cards overall, and almost none in Simplified Chinese, so an artist binder there will be nearly empty; the form should show the matching count in the preview, which makes this visible.

The rule format stores a version number, so new fields can be added later.

## Completion goals

"Card" means different things per game. Yu-Gi-Oh! groups reprints under one card, while Pokémon has one card per set, number and language, with no link between reprints.

| Goal | Yu-Gi-Oh! slot | Pokémon slot |
|---|---|---|
| No goal | No progress bar and no missing slots; shows owned matches | Same |
| One of each card | One per passcode | One per catalog card |
| One of each art | One per `card_images` artwork | Not offered |
| Every printing | One per `card_printings` row | One per printing, so each finish counts |

- Excluded from slots: `contributed = 1` printings, and printings hidden by `shownPrinting`.
- A Yu-Gi-Oh! printing has no artwork id. A One of each art slot is owned when a collection entry with that image exists in a selected language. The catalog cannot tell us whether an artwork was printed in a given language, so some slots may be unobtainable; the user can remove them.
- Yu-Gi-Oh! cards with no printings can't satisfy any language filter, so they don't appear in rule matches.
- A binder whose rules match zero cards shows an empty state, not 100%.

### Hand edits (Claude's calls)

- A hand edit targets one of three levels: a card (`card_id`), an artwork (`image_id`, a catalog-wide key) or a printing (`pkey`). "Add to binder" adds the card, or the printing if opened from one. Removing a slot targets that slot's level; removing a Yu-Gi-Oh! art slot drops only that art.
- Hand edits are never rewritten or deleted by a goal change. They are re-applied to whatever slots the goal produces, so switching goals and back restores the binder exactly.
- An added card expands to the slots the goal gives that card: one under One of each card, one per art under One of each art, one per printing under Every printing. These expanded slots ignore the binder's languages. A card the rule already matches gains no extra slots.
- An added printing makes one slot under Every printing. Under the other goals it adds its card, or its art when the printing's art is known from a collection entry; otherwise it adds its card.
- A removal beats an add at the same or a broader level.

### No goal (Claude's call)

No goal shows owned rule matches plus every hand-added card, owned or not. The count is those cards, with no progress bar. The All / Owned / Missing control is hidden, and the preview shows matches and owned only.

### Contributed and hidden printings (Claude's call)

- An owned copy on a contributed or hidden printing fills One of each card and One of each art slots, because the user does own the card.
- Under Every printing these printings make no slots unless the user hand-adds one, which is allowed.

## Screens

The mockup is in `docs/superpowers/specs/assets/2026-11-01-binders-mockup.png`, minus the Share link button, which was dropped.

- **Binders page:** a new page in `PageSwitch`, so it reaches all three clients. In `NAV` on desktop and web, and under `MORE` on phone. Shows the current game's binders, with art, summary and progress.
- **Binder page:** chips for the rule, goal, languages and visibility; progress; estimated value to finish; an All / Owned / Missing view; and a card grid with missing cards as dashed slots. Clicking a slot opens the usual card panel with the wishlist button.
- **Edit form:** name, rules, goal, languages, the friends toggle, and a live preview of matches and what you own.
- **Estimated value to finish:** the cheapest known price for each missing slot, summed, using existing price data. Slots with no price are left out, and the figure says so.
- **Friend page:** a Binders tab listing that friend's visible binders, read-only.

Reuse `CollectionGrid`, `SetChecklist`, `FacetMenu`, `CardSheet`, `CardPanel` and `WishToggle` where they fit.

## Data and sync

Copy the wishlist end to end; the path runs through the migration and `server-N` step, scope, repo, wire types, server routes, a best-effort sync step that tolerates a 404 from an older portal, IPC channels, and the phone's edit and delete lists.

- **Binders** are one synced row: owner, game, name, rules JSON, goal, languages, visibility, sort order. Latest edit wins for the whole row.
- **Binder hand edits** are separate synced rows: binder, a portable card reference, and add or remove. Tombstones handle deletes. Keeping them separate means two devices adding different cards both survive.
- References must be portable. Use `pkey` for printings and `card_id` for cards, because printing ids differ per store.
- Rows for a printing that hasn't reached the local catalog yet wait, as `sync_pending` does for collection entries.

Constraints:

- Old clients must keep working, so API changes are additive only.
- The Durable Object holds the catalog and every user, so rule queries there must be bounded and indexed. `card_printings` has no `card_id` index on the server, and `illustrator` has no index anywhere.
- Do not rely on compound SELECTs, or long parameter lists, on the server.
- Keep the unary `+game` convention. Migrations may be long, so split them to commit in pieces.
- Ownership is read live: `catalogRollup` can only cache catalog-only results, and its triggers do not watch `illustrator`.
- No new test data of 100k+ rows.

## Left to the builder

- Exact table and column names, and the JSON shape of rules.
- How to build the printing-level, language-aware rule query. Current browse filters (`whereClause`) are English-only for set and rarity, AND-only, and return cards, so they can be reused only in part.
- Whether to cache progress, and how to page large binders.
- How to get acceptable speed on the Durable Object, measured on real data.
- Layout details on phone, and the empty states.
