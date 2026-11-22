# Community search — design

2026-11-21 · owner-approved approach: eBay title harvest (backfill, then monthly) + AI filter + owner approval

## Why

Search should understand the names collectors actually use. Today, "trainer gallery charizard" and
"bubble mew" both find nothing. The owner wants search to be flexible and to follow community terms,
so the app feels like it comes from inside the hobby, not like a database front end.

## How search works today

- Every search path (Add Card `searchCards` in `src/main/repo/cards.ts`, Collection in
  `collection.ts`, Browse in `browse.ts`, Pokémon filters in `pkmFilters.ts`) uses `buildFtsQuery`
  (`src/main/repo/fts.ts`). That's an FTS5 prefix match on `cards_fts(name)` only, plus some
  special cases: set-code prefix, Pokémon "name + number", and local (Japanese or Magic-language)
  names.
- The portal runs the same repo code against DO SQLite (`workers/portal/src/rpc.ts` `cards:search`),
  so desktop, web and phone share one implementation. Changes land once, but they have to work under
  DO SQLite's limits (no big compound UNIONs; see the memory note on that).
- Set names, set codes, numbers and rarities are on `card_printings`, but free-text search doesn't
  read them. "Lost Origin Trainer Gallery" is in the data and unreachable.
- The `ebay-prices` Worker reads thousands of listing titles a day (`/v1/price` from desktops,
  `/v1/set` + `/v1/pokemon-listings` + `/v1/onepiece-listings` from portal sweeps, `/v1/graded-price`).
  It keeps the prices and throws the titles away. Each title is already tied to the printing or set it
  was priced for.

## Goals

1. **Mixed-field search.** Every word filters across name, set name, set code, card number and rarity,
   in any order. "trainer gallery charizard", "151 SIR mew", "LOR TG03", "QCSE ash blossom".
2. **A community term list.** Phrases map to what they mean: one printing ("bubble mew" → Mew ex
   PAF 232/91), a card ("BEWD" → Blue-Eyes White Dragon), a set or subset ("TG", "Trainer Gallery"),
   a rarity ("SIR", "QCSE", "manga"), or a small list of cards. Per game, all four games.
3. **The list grows by itself.** A monthly harvest (and a first backfill) of eBay titles goes through
   phrase mining and then an AI pass, which proposes terms. The owner approves, edits or rejects each one in an admin
   Terms tab. Rejected phrases are never proposed again.
4. **Typo tolerance.** When nothing matches, fall back to the closest names ("charzard" → Charizard).
5. **It feels native.** When a term matched, results say so in community language, e.g. a small line
   *"bubble mew" — Mew ex · Paldean Fates 232/91*.
6. **Offline.** Approved terms are stored on each device and search runs locally, as it does today.

## Non-goals

- Vector or embedding search (considered and dropped: it doesn't know art nicknames, and it's
  heavy offline across 2M Magic rows).
- User-suggested terms. That's planned next, so leave room in the data model (a `source` column),
  but build no UI for it now.
- Searching card rules text or effects.

## Anti-goals (would count as failure even if it works)

- **Slower typing.** The owner cares a lot about speed. The term lookup plus mixed-field search must
  not visibly slow per-keystroke search. Measure Add Card and Collection on Magic (worst case) and
  report before and after.
- **Confidently wrong slang.** A term that maps to the wrong printing does more harm than none. Nothing
  reaches users without owner approval.
- **Review becomes a chore.** If the queue is long or noisy, the owner stops reviewing and the list
  goes stale. The AI pass must cut junk hard, and each run is capped at 100 proposals.
- **Today's searches get worse.** Every search that works now must still return the same top results
  (add regression tests from current behaviour).
- **Starving prices of quota.** A harvest must never leave price lookups and sweeps short (1,500-call
  reserve, checked first).

## Constraints

- One search implementation for desktop SQLite and portal DO SQLite. Respect DO compound-query limits:
  one query per table, as elsewhere in the Worker.
- Keep the portal's shared DO free of heavy work. Raw titles and mining stay out of it (see
  the web slowness memory note: long jobs on the DO blocked everyone).
- eBay quota: harvests are capped per run and keep a 1,500-call reserve.
- Deploy the portal before tagging a client release that reads the new data (the usual rule).
- Test-data rule: no 100k-row synthetic fixtures in vitest. Benchmark in a capped standalone script.

## Approaches considered

1. **Keep the titles eBay already returns; mine phrases by frequency; the owner reviews raw candidates.**
   No new cost, but noisy: seller spam, condition words and grading boilerplate would flood the queue.
2. **Option 1 plus a dedicated title harvest using spare eBay quota.** Better coverage, but it competes
   with price lookups for quota that's already being watched.
3. **Option 1 plus an AI filter (chosen).** A model reads candidate phrases with sample titles and
   proposes a meaning and target, or throws them out. Keeps the review queue short and readable, for a
   small API cost per run. Recon later showed option 1 alone sees almost no English non-Yu-Gi-Oh! titles, so option 2's harvest was added, monthly rather than nightly (see Design §1).

Also considered and dropped: vector search over card data (see Non-goals).

## Design

### 1. Harvesting titles (revised 2026-11-21)

*Revised after recon:* the app only asks eBay for prices on Yu-Gi-Oh! cards TCGplayer has no price for,
and the portal's Pokémon and One Piece sweeps only read Chinese and Japanese listings. So the titles
eBay already returns almost never include English Pokémon, Magic or One Piece slang. Keeping those
titles wouldn't teach "bubble mew". Instead, a **harvest** asks eBay for titles on purpose, a few
times a year (owner: slang appears slowly, so nightly is too often; monthly or every three months).

- **When:** one **backfill** to start (the most valuable English printings of all four games, split
  over a few manual runs, e.g. 3 × 3,000 calls on different days). Then a **monthly** run of recently
  released sets' chase printings (sets 3–16 weeks old, a few hundred calls). Plus a manual run whenever
  the owner hears a new term. No nightly job.
- **How:** a new `ebay-prices` endpoint, `/v1/titles`, runs one eBay search and returns its listings'
  titles and sellers. It's behind a secret token (`HARVEST_TOKEN`), so it can't be used to drain the
  quota. It never touches the price cache or the price endpoints.
- **Quota:** each run checks `/v1/quota` first and leaves a reserve of 1,500 calls for prices and
  sweeps. If there isn't enough, the run shrinks or skips.
- **English listings only.** Japanese and Chinese titles have no spaces between words, so the phrase
  mining would need a different way to split them. That can come later.
- Titles live only inside the run, plus a few samples kept with each proposed term as evidence. No R2
  storage, and no changes to the portal's sweeps.

### 2. Mining (GitHub Actions job, `terms.yml`)

A workflow with a monthly cron and a manual `workflow_dispatch` (mode `recent` or `backfill`, a rank
range, a call budget, and a dry run). It builds a local catalog the way `catalog:snapshots` does
(`pullGame` from the R2 snapshot), so it reads the catalog without loading the DO. Then:

1. **Pick printings.** English printings ranked by TCGplayer market price, split evenly across games.
   `recent` takes sets 3–16 weeks old; `backfill` takes the given rank range.
2. **Harvest.** One `/v1/titles` search per printing, using that game's singles category.
3. **Explain away** the known words. For each title, remove the words the searched printing already
   accounts for: card name, set name or code, number, rarity and its known abbreviations, approved
   terms, plus a stop list (PSA/BGS/CGC/grades, "NM", "mint", "pack fresh", "holo", "free ship", "lot",
   language words, game names).
4. **Count** the leftover 1–3 word phrases. A phrase found mostly on one printing's titles is a printing
   nickname ("bubble"). One found on several printings of one set is subset slang. One found across
   many sets is rarity or general slang ("SIR", "alt art"). Drop phrases below a minimum count or
   seller spread (several different sellers, so one seller's habit isn't community slang). Drop
   anything already approved, pending or rejected.
5. **AI pass.** Send the candidates to Claude in batches, each with about 5 sample titles and the
   targets it can choose from (the printing keys, card ids, sets and rarities in its evidence). For each
   one it returns either *junk*, or a term: the phrase as collectors would write it, its kind, its
   target (picked only from the options it was given) and a one-line reason. Uses structured output.
   Model: `claude-opus-5-5` (changed from the Haiku in the first draft: a run is a few hundred
   candidates, under $1 on either model, and wrong slang is the costliest failure). The key is a new
   `ANTHROPIC_API_KEY` repo secret.
6. **Check targets against the catalog.** Any target that doesn't resolve to real rows is dropped.
7. **Post** up to 100 proposals a run, strongest evidence first, to the portal as *pending* terms
   (admin token).

### 3. Terms data (portal + clients)

One small table, the same shape on the portal and the desktop:

`search_terms`: id, game, phrase (as shown), phrase_key (normalised: lowercase, no accents,
punctuation folded), kind, target_kind (`printing` | `card` | `set` | `rarity` | `cards`),
target (JSON: printing ids or set code + number; card ids or names; set codes; rarity labels),
status (`pending` | `approved` | `rejected`), source (`ebay-ai` | `owner`, later `user`),
evidence (count, sellers, sample titles), created, decided.

- Targets refer to stable catalog identity (set code + number, card name, set code), not local row
  ids, so they hold on every device. The builder picks the exact fields per game.
- Only **approved** terms go to clients, through a small change feed of their own
  (`GET /api/sync/search-terms`, cursor = the term's `seq`), pulled in the sync engine next to price
  changes. Desktop and phone both run that engine. A removed term goes out as a delete. The terms are
  tiny, so they stay out of the big catalog feed and its snapshots. Web and phone searches that run on
  the portal read the portal's own table. Limitation: like price changes, the pull runs only when
  signed in.

### 4. Search

One shared query-understanding step in front of all the search paths:

1. **Normalise** the query the same way as `phrase_key`.
2. **Match terms.** Find approved terms in the query, longest match first, for the scoped game. Each
   matched term becomes a constraint (a printing, card, set, rarity or card list) for the term-match
   results. **Terms add to search, they don't replace it** (my call): today's search on the whole
   query still runs, and its results come after the term hits, so "bubble" still finds Bubbleman.
   Words a term doesn't cover filter the term's targets, per step 3.
3. **Remaining words** each have to match at least one of: card name (FTS, as today), local name,
   set name, set code, number, rarity. Every word must match (AND); each word can match any field (OR).
4. **Result level (owner: one row per version).** When a set, rarity, number or printing constraint is
   in play, there's **one row per matching version**. Each row shows that version's own art and set and
   number ("Charizard · LOR TG03/30"). Tapping it goes straight to that version. In Collection, only the
   owner's copies of those versions show. Otherwise, card-level rows as today. This changes the shared
   result type and the `cards:search` RPC. Old clients must keep working against the deployed portal
   (add new fields; don't change old ones), and the portal deploys before the client tag. A broad term
   ("SIR") can give many rows. Keep today's row limits and order.
5. **Ordering.** Keep today's ordering for plain name searches (exact name first, then newest set).
   Term matches lead.
6. **Typo fallback.** Only when steps 2–3 return nothing: suggest the nearest names by edit distance
   over the game's name vocabulary (for example an `fts5vocab` table, or a small trigram index). Show
   them as "Did you mean …", or just as results with that label (the builder's call). Never slow down
   a search that already has results.
7. **Show the term.** When a term matched, show a small line above the results:
   *"bubble mew" — Mew ex · Paldean Fates 232/91*. It works the same on Collection, Browse, Add Card,
   phone and web.

The existing special cases (Pokémon name + number, set-code prefix, local names) are kept, either
folded into step 3 or run as now. Today's results must not change (see Anti-goals).

### 5. Admin Terms tab

A new tab on the portal admin page (`adminPage.ts`) and in the desktop's native admin pages
(`src/renderer/src/features/admin`), like the existing tabs:

- **Pending** queue, newest first: phrase, kind, the proposed target with card art, the AI's one-line
  reason, evidence (count, sellers, 3–5 sample titles). Buttons: **Approve**, **Edit** (change the
  phrase, kind or target), **Reject**. It should be quick to work through in a few minutes on desktop.
- **Approved** list, searchable, with **Remove** (moves it to rejected).
- **Add term** by hand (source `owner`). A starting list typed in by the owner goes in this way.
- Rejected phrases are kept so they're never proposed again.

## Left to the builder

Thresholds; per-game eBay query wording; exact target fields per game; how the
typo fallback is built; how existing search special cases fold into the new step; the exact copy and
look of the term line (follow the app's current style).

## Success

- "trainer gallery charizard" finds the Trainer Gallery Charizards on day one, with no terms needed.
- After the owner approves it, "bubble mew" finds Mew ex PAF 232/91 on desktop, web and phone, offline.
- Each run's queue has ≤100 proposals, most worth approving.
- No visible slowdown in per-keystroke search (numbers reported).

## Speed check results (2026-11-21)

`scripts/bench-search.ts` on a copy of the owner's real collection database (1.6 GB; Magic and Pokémon
catalogs), 30 timed runs after a warm-up, no approved terms loaded. `main` is the merge base.
Before the fix below, single-word names were up to +25 ms slower (`charizard`/mtg listEntries) because
`parseFields` loaded the field lists and `listEntries` read every owned printing on each keystroke.
Fixed: `parseFields` returns at once for one bare word, and the owned ids are read only when a term or
field matched. Table is after the fix.

| query | scope | fn | main median / p95 (ms) | branch median / p95 (ms) | diff median |
|---|---|---|---|---|---|
| charizard | mtg | searchCards | 74.3 / 81.0 | 74.2 / 78.3 | -0.1 |
| charizard | mtg | listEntries | 76.5 / 79.3 | 76.6 / 80.0 | +0.1 |
| lightning bolt | mtg | searchCards | 76.1 / 78.2 | 76.8 / 88.0 | +0.7 |
| lightning bolt | mtg | listEntries | 77.1 / 79.6 | 79.2 / 85.4 | +2.1 |
| trainer gallery charizard | mtg | searchCards | 73.2 / 75.9 | 75.4 / 79.7 | +2.2 |
| trainer gallery charizard | mtg | listEntries | 76.8 / 81.2 | 78.5 / 82.6 | +1.8 |
| mew sir | mtg | searchCards | 72.0 / 75.8 | 74.6 / 78.0 | +2.7 |
| mew sir | mtg | listEntries | 76.4 / 80.5 | 76.7 / 80.0 | +0.3 |
| charzard | mtg | searchCards | 72.8 / 76.4 | 149.7 / 160.2 | +76.9 |
| charzard | mtg | listEntries | 76.3 / 80.1 | 76.6 / 80.0 | +0.3 |
| a | mtg | searchCards | 289.6 / 378.7 | 285.8 / 298.2 | -3.8 |
| a | mtg | listEntries | 100.5 / 106.2 | 101.3 / 108.6 | +0.7 |
| b | mtg | searchCards | 263.6 / 274.2 | 261.4 / 270.5 | -2.2 |
| b | mtg | listEntries | 92.3 / 95.1 | 91.3 / 97.0 | -1.0 |
| c | mtg | searchCards | 291.0 / 307.1 | 286.1 / 301.6 | -4.9 |
| c | mtg | listEntries | 98.5 / 102.6 | 98.9 / 104.2 | +0.3 |
| d | mtg | searchCards | 286.9 / 291.9 | 285.4 / 293.6 | -1.6 |
| d | mtg | listEntries | 97.4 / 106.0 | 97.3 / 102.6 | -0.1 |
| e | mtg | searchCards | 275.0 / 280.1 | 274.0 / 282.6 | -1.0 |
| e | mtg | listEntries | 98.3 / 101.2 | 99.7 / 106.8 | +1.4 |
| f | mtg | searchCards | 257.6 / 277.1 | 253.8 / 260.4 | -3.8 |
| f | mtg | listEntries | 90.6 / 94.1 | 91.7 / 96.7 | +1.1 |
| g | mtg | searchCards | 268.5 / 279.8 | 266.3 / 277.1 | -2.2 |
| g | mtg | listEntries | 92.6 / 96.2 | 94.1 / 100.7 | +1.4 |
| h | mtg | searchCards | 237.0 / 244.6 | 240.1 / 257.7 | +3.1 |
| h | mtg | listEntries | 87.4 / 90.7 | 87.8 / 91.7 | +0.4 |
| i | mtg | searchCards | 252.1 / 261.5 | 253.8 / 262.2 | +1.6 |
| i | mtg | listEntries | 93.2 / 96.8 | 93.8 / 98.0 | +0.6 |
| j | mtg | searchCards | 167.2 / 174.7 | 165.3 / 175.3 | -2.0 |
| j | mtg | listEntries | 77.1 / 79.8 | 78.0 / 80.0 | +0.9 |
| charizard | pkm | searchCards | 6.4 / 7.5 | 6.5 / 7.5 | +0.1 |
| charizard | pkm | listEntries | 18.6 / 20.0 | 18.4 / 19.9 | -0.2 |
| lightning bolt | pkm | searchCards | 3.5 / 4.3 | 4.5 / 5.3 | +1.0 |
| lightning bolt | pkm | listEntries | 18.0 / 18.9 | 26.2 / 28.3 | +8.2 |
| trainer gallery charizard | pkm | searchCards | 3.3 / 3.9 | 4.4 / 5.2 | +1.1 |
| trainer gallery charizard | pkm | listEntries | 18.2 / 19.7 | 26.5 / 28.1 | +8.2 |
| mew sir | pkm | searchCards | 3.3 / 4.2 | 4.9 / 5.3 | +1.6 |
| mew sir | pkm | listEntries | 18.8 / 20.6 | 26.6 / 28.2 | +7.7 |
| charzard | pkm | searchCards | 3.5 / 4.0 | 10.9 / 12.0 | +7.5 |
| charzard | pkm | listEntries | 18.0 / 19.6 | 18.2 / 20.3 | +0.2 |
| a | pkm | searchCards | 90.4 / 92.1 | 89.1 / 93.0 | -1.3 |
| a | pkm | listEntries | 37.2 / 39.4 | 37.5 / 40.2 | +0.3 |
| b | pkm | searchCards | 80.3 / 83.6 | 79.4 / 82.4 | -0.8 |
| b | pkm | listEntries | 33.6 / 35.6 | 33.0 / 34.7 | -0.7 |
| c | pkm | searchCards | 93.6 / 98.7 | 92.3 / 97.6 | -1.3 |
| c | pkm | listEntries | 45.4 / 47.6 | 45.4 / 47.6 | +0.0 |
| d | pkm | searchCards | 82.8 / 84.6 | 81.8 / 84.0 | -1.0 |
| d | pkm | listEntries | 36.0 / 37.6 | 35.8 / 36.9 | -0.2 |
| e | pkm | searchCards | 86.8 / 89.7 | 85.6 / 88.5 | -1.2 |
| e | pkm | listEntries | 35.7 / 37.7 | 35.9 / 37.4 | +0.2 |
| f | pkm | searchCards | 69.6 / 72.7 | 68.7 / 70.6 | -0.9 |
| f | pkm | listEntries | 29.2 / 30.8 | 29.6 / 31.3 | +0.4 |
| g | pkm | searchCards | 85.1 / 87.8 | 84.4 / 88.0 | -0.7 |
| g | pkm | listEntries | 33.2 / 35.6 | 33.5 / 34.4 | +0.3 |
| h | pkm | searchCards | 64.0 / 67.1 | 63.5 / 66.3 | -0.5 |
| h | pkm | listEntries | 28.5 / 30.6 | 27.4 / 30.3 | -1.1 |
| i | pkm | searchCards | 60.6 / 62.0 | 60.1 / 63.3 | -0.5 |
| i | pkm | listEntries | 26.5 / 27.4 | 26.1 / 28.3 | -0.4 |
| j | pkm | searchCards | 25.7 / 27.6 | 25.5 / 26.6 | -0.2 |
| j | pkm | listEntries | 22.1 / 23.3 | 22.2 / 29.2 | +0.0 |

Reading: every plain one-word name is within +2 ms of `main` (the largest is a single-letter `h` on mtg
searchCards, +3.1 ms on a 240 ms query). Two kinds of query are slower on purpose:
- Multi-word queries that name a set ("lightning bolt" matches the set "Battle Party Set: Lightning",
  "mew sir", "trainer gallery charizard"): +1 to +8 ms, the field-word search itself (pkm listEntries).
- A misspelt word with no hits ("charzard"): the typo fallback runs where `main` returned nothing.
  +7.5 ms on pkm, +77 ms on mtg (its vocabulary is large; 3000 candidates are edit-distance scored).
