import { GAMES } from '../../shared/games'

/** SQL list of the games priced by their own market price only (priceRule 'marketOnly'). */
const MARKET_ONLY_GAMES = Object.values(GAMES)
  .filter((g) => g.priceRule === 'marketOnly')
  .map((g) => `'${g.id}'`)
  .join(',')

/** SQL condition: the printing alias `p` belongs to a market-price-only game. Keeps the planner off the game index. */
export const isMarketOnly = `+p.game IN (${MARKET_ONLY_GAMES})`

/**
 * Chinese Pokémon has no TCGplayer market, so the portal's eBay set sweep (workers/portal/src/pokemonSweep.ts)
 * is its price: that language's listings only, always USD, never another language's card.
 */
const SWEPT_LANGUAGES = ['zh-hans', 'zh-hant']
const SWEPT_LANGUAGE_SQL = SWEPT_LANGUAGES.map((l) => `'${l}'`).join(',')

/** True when a market-price-only game's printing in this language may use its swept eBay price. */
export const sweptLanguage = (language: string): boolean => SWEPT_LANGUAGES.includes(language)

/** A market-price-only game's price, for a query that has `p` and `ip` (intl_prices). */
export const MARKET_ONLY_PRICE = `CASE WHEN p.language IN (${SWEPT_LANGUAGE_SQL}) THEN COALESCE(p.market_price, ip.price) ELSE p.market_price END`

/** The printing's set_price column: for market-price-only games hidden (NULL), or the swept eBay price of Chinese. */
export const setPrice = (ebayPrices: string): string =>
  `CASE WHEN ${isMarketOnly} THEN CASE WHEN p.language IN (${SWEPT_LANGUAGE_SQL})
  THEN (SELECT swept.price FROM intl_prices swept WHERE swept.printing_id = p.id AND ${ebayPrices}) END ELSE p.set_price END`

/** True when the game id is priced by its own market price only. */
export const marketOnlyGame = (id: unknown): boolean =>
  Object.values(GAMES).some((g) => g.priceRule === 'marketOnly' && g.id === id)
