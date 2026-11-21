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
