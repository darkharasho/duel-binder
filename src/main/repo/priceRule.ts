import { GAMES } from '../../shared/games'

/** SQL list of the games priced by their own market price only (priceRule 'marketOnly'). */
const MARKET_ONLY_GAMES = Object.values(GAMES)
  .filter((g) => g.priceRule === 'marketOnly')
  .map((g) => `'${g.id}'`)
  .join(',')

/** SQL condition: the printing alias `p` belongs to a market-price-only game. Keeps the planner off the game index. */
export const isMarketOnly = `+p.game IN (${MARKET_ONLY_GAMES})`

/** The printing's set_price column, hidden (NULL) for market-price-only games. */
export const SET_PRICE = `CASE WHEN ${isMarketOnly} THEN NULL ELSE p.set_price END`

/** True when the game id is priced by its own market price only. */
export const marketOnlyGame = (id: unknown): boolean =>
  Object.values(GAMES).some((g) => g.priceRule === 'marketOnly' && g.id === id)
