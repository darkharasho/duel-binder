import type { SqlDb } from '../db/sql'
import { RARITY_LABEL } from '../db/schema'
import type { CardDetail, CardImage, CardRow, CardSearchResult, PokemonFacts, Printing } from '../../shared/types'
import { isLanguage } from '../../shared/languages'
import { setPrice } from './priceRule'
import { shownPrinting } from './shownPrinting'
import { LOCAL, scopeGame, type Scope } from './scope'
import { pokemonNumberMatch } from './pkmFilters'

export interface CardDbRow {
  id: number
  name: string
  type: string
  frame_type: string
  race: string
  attribute: string | null
  level: number | null
  linkval: number | null
  atk: number | null
  def: number | null
  archetype: string | null
  desc: string
  tcgplayer_price: number | null
  /** Set when the query LEFT JOINs pokemon_cards as `pc` (see POKEMON_COLS); null on Yu-Gi-Oh! rows. */
  pk_category?: string | null
  pk_hp?: number | null
  pk_types?: string | null
  pk_stage?: string | null
  pk_rarity?: string | null
  pk_illustrator?: string | null
  pk_local_name?: string | null
}

/** The pokemon_cards columns rowToCard reads, from a `LEFT JOIN pokemon_cards pc ON pc.card_id = c.id`. */
export const POKEMON_COLS = `pc.category AS pk_category, pc.hp AS pk_hp, pc.types AS pk_types, pc.stage AS pk_stage,
  pc.rarity AS pk_rarity, pc.illustrator AS pk_illustrator, pc.local_name AS pk_local_name`

function parseTypes(json: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(json ?? '[]')
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function pokemonFacts(row: CardDbRow): PokemonFacts | undefined {
  if (row.pk_category === null || row.pk_category === undefined) return undefined
  return {
    category: row.pk_category,
    hp: row.pk_hp ?? null,
    types: parseTypes(row.pk_types),
    stage: row.pk_stage ?? null,
    rarity: row.pk_rarity ?? null,
    illustrator: row.pk_illustrator ?? null,
    localName: row.pk_local_name ?? null
  }
}

export interface PrintingDbRow {
  id: number
  card_id: number
  set_name: string
  set_code: string
  set_rarity: string
  set_rarity_code: string
  set_price: number | null
  /** The TCGplayer market price, when known; absent from queries that don't select it. */
  market_price?: number | null
  missing_from_api: number
  language: string
  /** Absent from queries that don't select it. */
  pkey?: string
}

export function rowToCard(row: CardDbRow): CardRow {
  const pokemon = pokemonFacts(row)
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    frameType: row.frame_type,
    race: row.race,
    attribute: row.attribute,
    level: row.level,
    linkval: row.linkval,
    atk: row.atk,
    def: row.def,
    archetype: row.archetype,
    desc: row.desc,
    tcgplayerPrice: row.tcgplayer_price,
    ...(pokemon ? { pokemon } : {})
  }
}

export function rowToPrinting(row: PrintingDbRow): Printing {
  return {
    id: row.id,
    cardId: row.card_id,
    setName: row.set_name,
    setCode: row.set_code,
    setRarity: row.set_rarity,
    setRarityCode: row.set_rarity_code,
    setPrice: row.market_price ?? row.set_price,
    missingFromApi: row.missing_from_api === 1,
    language: isLanguage(row.language) ? row.language : 'en',
    ...(row.pkey ? { pkey: row.pkey } : {})
  }
}

/** Turns free text into a safe FTS5 prefix query, or null when nothing searchable remains. */
export function buildFtsQuery(q: string): string | null {
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null
}

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function searchCards(db: SqlDb, q: string, limit = 20, scope: Scope = LOCAL): CardSearchResult[] {
  const text = q.trim()
  if (!text) return []
  const results: CardSearchResult[] = []
  const seen = new Set<number>()
  const push = (r: CardSearchResult): void => {
    if (results.length < limit && !seen.has(r.id)) {
      seen.add(r.id)
      results.push(r)
    }
  }
  const defaultImage = `COALESCE((SELECT image_id FROM card_images WHERE card_id = c.id AND +game = ${scope.game} AND sort_order = 0), c.id)`

  const pkmNumber =
    scopeGame(db, scope) === 'pkm' ? pokemonNumberMatch(text, 'p.set_code') : null
  if (pkmNumber) {
    // A card number (45, 045, 45/193): only printings' numbers match, never names.
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, p.set_code AS matched
         FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
         WHERE +p.game = ${scope.game} AND p.contributed = 0 AND ${pkmNumber.sql}
         ORDER BY c.name, p.set_code, p.id LIMIT ?`
      )
      .all(...pkmNumber.params, limit) as DbHit[]
    rows.forEach((r) => push(toResult(r)))
    return results
  }

  if (text.includes('-') && !/\s/.test(text)) {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, p.set_code AS matched
         FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
         WHERE +p.game = ${scope.game} AND p.contributed = 0 AND p.set_code LIKE ? ESCAPE '\\'
         ORDER BY p.set_code, p.id LIMIT ?`
      )
      .all(`${escapeLike(text)}%`, limit) as DbHit[]
    rows.forEach((r) => push(toResult(r)))
  }

  const fts = buildFtsQuery(text)
  if (fts) {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, NULL AS matched
         FROM cards_fts JOIN cards c ON c.id = cards_fts.rowid
         WHERE cards_fts MATCH ? AND +c.game = ${scope.game} ORDER BY bm25(cards_fts), c.name LIMIT ?`
      )
      .all(fts, limit) as DbHit[]
    rows.forEach((r) => push(toResult(r)))
  }
  if (scopeGame(db, scope) === 'pkm') {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, NULL AS matched
         FROM pokemon_cards pc JOIN cards c ON c.id = pc.card_id AND +c.game = ${scope.game}
         WHERE pc.local_name LIKE ? ESCAPE '\\' ORDER BY c.name LIMIT ?`
      )
      .all(`%${escapeLike(text)}%`, limit) as DbHit[]
    rows.forEach((r) => push(toResult(r)))
  }
  return results
}

interface DbHit {
  id: number
  name: string
  type: string
  default_image_id: number
  matched: string | null
}

const toResult = (r: DbHit): CardSearchResult => ({
  id: r.id,
  name: r.name,
  type: r.type,
  defaultImageId: r.default_image_id,
  matchedSetCode: r.matched
})

/** `[image id, the image id it shows]` of each card linked by `column`. Art of its own wins. */
function artLinks(db: SqlDb, column: 'art_twin_id' | 'traditional_twin_id'): [number, number][] {
  const rows = db
    .prepare(
      `SELECT i.image_id AS own, t.image_id AS twin FROM pokemon_cards p
       JOIN card_images i ON i.card_id = p.card_id AND i.sort_order = 0
       JOIN card_images t ON t.card_id = p.${column} AND t.sort_order = 0
       WHERE p.${column} IS NOT NULL AND p.image_url IS NULL`
    )
    .all() as { own: number; twin: number }[]
  return rows.map((r) => [r.own, r.twin])
}

/**
 * Each card showing an English twin's art. Art of its own wins even if a link is left over. Not
 * scoped to a game or an owner: it is the catalog's, and only ids. Older web pages read this over
 * the portal and label all of it English, so it never holds Traditional art.
 */
export function borrowedArt(db: SqlDb): [number, number][] {
  return artLinks(db, 'art_twin_id')
}

/** As borrowedArt, for Traditional Chinese art, which a card shows ahead of its English twin. */
export function traditionalArt(db: SqlDb): [number, number][] {
  return artLinks(db, 'traditional_twin_id')
}

export function getCardDetail(db: SqlDb, cardId: number, scope: Scope = LOCAL): CardDetail | null {
  const row = db
    .prepare(
      `SELECT c.*, ${POKEMON_COLS} FROM cards c LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
       WHERE c.id = ? AND +c.game = ${scope.game}`
    )
    .get(cardId) as
    | CardDbRow
    | undefined
  if (!row) return null
  const printings = (
    db
      .prepare(
        `SELECT p.id, p.card_id, p.set_name, p.set_code, ${RARITY_LABEL} AS set_rarity, p.set_rarity_code,
                ${setPrice(scope.ebayPrices)} AS set_price, p.market_price, p.missing_from_api, p.language, p.pkey
         FROM card_printings p WHERE p.card_id = ? AND +p.game = ${scope.game} AND p.contributed = 0 AND ${shownPrinting(scope)}
         ORDER BY p.set_code, p.id`
      )
      .all(cardId) as PrintingDbRow[]
  ).map(rowToPrinting)
  const images = (
    db
      .prepare(
        `SELECT image_id, card_id, sort_order FROM card_images WHERE card_id = ? AND +game = ${scope.game}
         ORDER BY sort_order`
      )
      .all(cardId) as { image_id: number; card_id: number; sort_order: number }[]
  ).map((i): CardImage => ({ imageId: i.image_id, cardId: i.card_id, sortOrder: i.sort_order }))
  return { card: rowToCard(row), printings, images }
}
