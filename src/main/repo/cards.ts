import type { SqlDb } from '../db/sql'
import { RARITY_LABEL } from '../db/schema'
import type { CardDetail, CardImage, CardRow, CardSearchResult, Printing } from '../../shared/types'
import { isLanguage } from '../../shared/languages'
import { LOCAL, type Scope } from './scope'

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
}

export function rowToCard(row: CardDbRow): CardRow {
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
    tcgplayerPrice: row.tcgplayer_price
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
    language: isLanguage(row.language) ? row.language : 'en'
  }
}

/** Turns free text into a safe FTS5 prefix query, or null when nothing searchable remains. */
export function buildFtsQuery(q: string): string | null {
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

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
  const defaultImage = `COALESCE((SELECT image_id FROM card_images WHERE card_id = c.id AND game = ${scope.game} AND sort_order = 0), c.id)`

  if (text.includes('-') && !/\s/.test(text)) {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, p.set_code AS matched
         FROM card_printings p JOIN cards c ON c.id = p.card_id AND c.game = ${scope.game}
         WHERE p.game = ${scope.game} AND p.contributed = 0 AND p.set_code LIKE ? ESCAPE '\\'
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
         WHERE cards_fts MATCH ? AND c.game = ${scope.game} ORDER BY bm25(cards_fts), c.name LIMIT ?`
      )
      .all(fts, limit) as DbHit[]
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

export function getCardDetail(db: SqlDb, cardId: number, scope: Scope = LOCAL): CardDetail | null {
  const row = db.prepare(`SELECT * FROM cards WHERE id = ? AND game = ${scope.game}`).get(cardId) as
    | CardDbRow
    | undefined
  if (!row) return null
  const printings = (
    db
      .prepare(
        `SELECT p.id, p.card_id, p.set_name, p.set_code, ${RARITY_LABEL} AS set_rarity, p.set_rarity_code,
                p.set_price, p.market_price, p.missing_from_api, p.language
         FROM card_printings p WHERE p.card_id = ? AND p.game = ${scope.game} AND p.contributed = 0 ORDER BY p.set_code, p.id`
      )
      .all(cardId) as PrintingDbRow[]
  ).map(rowToPrinting)
  const images = (
    db
      .prepare(
        `SELECT image_id, card_id, sort_order FROM card_images WHERE card_id = ? AND game = ${scope.game}
         ORDER BY sort_order`
      )
      .all(cardId) as { image_id: number; card_id: number; sort_order: number }[]
  ).map((i): CardImage => ({ imageId: i.image_id, cardId: i.card_id, sortOrder: i.sort_order }))
  return { card: rowToCard(row), printings, images }
}
