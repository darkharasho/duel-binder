import { GAMES } from '../../shared/games'
import type { Language } from '../../shared/languages'

/** European languages whose printings share a TCG product line with the English one. */
export const EU_LANGUAGES: readonly Language[] = ['de', 'fr', 'it', 'es', 'pt']

const TWO_LETTER = ['DE', 'FR', 'IT', 'SP', 'PT']
const ONE_LETTER = ['G', 'F', 'I', 'S', 'P']

/** The English set code for a European one (LOB-DE001 -> LOB-EN001, LOB-G001 -> LOB-E001); null otherwise. */
export function enTwinCode(code: string): string | null {
  const dash = code.indexOf('-')
  if (dash < 0) return null
  const head = code.slice(0, dash + 1)
  const rest = code.slice(dash + 1)
  if (TWO_LETTER.includes(rest.slice(0, 2).toUpperCase())) return `${head}EN${rest.slice(2)}`
  if (ONE_LETTER.includes(rest.slice(0, 1).toUpperCase()) && /^\d/.test(rest.slice(1)))
    return `${head}E${rest.slice(1)}`
  return null
}

const DASH = `instr(p.set_code, '-')`
const REGION = `substr(p.set_code, ${DASH} + 1, 2)`
const TWIN_CODE = `CASE
  WHEN ${REGION} IN ('DE','FR','IT','SP','PT')
    THEN substr(p.set_code, 1, ${DASH}) || 'EN' || substr(p.set_code, ${DASH} + 3)
  WHEN substr(${REGION}, 1, 1) IN ('G','F','I','S','P') AND substr(${REGION}, 2, 1) BETWEEN '0' AND '9'
    THEN substr(p.set_code, 1, ${DASH}) || 'E' || substr(p.set_code, ${DASH} + 2)
END`

/** SQL list of the games whose printings may take the English twin's price (crossLanguagePriceFallback). */
const FALLBACK_GAMES = Object.values(GAMES)
  .filter((g) => g.crossLanguagePriceFallback)
  .map((g) => `'${g.id}'`)
  .join(',')

/**
 * The English twin's TCGplayer market price (same game, card, rarity and set number), or NULL. A scalar
 * subquery over alias `p`; it hits ux_printings_en (card_id, set_code, set_rarity), a point lookup.
 * `game` is the scope's game SQL: a game without crossLanguagePriceFallback (Pokémon) never gets one.
 */
const enTwinPrice = (game: string): string => `(SELECT en.market_price FROM card_printings en
  WHERE ${game} IN (${FALLBACK_GAMES}) AND p.language IN ('de','fr','it','es','pt') AND en.language = 'en'
    AND en.game = p.game AND en.card_id = p.card_id AND en.set_rarity = p.set_rarity AND en.set_code = ${TWIN_CODE})`

/**
 * A Korean printing's Japanese twin's eBay price (same game, card, rarity and set number), or NULL.
 * Korean singles barely sell on eBay; the Japanese printing of the same set is the closest market.
 * `ebayPrices` is the scope's eBay-prices condition: hidden eBay prices hide this one too.
 */
const jaTwinPrice = (
  game: string,
  ebayPrices: string
): string => `(SELECT jp.price FROM card_printings ja
  JOIN intl_prices jp ON jp.printing_id = ja.id AND ${ebayPrices}
  WHERE ${game} IN (${FALLBACK_GAMES}) AND p.language = 'ko' AND ${REGION} = 'KR' AND ja.language = 'ja'
    AND ja.game = p.game AND ja.card_id = p.card_id AND ja.set_rarity = p.set_rarity
    AND ja.set_code = substr(p.set_code, 1, ${DASH}) || 'JP' || substr(p.set_code, ${DASH} + 3)
    AND jp.price IS NOT NULL LIMIT 1)`

/**
 * The estimate for a printing with no price of its own: a European printing's English twin's TCGplayer
 * market price, or a Korean printing's Japanese twin's eBay price; NULL otherwise. Over alias `p`.
 * entryPrice tells the two apart by the printing's language.
 */
export const twinPrice = (scope: { game: string; ebayPrices: string }): string =>
  `COALESCE(${enTwinPrice(scope.game)}, ${jaTwinPrice(scope.game, scope.ebayPrices)})`
