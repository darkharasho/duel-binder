import type { SqlDb } from '../../src/main/db/sql'
import { GAME_IDS, type GameId } from '../../src/shared/games/types'

/** A printing to look up on eBay, without the titles found for it. */
export interface PrintingRef {
  game: GameId
  pkey: string
  cardId: number
  name: string
  setName: string
  setCode: string
  number: string
  rarity: string
  language: string
}

const DAY = 86_400_000
const RECENT_MIN_DAYS = 21
const RECENT_MAX_DAYS = 112
const RECENT_MIN_PRICE = 5

interface Row {
  pkey: string
  card_id: number
  name: string
  set_name: string
  set_code: string
  set_rarity: string
  language: string
}

function toRef(game: GameId, r: Row): PrintingRef {
  // Pokémon stores "PAL 045/193": the set code, then the number. Other games' codes are the number.
  const space = game === 'pkm' ? r.set_code.indexOf(' ') : -1
  return {
    game,
    pkey: r.pkey,
    cardId: r.card_id,
    name: r.name,
    setName: r.set_name,
    setCode: space > 0 ? r.set_code.slice(0, space) : r.set_code,
    number: space > 0 ? r.set_code.slice(space + 1) : r.set_code,
    rarity: r.set_rarity,
    language: r.language
  }
}

/**
 * The English printings worth a harvest, priciest first within each game, then dealt out one game
 * at a time. `recent` takes the top `count` from sets 21 to 112 days old (priced at 5 or more);
 * `backfill` takes ranks `[from, from + count)` of every set. Unary `+` on the game columns stops
 * SQLite choosing the game index over the price filter.
 */
export function pickPrintings(
  db: SqlDb,
  opts: { mode: 'recent' | 'backfill'; from: number; count: number; now: Date }
): PrintingRef[] {
  const recent = opts.mode === 'recent'
  const day = (days: number): string => new Date(opts.now.getTime() - days * DAY).toISOString().slice(0, 10)
  const limit = recent ? opts.count : opts.from + opts.count
  const perGame = GAME_IDS.map((game) => {
    const rows = db
      .prepare(
        // A Pokémon printing's set_rarity is its finish; the card's rarity is pokemon_cards.rarity.
        `SELECT p.pkey, p.card_id, c.name, p.set_name, p.set_code,
           ${game === 'pkm' ? 'COALESCE(pc.rarity, p.set_rarity)' : 'p.set_rarity'} AS set_rarity, p.language
         FROM card_printings p
         JOIN cards c ON c.id = p.card_id
         ${game === 'pkm' ? 'LEFT JOIN pokemon_cards pc ON pc.card_id = p.card_id' : ''}
         ${recent ? 'JOIN sets s ON +s.game = ? AND s.language = p.language AND s.set_name = p.set_name' : ''}
         WHERE +p.game = ? AND +c.game = ? AND p.language = 'en' AND p.contributed = 0
           AND p.market_price IS NOT NULL
           ${recent ? // TCGdex dates use slashes and TCGCSV's may carry a time, so compare the first ten characters.
             "AND p.market_price >= ? AND substr(replace(s.tcg_date, '/', '-'), 1, 10) BETWEEN ? AND ?" : ''}
         ORDER BY p.market_price DESC, p.id
         LIMIT ?`
      )
      .all(
        ...(recent ? [game] : []),
        game,
        game,
        ...(recent ? [RECENT_MIN_PRICE, day(RECENT_MAX_DAYS), day(RECENT_MIN_DAYS)] : []),
        limit
      ) as Row[]
    return rows.map((r) => toRef(game, r))
  })
  const dealt: PrintingRef[] = []
  for (let rank = 0; perGame.some((g) => rank < g.length); rank++)
    for (const g of perGame) if (rank < g.length) dealt.push(g[rank])
  return recent ? dealt.slice(0, opts.count) : dealt.slice(opts.from, opts.from + opts.count)
}

/** The eBay search for a printing: Pokémon by number, Yu-Gi-Oh! and One Piece by code, Magic by set. */
export function harvestQuery(p: PrintingRef): string {
  if (p.game === 'pkm') return `${p.name} ${p.number}`
  if (p.game === 'mtg') return `${p.name} ${p.setName}`
  return `${p.name} ${p.setCode}`
}

/** One printing per game and search: the same search would return the same titles twice. */
export function uniqueSearches(picked: PrintingRef[]): PrintingRef[] {
  const seen = new Set<string>()
  return picked.filter((p) => {
    const key = `${p.game}\u0000${harvestQuery(p)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
