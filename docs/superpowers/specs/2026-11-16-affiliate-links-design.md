# Affiliate buy links — design (short)

**Why:** cover hosting plus a bit extra before opening to many more users, without locking anything. First of two monetization steps; the optional supporter tier comes second, priced from Costs tab numbers.

**Goals:** "Buy" links out to TCGplayer and eBay, with affiliate ids, on every card; revenue from day one; nothing taken away from free users.
**Non-goals:** Cardmarket / regional stores (users mostly US); supporter tier (next project).
**Anti-goals:** anything that looks like a marketplace or trading (out of scope in CLAUDE.md); hidden or undisclosed affiliate links.

## Approaches considered
- **A. Affiliate links (picked)** — small, no paywall, income from purchases.
- B. Supporter tier — wanted, built second.
- C. Free plan with limits + paid plan — rejected for now: takes from current users, most work, makes the app clearly commercial.

## Design
- **Where:** card panel next to the price (every card), and Wishlist rows. Desktop, web and phone.
- **TCGplayer:** exact-product link from the stored TCGplayer product id (most English Pokémon and One Piece, some Japanese Pokémon); otherwise a TCGplayer search by name + set code for English printings; no TCGplayer link for other languages without an id. Wrapped in the Impact affiliate link.
- **eBay:** search link by card name + set code (same query the price sweep uses), with the eBay Partner Network campaign id. Shown for every printing, so the only link for Asian/EU printings without a TCGplayer id.
- **Disclosure:** small "Affiliate link: we may earn a commission" note by the links; privacy/legal page updated.
- **Config (my call, revised while planning):** affiliate ids are constants in `src/shared/affiliate.ts` (they're public in every link anyway); a blank id hides that store's link. Changing one is a release, which is cheap here; a portal endpoint plus desktop plumbing wasn't worth it.
- **Phone stores (my call):** links to physical goods are allowed outside in-app purchase on iOS and Android; open in the system browser.
- **Measuring (my call):** count link clicks per store as usage events in the existing admin usage counts; no per-user tracking.
- **Setting (my call):** none for now; links are small and disclosed.

## Owner steps
- Apply to eBay Partner Network (campaign id) and TCGplayer's affiliate program on Impact.

## Left to the builder
- Exact placement/styling within the card panel and Wishlist row.
- eBay query building for each game (reuse the sweep's query code where possible).
