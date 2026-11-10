import type { SqlDb } from '../db/sql'
import { RARITY_LABEL } from '../db/schema'
import type {
  CardDetail,
  CardImage,
  CardRow,
  CardSearchResult,
  MagicFacts,
  OnePieceFacts,
  PokemonFacts,
  Printing
} from '../../shared/types'
import { byGame, gameOfId, type GameId } from '../../shared/games'
import { opPrintingImageId } from '../../shared/games/onePiece'
import { isLanguage } from '../../shared/languages'
import { setPrice } from './priceRule'
import { shownPrinting } from './shownPrinting'
import { LOCAL, scopeGame, type Scope } from './scope'
import { pokemonNamedNumber, pokemonNumberMatch } from './pkmFilters'
import { buildFtsQuery } from './fts'

export { buildFtsQuery }

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
  /** Set when the query reads onepiece_cards as `oc` (see gameFactsRead); absent on the other games. */
  op_number?: string | null
  op_card_type?: string | null
  op_colors?: string | null
  op_cost?: number | null
  op_life?: number | null
  op_power?: number | null
  op_counter?: number | null
  op_attribute?: string | null
  op_traits?: string | null
  op_block_icon?: number | null
  /** Set when the query reads mtg_cards as `mc` (see gameFactsRead); absent on the other games. */
  mtg_oracle_id?: string | null
  mtg_type_line?: string | null
  mtg_types?: string | null
  mtg_mana_cost?: string | null
  mtg_mana_value?: number | null
  mtg_colors?: string | null
  mtg_oracle_text?: string | null
  mtg_power?: string | null
  mtg_toughness?: string | null
  mtg_loyalty?: string | null
  mtg_defense?: string | null
  mtg_artist?: string | null
}

/** The pokemon_cards columns rowToCard reads, from a `LEFT JOIN pokemon_cards pc ON pc.card_id = c.id`. */
export const POKEMON_COLS = `pc.category AS pk_category, pc.hp AS pk_hp, pc.types AS pk_types, pc.stage AS pk_stage,
  pc.rarity AS pk_rarity, pc.illustrator AS pk_illustrator, pc.local_name AS pk_local_name`

/** The onepiece_cards columns rowToCard reads, from a `LEFT JOIN onepiece_cards oc ON oc.card_id = c.id`. */
export const ONEPIECE_COLS = `oc.number AS op_number, oc.card_type AS op_card_type, oc.colors AS op_colors,
  oc.cost AS op_cost, oc.life AS op_life, oc.power AS op_power, oc.counter AS op_counter,
  oc.attribute AS op_attribute, oc.traits AS op_traits, oc.block_icon AS op_block_icon`

const NO_ONEPIECE = { cols: '', join: '' }

/** The mtg_cards columns rowToCard reads, from a `LEFT JOIN mtg_cards mc ON mc.card_id = c.id`. */
export const MTG_COLS = `mc.oracle_id AS mtg_oracle_id, mc.type_line AS mtg_type_line, mc.types AS mtg_types,
  mc.mana_cost AS mtg_mana_cost, mc.mana_value AS mtg_mana_value, mc.colors AS mtg_colors,
  mc.oracle_text AS mtg_oracle_text, mc.power AS mtg_power, mc.toughness AS mtg_toughness,
  mc.loyalty AS mtg_loyalty, mc.defense AS mtg_defense`

/**
 * What a card query adds to read a game's own facts: `, ONEPIECE_COLS` (One Piece) or `, MTG_COLS`
 * (Magic) after its last column, and the matching join after the join of `c`. Nothing on the
 * other games, so their reads skip the join.
 */
export const gameFactsRead = (game: GameId): { cols: string; join: string } =>
  byGame(game, {
    ygo: NO_ONEPIECE,
    pkm: NO_ONEPIECE,
    op: { cols: `, ${ONEPIECE_COLS}`, join: 'LEFT JOIN onepiece_cards oc ON oc.card_id = c.id' },
    mtg: { cols: `, ${MTG_COLS}`, join: 'LEFT JOIN mtg_cards mc ON mc.card_id = c.id' }
  })

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

function onePieceFacts(row: CardDbRow): OnePieceFacts | undefined {
  if (row.op_number === null || row.op_number === undefined) return undefined
  return {
    cardType: row.op_card_type ?? '',
    colors: parseTypes(row.op_colors),
    cost: row.op_cost ?? null,
    life: row.op_life ?? null,
    power: row.op_power ?? null,
    counter: row.op_counter ?? null,
    attribute: parseTypes(row.op_attribute),
    traits: parseTypes(row.op_traits),
    blockIcon: row.op_block_icon ?? null,
    number: row.op_number
  }
}

function magicFacts(row: CardDbRow): MagicFacts | undefined {
  if (row.mtg_oracle_id === null || row.mtg_oracle_id === undefined) return undefined
  return {
    typeLine: row.mtg_type_line ?? '',
    types: parseTypes(row.mtg_types),
    manaCost: row.mtg_mana_cost ?? null,
    manaValue: row.mtg_mana_value ?? null,
    colors: parseTypes(row.mtg_colors),
    oracleText: row.mtg_oracle_text ?? null,
    power: row.mtg_power ?? null,
    toughness: row.mtg_toughness ?? null,
    loyalty: row.mtg_loyalty ?? null,
    defense: row.mtg_defense ?? null,
    // Only the details read fills the artist (see getCardDetail); list rows leave it out.
    ...(row.mtg_artist !== undefined ? { artist: row.mtg_artist } : {})
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
  /** 1 for a client-contributed printing; absent from queries that don't select it. */
  contributed?: number
}

/**
 * A One Piece printing's own art image, from its Bandai id; null for other games and for a
 * contributed printing, whose `set_rarity_code` is client-chosen and so never names art.
 */
export function printingArtImageId(
  row: Pick<PrintingDbRow, 'card_id' | 'language' | 'set_rarity_code' | 'contributed'>
): number | null {
  if (gameOfId(row.card_id) !== 'op' || row.contributed === 1) return null
  return opPrintingImageId(row.language, row.set_rarity_code ?? '')
}

export function rowToCard(row: CardDbRow): CardRow {
  const pokemon = pokemonFacts(row)
  const onePiece = onePieceFacts(row)
  const magic = magicFacts(row)
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
    ...(pokemon ? { pokemon } : {}),
    ...(onePiece ? { onePiece } : {}),
    ...(magic ? { magic } : {})
  }
}

export function rowToPrinting(row: PrintingDbRow): Printing {
  const artImageId = printingArtImageId(row)
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
    ...(row.pkey ? { pkey: row.pkey } : {}),
    ...(artImageId !== null ? { artImageId } : {})
  }
}

/** How many of a name search's best matches are put in date order. */
const NAME_POOL = 300

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

  const pkm = scopeGame(db, scope) === 'pkm'
  const pkmNumber = pkm ? pokemonNumberMatch(text, 'p.set_code') : null
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

  // A name or set code and a number ("Victini 102", "MEP 102"): one of a name's many printings.
  const named = pkm ? pokemonNamedNumber(text, 'p.set_code', 'p.card_id') : null
  if (named) {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, p.set_code AS matched
         FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
         WHERE +p.game = ${scope.game} AND p.contributed = 0 AND ${named.sql}
         ORDER BY c.name, p.set_code, p.id LIMIT ?`
      )
      .all(...named.params, limit) as DbHit[]
    rows.forEach((r) => push(toResult(r)))
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
    // Newest first: an exact name leads, then by the card's latest printing's set date (undated
    // last), then by relevance. Only the NAME_POOL best matches are dated, so a broad word stays cheap.
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, ${defaultImage} AS default_image_id, NULL AS matched,
           (SELECT MAX(COALESCE(s.tcg_date, es.tcg_date)) FROM card_printings p
            JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
            LEFT JOIN sets es ON es.game = s.game AND es.language = 'en' AND es.set_name = s.set_name
            WHERE p.card_id = c.id AND +p.game = ${scope.game} AND p.contributed = 0) AS newest
         FROM (SELECT cards_fts.rowid AS id, bm25(cards_fts) AS rank FROM cards_fts
               JOIN cards c0 ON c0.id = cards_fts.rowid
               WHERE cards_fts MATCH ? AND +c0.game = ${scope.game} ORDER BY rank LIMIT ${NAME_POOL}) f
         JOIN cards c ON c.id = f.id
         ORDER BY (c.name = ? COLLATE NOCASE) DESC, newest IS NULL, newest DESC, f.rank, c.name LIMIT ?`
      )
      .all(fts, text, limit) as DbHit[]
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

/**
 * `[image id, the image id it shows]` of each card linked by `column`, only to `language`'s cards if
 * given. Art of its own wins.
 */
function artLinks(
  db: SqlDb,
  column: 'art_twin_id' | 'traditional_twin_id',
  language?: string
): [number, number][] {
  const rows = db
    .prepare(
      `SELECT i.image_id AS own, t.image_id AS twin FROM pokemon_cards p
       JOIN card_images i ON i.card_id = p.card_id AND i.sort_order = 0
       JOIN card_images t ON t.card_id = p.${column} AND t.sort_order = 0
       ${language ? `JOIN pokemon_cards l ON l.card_id = p.${column} AND l.source_id LIKE ?` : ''}
       WHERE p.${column} IS NOT NULL AND p.image_url IS NULL`
    )
    .all(...(language ? [`${language}/%`] : [])) as { own: number; twin: number }[]
  return rows.map((r) => [r.own, r.twin])
}

/**
 * Each card showing a twin's art (`art_twin_id`): mostly an English card's, of the same rules. Art
 * of its own wins even if a link is left over. Not scoped to a game or an owner: it is the
 * catalog's, and only ids. Older web pages read this over the portal and label all of it English,
 * so it never holds Traditional art; a set printed from a Japanese one links its Japanese prints,
 * which japaneseArt names (an older app calls that the right picture "English art").
 */
export function borrowedArt(db: SqlDb): [number, number][] {
  return artLinks(db, 'art_twin_id')
}

/** The part of borrowedArt that is a Japanese card's art: the card's own print in Japanese. */
export function japaneseArt(db: SqlDb): [number, number][] {
  return artLinks(db, 'art_twin_id', 'ja')
}

/** As borrowedArt, for Traditional Chinese art, which a card shows ahead of its English twin. */
export function traditionalArt(db: SqlDb): [number, number][] {
  return artLinks(db, 'traditional_twin_id')
}

export function getCardDetail(db: SqlDb, cardId: number, scope: Scope = LOCAL): CardDetail | null {
  const op = gameFactsRead(scopeGame(db, scope))
  const row = db
    .prepare(
      `SELECT c.*, ${POKEMON_COLS}${op.cols} FROM cards c LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
       ${op.join} WHERE c.id = ? AND +c.game = ${scope.game}`
    )
    .get(cardId) as
    | CardDbRow
    | undefined
  if (!row) return null
  if (row.mtg_oracle_id !== undefined && row.mtg_oracle_id !== null) {
    const artists = db
      .prepare(
        `SELECT DISTINCT mi.artist AS a FROM card_images ci JOIN mtg_images mi ON mi.image_id = ci.image_id
         WHERE ci.card_id = ? AND mi.artist IS NOT NULL AND mi.artist <> '' ORDER BY mi.artist`
      )
      .all(cardId) as { a: string }[]
    row.mtg_artist = artists.length ? artists.map((r) => r.a).join(', ') : null
  }
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
