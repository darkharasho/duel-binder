import { GAMES } from '../../shared/games'

/** SQL list of the games priced by their own market price only (priceRule 'marketOnly'). */
const MARKET_ONLY_GAMES = Object.values(GAMES)
  .filter((g) => g.priceRule === 'marketOnly')
  .map((g) => `'${g.id}'`)
  .join(',')

/** SQL condition: the printing alias `p` belongs to a market-price-only game. Keeps the planner off the game index. */
export const isMarketOnly = `+p.game IN (${MARKET_ONLY_GAMES})`

/**
 * Chinese Pokémon and Japanese One Piece have no TCGplayer market, so the portal's eBay set sweeps
 * (workers/portal/src/pokemonSweep.ts, onePieceSweep.ts) are their price: that language's listings
 * only, always USD, never another language's card. By game: Pokémon Japanese is not swept, and
 * nothing sweeps Magic, so a stray eBay row never prices a Chinese Magic card.
 */
const SWEPT_BY_GAME: Record<string, string[]> = { pkm: ['zh-hans', 'zh-hant'], op: ['ja'] }

/** True when a market-price-only game's printing in this language may use its swept eBay price. */
export const sweptPrinting = (game: unknown, language: string): boolean =>
  typeof game === 'string' && (SWEPT_BY_GAME[game] ?? []).includes(language)

/** SQL condition: the printing alias `p` is in a swept language (sweptPrinting). */
const SWEPT_SQL = `(${Object.entries(SWEPT_BY_GAME)
  .map(([g, ls]) => `(p.game = '${g}' AND p.language IN (${ls.map((l) => `'${l}'`).join(',')}))`)
  .join(' OR ')})`

/** A market-price-only game's price, for a query that has `p` and `ip` (intl_prices). */
export const MARKET_ONLY_PRICE = `CASE WHEN ${SWEPT_SQL} THEN COALESCE(p.market_price, ip.price) ELSE p.market_price END`

/** The printing's set_price column: for market-price-only games hidden (NULL), or the swept eBay price. */
export const setPrice = (ebayPrices: string): string =>
  `CASE WHEN ${isMarketOnly} THEN CASE WHEN ${SWEPT_SQL}
  THEN (SELECT swept.price FROM intl_prices swept WHERE swept.printing_id = p.id AND ${ebayPrices}) END ELSE p.set_price END`

/** True when the game id is priced by its own market price only. */
export const marketOnlyGame = (id: unknown): boolean =>
  Object.values(GAMES).some((g) => g.priceRule === 'marketOnly' && g.id === id)
