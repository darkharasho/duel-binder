import type { SqlDb } from '../db/sql'
import type { BrowseCard, BrowseFacets, BrowseFilters, BrowsePage } from '../../shared/types'
import { buildFtsQuery } from './cards'
import { LOCAL, type Scope } from './scope'

const MAX_LIMIT = 200

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// Per card: owned copies, earliest English release, and an English printing to preselect.
const base = (scope: Scope): string => `
  WITH owned AS (
    SELECT p.card_id, SUM(e.quantity) AS n FROM collection_entries e
    JOIN card_printings p ON p.id = e.printing_id WHERE ${scope.where('e')} GROUP BY p.card_id
  ),
  released AS (
    SELECT p.card_id, MIN(s.tcg_date) AS d FROM card_printings p
    JOIN sets s ON s.language = 'en' AND s.set_name = p.set_name
    WHERE p.language = 'en' AND p.contributed = 0 AND s.tcg_date IS NOT NULL GROUP BY p.card_id
  )
  SELECT c.id, c.name, c.type, c.frame_type, c.attribute, c.race, c.level, c.linkval, c.atk, c.def,
    c.tcgplayer_price AS price, r.d AS released_at, COALESCE(o.n, 0) AS owned
  FROM cards c
  LEFT JOIN owned o ON o.card_id = c.id
  LEFT JOIN released r ON r.card_id = c.id`

interface BrowseRow {
  id: number
  name: string
  type: string
  frame_type: string
  attribute: string | null
  race: string
  level: number | null
  linkval: number | null
  atk: number | null
  def: number | null
  price: number | null
  released_at: string | null
  owned: number
  image_id: number
  default_printing_id: number | null
}

const SORT_SQL: Record<BrowseFilters['sort'], string> = {
  name: 'c.name COLLATE NOCASE',
  released: 'r.d',
  price: 'c.tcgplayer_price',
  atk: 'c.atk',
  def: 'c.def',
  level: 'COALESCE(c.level, c.linkval)'
}

function whereClause(f: BrowseFilters): { sql: string; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []
  const inList = (col: string, values?: string[]): void => {
    if (values?.length) {
      where.push(`${col} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
  }
  const text = f.q?.trim()
  if (text) {
    const fts = buildFtsQuery(text)
    const parts = [`c.id IN (SELECT card_id FROM card_printings WHERE contributed = 0 AND set_code LIKE ? ESCAPE '\\')`]
    params.push(`${escapeLike(text)}%`)
    if (fts) {
      parts.push('c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)')
      params.push(fts)
    }
    where.push(`(${parts.join(' OR ')})`)
  }
  inList('c.type', f.cardTypes)
  inList('c.attribute', f.attributes)
  inList('c.race', f.races)
  inList('c.archetype', f.archetypes)
  const printingFilter = (col: string, values?: string[]): void => {
    if (!values?.length) return
    where.push(
      `c.id IN (SELECT card_id FROM card_printings WHERE contributed = 0 AND language = 'en' AND ${col} IN (${values
        .map(() => '?')
        .join(',')}))`
    )
    params.push(...values)
  }
  printingFilter('set_name', f.setNames)
  printingFilter('set_rarity', f.rarities)
  if (f.levelMin !== undefined) {
    where.push('COALESCE(c.level, c.linkval) >= ?')
    params.push(f.levelMin)
  }
  if (f.levelMax !== undefined) {
    where.push('COALESCE(c.level, c.linkval) <= ?')
    params.push(f.levelMax)
  }
  if (f.owned === 'owned') where.push('o.n > 0')
  if (f.owned === 'missing') where.push('o.n IS NULL')
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params }
}

/** One page of every card in the database, filtered and sorted. Cards missing the sort value go last. */
export function browseCards(db: SqlDb, f: BrowseFilters, scope: Scope = LOCAL): BrowsePage {
  const { sql, params } = whereClause(f)
  const sortCol = Object.hasOwn(SORT_SQL, f.sort) ? SORT_SQL[f.sort] : SORT_SQL.name
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(Math.max(1, Math.floor(f.limit ?? 120)), MAX_LIMIT)
  const offset = Math.max(0, Math.floor(f.offset ?? 0))
  // Art and the default printing are looked up only for the page, after sorting and limiting.
  const rows = db
    .prepare(
      `SELECT page.*,
         COALESCE((SELECT image_id FROM card_images WHERE card_id = page.id ORDER BY sort_order, image_id
           LIMIT 1), page.id) AS image_id,
         (SELECT p.id FROM card_printings p
           LEFT JOIN sets s ON s.language = 'en' AND s.set_name = p.set_name
           WHERE p.card_id = page.id AND p.language = 'en' AND p.contributed = 0
           ORDER BY s.tcg_date IS NULL, s.tcg_date, p.id LIMIT 1) AS default_printing_id
       FROM (${base(scope)}${sql} ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, c.name COLLATE NOCASE, c.id
         LIMIT ? OFFSET ?) page`
    )
    .all(...params, limit, offset) as BrowseRow[]
  const { n } = db
    .prepare(
      `SELECT count(*) AS n FROM cards c
       LEFT JOIN (SELECT p.card_id, SUM(e.quantity) AS n FROM collection_entries e
         JOIN card_printings p ON p.id = e.printing_id WHERE ${scope.where('e')} GROUP BY p.card_id) o ON o.card_id = c.id${sql}`
    )
    .get(...params) as { n: number }
  return {
    total: n,
    cards: rows.map((r): BrowseCard => ({
      id: r.id,
      name: r.name,
      type: r.type,
      frameType: r.frame_type,
      attribute: r.attribute,
      race: r.race,
      level: r.level,
      linkval: r.linkval,
      atk: r.atk,
      def: r.def,
      imageId: r.image_id,
      price: r.price,
      releasedAt: r.released_at,
      owned: r.owned,
      defaultPrintingId: r.default_printing_id
    }))
  }
}

/** Filter options across the whole card database (English sets and rarities). */
export function browseFacets(db: SqlDb): BrowseFacets {
  const distinct = (sql: string): string[] =>
    (db.prepare(sql).all() as { v: string }[]).map((r) => r.v)
  const col = (c: string): string[] =>
    distinct(
      `SELECT DISTINCT ${c} AS v FROM cards WHERE ${c} IS NOT NULL AND ${c} <> '' ORDER BY ${c}`
    )
  return {
    cardTypes: col('type'),
    attributes: col('attribute'),
    races: col('race'),
    archetypes: col('archetype'),
    setNames: distinct(
      `SELECT DISTINCT set_name AS v FROM card_printings WHERE contributed = 0 AND language = 'en' ORDER BY set_name`
    ),
    rarities: distinct(
      `SELECT DISTINCT set_rarity AS v FROM card_printings WHERE contributed = 0 AND language = 'en' AND set_rarity <> ''
       ORDER BY set_rarity`
    )
  }
}
