# Pokémon in French, German, Italian and Spanish

Owner's decision, 2026-11-01: add these four languages from TCGdex. A card with no price shows none. The scanner stays English and Japanese.

## Why

Collectors of European printings can't catalog them today. TCGdex already feeds the catalog and has French 202 sets, Italian 193, Spanish 156, German 155.

## Rules

- Prices stay USD, with no fallback from another language. These languages have no TCGCSV data, so they start unpriced. `tcg_product_id` and price stay NULL. The eBay sweep is not extended here.
- Yu-Gi-Oh keys, the wire format and the Yu-Gi-Oh DBFP file stay byte-identical. The Pokémon DBFP file must not change: `scripts/catalog/fingerprints.ts` excludes these languages like `zh-hant`.
- Portuguese and Latin American Spanish are out of scope. So is malie.io, and Dex import for these languages until a real export shows Dex's locale strings.
- Art is TCGdex's language-specific image. A card with no image shows the placeholder. No English art is borrowed in this project (TCGdex has no German Base Set images; a German card must not look English without a label).

## Rollout

French first, alone. Then measure before adding the rest:

- catalog run time and whether the first fill fits the 340-minute job
- catalog size and first-sync time on desktop and phone
- rows in the portal, and any upload limit

Each later language ships only if that measurement is fine. About 83,600 cards across the four, before Pocket sets are dropped, against about 54,000 Pokémon cards now, so a full rollout more than doubles Pokémon.

A first fill costs about 20,000 requests per language. The cache's progress survives a cut-off run. Cached European cards use a fresh-only rule, and their expiry gets jitter so a fill doesn't refetch in one night each week.

## Frozen values

`set_name` and `set_code` are part of the printing key and can't be fixed later.

- `set_name`: the local name TCGdex gives ("Flammes Obsidiennes"), as printed on the card. An English name is display-only, from the same-id `en` set, shown the way other non-English sets are.
- `set_code`: `abbreviation.official` ("OBF"), the same code the English set uses, so a language filter and the set id say which printing it is. `abbreviation.localized` ("FLO") is ignored as a key and may be shown later.
- A set with no official abbreviation uses the same id fallback as `write.ts`.

## Normalising

A `europeanCard()` step, like `traditionalCard()`, maps to the English vocabulary before anything else sees the card:

- rarity, using a table per language; an unmapped value stops the language with an error naming it, because the rarity decides the version label, which is part of the key
- category and stage
- types, if sampling shows they're localized

Tables are built from TCGdex's own lists for all four languages. Any value we can't map confidently fails the language, not the night.

Variant type, subtype, stamp and foil are localized too and go through the same tables. TCGdex shares variant lists across languages, so a stamped variant other than 1st Edition is left out: a real one can be added later, a wrong one stays in the key.

## Names

`cards.name` is the English name from the same-id `en` card; the printed name goes to `local_name`. Without an English twin, the local name stays as `name`. The English-name lookup covers ids en lacks (`2013bw`, `2018sm-fr`, `2019sm-fr`).

## Failure isolation

A fetch failure in a European language drops that language for the night with a logged warning. It must not stop en, ja or Chinese, which would otherwise be skipped by the current all-or-nothing fetch.

TCG Pocket series are filtered with `DIGITAL_SERIES`.

## Scanner

Untouched. Check that picking a European language in the app's filter doesn't narrow a scanned row's printings to nothing (`pickerOptions.ts`, `useScanLanguage`).

## Decided by the builder, not the owner

The frozen-value rules, the French-first rollout, and no borrowed art.
