import type { SqlDb } from '../db/sql'
import { OP_CARD_TYPES, OP_RARITIES, opVersionSql } from '../../shared/games/onePiece'
import type { Scope } from './scope'

interface OnePieceFilterFields {
  opColors?: string[]
  opCardTypes?: string[]
  opAttributes?: string[]
  opTraits?: string[]
  opBlocks?: string[]
  costMin?: number
  costMax?: number
  powerMin?: number
  powerMax?: number
  counterMin?: number
  counterMax?: number
}

const marks = (v: readonly unknown[]): string => v.map(() => '?').join(',')

/**
 * WHERE fragments for the One Piece card filters, against a cards alias `c`. Details live in
 * `onepiece_cards` (joined on card_id); `colors`, `attribute` and `traits` are JSON arrays,
 * matched with json_each.
 */
export function onePieceWhere(f: OnePieceFilterFields): { where: string[]; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []
  if (f.opCardTypes?.length) {
    where.push(
      `c.id IN (SELECT card_id FROM onepiece_cards WHERE card_type IN (${marks(f.opCardTypes)}))`
    )
    params.push(...f.opCardTypes)
  }
  const jsonList = (col: 'colors' | 'attribute' | 'traits', values?: string[]): void => {
    if (!values?.length) return
    where.push(
      `c.id IN (SELECT oc.card_id FROM onepiece_cards oc, json_each(oc.${col}) j WHERE j.value IN (${marks(values)}))`
    )
    params.push(...values)
  }
  jsonList('colors', f.opColors)
  jsonList('attribute', f.opAttributes)
  jsonList('traits', f.opTraits)
  if (f.opBlocks?.length) {
    where.push(
      `c.id IN (SELECT card_id FROM onepiece_cards WHERE CAST(block_icon AS TEXT) IN (${marks(f.opBlocks)}))`
    )
    params.push(...f.opBlocks)
  }
  const range = (col: 'cost' | 'power' | 'counter', min?: number, max?: number): void => {
    if (min !== undefined) {
      where.push(`c.id IN (SELECT card_id FROM onepiece_cards WHERE ${col} >= ?)`)
      params.push(min)
    }
    if (max !== undefined) {
      where.push(`c.id IN (SELECT card_id FROM onepiece_cards WHERE ${col} <= ?)`)
      params.push(max)
    }
  }
  range('cost', f.costMin, f.costMax)
  range('power', f.powerMin, f.powerMax)
  range('counter', f.counterMin, f.counterMax)
  return { where, params }
}

/** SQL for a printing label's rarity code: the label up to its first space (`L (Alternate Art)` is `L`). */
const rarityCode = (col: string): string => `substr(${col}, 1, instr(${col} || ' ', ' ') - 1)`

/** True when the label in `printingCol` has one of the rarity codes; null with none. */
export function opRarityWhere(
  values: string[] | undefined,
  printingCol: string
): { sql: string; params: unknown[] } | null {
  if (!values?.length) return null
  return { sql: `${rarityCode(printingCol)} IN (${marks(values)})`, params: [...values] }
}

/** True when the label in `printingCol` has one of the versions (opVersionSql); null with none. */
export function opVersionWhere(
  values: string[] | undefined,
  printingCol: string
): { sql: string; params: unknown[] } | null {
  if (!values?.length) return null
  return { sql: `${opVersionSql(printingCol)} IN (${marks(values)})`, params: [...values] }
}

/** Known values in `order`'s order, then any others as they came (the queries sort them). */
function inOrder(values: string[], order: readonly string[]): string[] {
  const rank = (v: string): number => {
    const i = order.indexOf(v)
    return i < 0 ? order.length : i
  }
  return [...values].sort((a, b) => rank(a) - rank(b))
}

/**
 * Distinct color, card type, attribute, trait, block, rarity and version values of the scope's
 * One Piece cards, limited to the card ids `cardIds` selects (a SQL subquery), or all of them when
 * null. Rarities and versions come from those cards' printings.
 */
export function onePieceFacets(
  db: SqlDb,
  scope: Scope,
  cardIds: string | null
): {
  opColors: string[]
  opCardTypes: string[]
  opAttributes: string[]
  opTraits: string[]
  opBlocks: string[]
  opRarities: string[]
  opVersions: string[]
} {
  const src = `SELECT oc.* FROM onepiece_cards oc JOIN cards c ON c.id = oc.card_id AND +c.game = ${scope.game}${
    cardIds ? ` WHERE oc.card_id IN (${cardIds})` : ''
  }`
  const labels = `SELECT p.set_rarity FROM card_printings p WHERE +p.game = ${scope.game} AND p.contributed = 0
    AND p.set_rarity <> ''${cardIds ? ` AND p.card_id IN (${cardIds})` : ''}`
  const values = (sql: string): string[] =>
    (db.prepare(sql).all() as { v: string }[]).map((r) => r.v)
  const json = (col: string): string[] =>
    values(`SELECT DISTINCT j.value AS v FROM (${src}) s, json_each(s.${col}) j ORDER BY v`)
  const versions = values(
    `SELECT DISTINCT ${opVersionSql('l.set_rarity')} AS v FROM (${labels}) l ORDER BY v`
  )
  return {
    opColors: json('colors'),
    opCardTypes: inOrder(
      values(`SELECT DISTINCT card_type AS v FROM (${src}) WHERE card_type <> '' ORDER BY v`),
      OP_CARD_TYPES
    ),
    opAttributes: json('attribute'),
    opTraits: json('traits'),
    opBlocks: values(
      `SELECT DISTINCT CAST(block_icon AS TEXT) AS v FROM (${src}) WHERE block_icon IS NOT NULL ORDER BY v`
    ),
    opRarities: inOrder(
      values(`SELECT DISTINCT ${rarityCode('l.set_rarity')} AS v FROM (${labels}) l ORDER BY v`),
      OP_RARITIES
    ),
    opVersions: inOrder(versions, ['Base'])
  }
}
