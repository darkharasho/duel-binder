import type { SqlDb } from '../db/sql'
import { MTG_CARD_TYPES, MTG_COLOR_NAMES, mtgFinishSql } from '../../shared/games/magic'
import type { Scope } from './scope'

export interface MagicFilterFields {
  mtgColors?: string[]
  mtgTypes?: string[]
  manaValueMin?: number
  manaValueMax?: number
  mtgPowerMin?: number
  mtgPowerMax?: number
  mtgToughnessMin?: number
  mtgToughnessMax?: number
}

const marks = (v: readonly unknown[]): string => v.map(() => '?').join(',')
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

const COLORLESS = 'Colorless'
const CODE_OF = new Map<string, string>(
  Object.entries(MTG_COLOR_NAMES).map(([code, name]) => [name, code])
)

/** Power and toughness are text ('*', '1+*'); only plain whole numbers take part in a range. */
const numeric = (col: string): string => `${col} GLOB '[0-9]*' AND ${col} NOT GLOB '*[^0-9]*'`

/**
 * One WHERE fragment for the Magic card filters, against a cards alias `c`, or null with none set.
 * Details live in `mtg_cards` (joined on card_id); `colors` and `types` are JSON arrays matched
 * with json_each.
 */
export function magicWhere(f: MagicFilterFields): { sql: string; args: unknown[] } | null {
  const parts: string[] = []
  const args: unknown[] = []
  if (f.mtgColors?.length) {
    const codes = f.mtgColors.flatMap((n) => CODE_OF.get(n) ?? [])
    const any: string[] = []
    if (f.mtgColors.includes(COLORLESS)) any.push(`mc.colors = '[]'`)
    // A name that is neither a colour nor Colorless matches nothing.
    any.push(
      codes.length
        ? `EXISTS (SELECT 1 FROM json_each(mc.colors) j WHERE j.value IN (${marks(codes)}))`
        : '0'
    )
    parts.push(`(${any.join(' OR ')})`)
    args.push(...codes)
  }
  if (f.mtgTypes?.length) {
    parts.push(
      `EXISTS (SELECT 1 FROM json_each(mc.types) j WHERE j.value IN (${marks(f.mtgTypes)}))`
    )
    args.push(...f.mtgTypes)
  }
  if (f.manaValueMin !== undefined) {
    parts.push('mc.mana_value >= ?')
    args.push(f.manaValueMin)
  }
  if (f.manaValueMax !== undefined) {
    parts.push('mc.mana_value <= ?')
    args.push(f.manaValueMax)
  }
  const stat = (col: 'power' | 'toughness', min?: number, max?: number): void => {
    for (const [op, v] of [
      ['>=', min],
      ['<=', max]
    ] as const) {
      if (v === undefined) continue
      parts.push(`(${numeric(`mc.${col}`)} AND CAST(mc.${col} AS INTEGER) ${op} ?)`)
      args.push(v)
    }
  }
  stat('power', f.mtgPowerMin, f.mtgPowerMax)
  stat('toughness', f.mtgToughnessMin, f.mtgToughnessMax)
  if (!parts.length) return null
  return {
    sql: `c.id IN (SELECT mc.card_id FROM mtg_cards mc WHERE ${parts.join(' AND ')})`,
    args
  }
}

/**
 * A Magic search's match on the printed (local) name, against a cards alias `c`, as Pokémon's
 * Japanese name is matched (pokemonSearch). The caller adds its own name and set-code matches.
 */
export function magicLocalName(text: string): { sql: string; params: unknown[] } {
  return {
    sql: `c.id IN (SELECT card_id FROM mtg_cards WHERE local_name LIKE ? ESCAPE '\\')`,
    params: [`%${escapeLike(text)}%`]
  }
}

/** True when the rarity text in `printingCol` has one of the finishes; null with none. */
export function mtgFinishWhere(
  values: string[] | undefined,
  printingCol: string
): { sql: string; args: unknown[] } | null {
  if (!values?.length) return null
  return { sql: `${mtgFinishSql(printingCol)} IN (${marks(values)})`, args: [...values] }
}

/**
 * Colors (display names, WUBRG order, then Colorless), card types and printing finishes the
 * scope's Magic cards have, limited to `cardIds`, or all of them when null.
 */
export function magicFacets(
  db: SqlDb,
  scope: Scope,
  cardIds: number[] | null,
  opts: { ownedFinishes?: boolean; language?: string } = {}
): { mtgColors: string[]; mtgTypes: string[]; mtgFinishes: string[] } {
  const ids = cardIds ? JSON.stringify(cardIds) : null
  const only = (col: string): string =>
    ids ? ` AND ${col} IN (SELECT value FROM json_each(?))` : ''
  const bind = ids ? [ids] : []
  const src = `SELECT mc.* FROM mtg_cards mc JOIN cards c ON c.id = mc.card_id AND +c.game = ${scope.game}${only('mc.card_id')}`
  const values = (sql: string): string[] =>
    (db.prepare(sql).all(...bind) as { v: string }[]).map((r) => r.v)
  const colors = new Set(
    values(`SELECT DISTINCT j.value AS v FROM (${src}) s, json_each(s.colors) j`)
  )
  const colorless = db
    .prepare(`SELECT 1 FROM (${src}) s WHERE s.colors = '[]' LIMIT 1`)
    .get(...bind)
  const types = new Set(
    values(`SELECT DISTINCT j.value AS v FROM (${src}) s, json_each(s.types) j`)
  )
  // Finishes come from the printings: the owned ones (collection) or the catalog's, in a language.
  const finishSql = opts.ownedFinishes
    ? `SELECT DISTINCT ${mtgFinishSql('p.set_rarity')} AS v FROM collection_entries e
       JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
       WHERE ${scope.where('e')} AND p.set_rarity <> ''`
    : `SELECT DISTINCT ${mtgFinishSql('p.set_rarity')} AS v FROM card_printings p
       WHERE +p.game = ${scope.game} AND p.contributed = 0 AND p.set_rarity <> ''${only('p.card_id')}${
         opts.language ? ' AND p.language = ?' : ''
       }`
  const finishes = new Set(
    (
      db
        .prepare(finishSql)
        .all(
          ...(opts.ownedFinishes ? [] : [...bind, ...(opts.language ? [opts.language] : [])])
        ) as {
        v: string
      }[]
    ).map((r) => r.v)
  )
  return {
    mtgColors: [
      ...Object.entries(MTG_COLOR_NAMES)
        .filter(([code]) => colors.has(code))
        .map(([, name]) => name),
      ...(colorless ? [COLORLESS] : [])
    ],
    mtgTypes: [
      ...MTG_CARD_TYPES.filter((t) => types.has(t)),
      ...[...types].filter((t) => !(MTG_CARD_TYPES as readonly string[]).includes(t)).sort()
    ],
    mtgFinishes: ['Nonfoil', 'Foil', 'Etched Foil'].filter((f) => finishes.has(f))
  }
}
