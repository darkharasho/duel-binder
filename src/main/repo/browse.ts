import type { SqlDb } from '../db/sql'
import type { BrowseCard, BrowseFacets, BrowseFilters, BrowsePage } from '../../shared/types'
import { isLanguage, LANGUAGES, type Language } from '../../shared/languages'
import { buildFtsQuery, escapeLike } from './cards'
import { LOCAL, favouriteSql, scopeGame, type Scope } from './scope'
import { pokemonFacets, pokemonSearch, pokemonWhere } from './pkmFilters'
import { catalogRollup } from './rollup'

const MAX_LIMIT = 200

/**
 * SQL limiting printings `p` to the language, or nothing for every language. Inlined, not bound:
 * the language is checked against the known codes first, and the planner then picks its index.
 */
const inLanguage = (language: Language | undefined, p = 'p'): string =>
  language ? ` AND ${p}.language = '${language}'` : ''

// A set's date: its own, else its English namesake's (a few foreign sets the Yugipedia sync
// couldn't date). `s` is the set and `es` the namesake, joined with ENGLISH_NAMESAKE.
const SET_DATE = 'COALESCE(s.tcg_date, es.tcg_date)'
const ENGLISH_NAMESAKE = (s: string): string =>
  `LEFT JOIN sets es ON es.game = ${s}.game AND es.language = 'en' AND es.set_name = ${s}.set_name`

// Per card: owned copies, and (only when sorting by it: the join reads every printing of the
// language) earliest release. The page's own dates and printing to preselect are looked up after.
// The release join starts from the dated sets, so each printing is one indexed lookup by set
// (`+contributed` keeps it on the (language, set_name) index, not every printing of the language
// per set), and `+card_id` keeps the planner from walking every printing in card order to group.
const base = (scope: Scope, byRelease: boolean, language: Language | undefined): string => `
  WITH owned AS (
    SELECT p.card_id, SUM(e.quantity) AS n FROM collection_entries e
    JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game} WHERE ${scope.where('e')}
    GROUP BY p.card_id
  )${byRelease ? `,
  set_dates AS (
    SELECT s.language, s.set_name, ${SET_DATE} AS d FROM sets s ${ENGLISH_NAMESAKE('s')}
    WHERE +s.game = ${scope.game}${inLanguage(language, 's')} AND ${SET_DATE} IS NOT NULL
  ),
  released AS (
    SELECT p.card_id, MIN(sd.d) AS d FROM set_dates sd
    JOIN card_printings p ON p.language = sd.language AND p.set_name = sd.set_name
    WHERE +p.game = ${scope.game} AND +p.contributed = 0
    GROUP BY +p.card_id
  )` : ''}
  SELECT c.id, c.name, c.type, c.frame_type, c.attribute, c.race, c.level, c.linkval, c.atk, c.def,
    c.tcgplayer_price AS price, COALESCE(o.n, 0) AS owned
  FROM cards c
  LEFT JOIN owned o ON o.card_id = c.id${byRelease ? '\n  LEFT JOIN released r ON r.card_id = c.id' : ''}`

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
  level: 'COALESCE(c.level, c.linkval)',
  hp: '(SELECT hp FROM pokemon_cards WHERE card_id = c.id)'
}

const YGO_ONLY_SORTS = ['atk', 'def', 'level']

/** A sort that doesn't exist on the game (or isn't known at all) sorts by name. */
function sortSql(sort: string, game: string): string {
  if (!Object.hasOwn(SORT_SQL, sort)) return SORT_SQL.name
  if (game === 'pkm' ? YGO_ONLY_SORTS.includes(sort) : sort === 'hp') return SORT_SQL.name
  return SORT_SQL[sort as BrowseFilters['sort']]
}

/** The filters' language when it's a known one; anything else (and none) is every language. */
const languageOf = (f: BrowseFilters): Language | undefined =>
  isLanguage(f.language) ? f.language : undefined

function whereClause(db: SqlDb, f: BrowseFilters, scope: Scope): { sql: string; params: unknown[] } {
  const where: string[] = [`+c.game = ${scope.game}`]
  const lang = inLanguage(languageOf(f), 'card_printings')
  const params: unknown[] = []
  const inList = (col: string, values?: string[]): void => {
    if (values?.length) {
      where.push(`${col} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
  }
  const pkm = scopeGame(db, scope) === 'pkm'
  const text = f.q?.trim()
  if (text) {
    const own = pkm ? pokemonSearch(text, { game: scope.game }) : null
    const parts: string[] = own ? [...own.parts] : []
    if (own) params.push(...own.params)
    if (!own?.numeric) {
      const fts = buildFtsQuery(text)
      parts.push(
        `c.id IN (SELECT card_id FROM card_printings WHERE +game = ${scope.game} AND contributed = 0${lang} AND set_code LIKE ? ESCAPE '\\')`
      )
      params.push(`${escapeLike(text)}%`)
      if (fts) {
        parts.push('c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)')
        params.push(fts)
      }
    }
    where.push(`(${parts.join(' OR ')})`)
  }
  if (pkm) {
    const p = pokemonWhere(f)
    where.push(...p.where)
    params.push(...p.params)
  } else {
    inList('c.type', f.cardTypes)
    inList('c.attribute', f.attributes)
    inList('c.race', f.races)
    inList('c.archetype', f.archetypes)
  }
  const printingFilter = (col: string, values?: string[]): void => {
    if (!values?.length) return
    where.push(
      `c.id IN (SELECT card_id FROM card_printings WHERE +game = ${scope.game} AND contributed = 0${lang} AND ${col} IN (${values
        .map(() => '?')
        .join(',')}))`
    )
    params.push(...values)
  }
  printingFilter('set_name', f.setNames)
  printingFilter('set_rarity', f.rarities)
  // A card is listed in a language it has a printing in (a set or rarity filter already asks that).
  if (lang && !f.setNames?.length && !f.rarities?.length) {
    where.push(
      `c.id IN (SELECT card_id FROM card_printings WHERE +game = ${scope.game} AND contributed = 0${lang})`
    )
  }
  if (!pkm && f.levelMin !== undefined) {
    where.push('COALESCE(c.level, c.linkval) >= ?')
    params.push(f.levelMin)
  }
  if (!pkm && f.levelMax !== undefined) {
    where.push('COALESCE(c.level, c.linkval) <= ?')
    params.push(f.levelMax)
  }
  if (f.owned === 'owned') where.push('o.n > 0')
  if (f.owned === 'missing') where.push('o.n IS NULL')
  if (f.favourites === true) where.push(favouriteSql(scope))
  return { sql: ` WHERE ${where.join(' AND ')}`, params }
}

/** One page of every card in the database, filtered and sorted. Cards missing the sort value go last. */
export function browseCards(db: SqlDb, f: BrowseFilters, scope: Scope = LOCAL): BrowsePage {
  const { sql, params } = whereClause(db, f, scope)
  const sortCol = sortSql(f.sort, scopeGame(db, scope))
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(Math.max(1, Math.floor(f.limit ?? 120)), MAX_LIMIT)
  const offset = Math.max(0, Math.floor(f.offset ?? 0))
  const language = languageOf(f)
  // Art and the default printing are looked up only for the page, after sorting and limiting. With
  // every language, an English printing is preselected over the rest.
  const rows = db
    .prepare(
      `SELECT page.*,
         COALESCE((SELECT image_id FROM card_images WHERE card_id = page.id AND +game = ${scope.game}
           ORDER BY sort_order, image_id LIMIT 1), page.id) AS image_id,
         (SELECT MIN(${SET_DATE}) FROM card_printings p
           JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
           ${ENGLISH_NAMESAKE('s')}
           WHERE p.card_id = page.id AND +p.game = ${scope.game}${inLanguage(language)} AND p.contributed = 0
             AND ${SET_DATE} IS NOT NULL) AS released_at,
         (SELECT p.id FROM card_printings p
           LEFT JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
           ${ENGLISH_NAMESAKE('s')}
           WHERE p.card_id = page.id AND +p.game = ${scope.game}${inLanguage(language)} AND p.contributed = 0
           ORDER BY p.language <> 'en', p.game = 'pkm' AND p.missing_from_api = 1, ${SET_DATE} IS NULL, ${SET_DATE}, p.id
           LIMIT 1) AS default_printing_id
       FROM (${base(scope, sortCol === SORT_SQL.released, language)}${sql} ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, c.name COLLATE NOCASE, c.id
         LIMIT ? OFFSET ?) page`
    )
    .all(...params, limit, offset) as BrowseRow[]
  const { n } = db
    .prepare(
      `SELECT count(*) AS n FROM cards c
       LEFT JOIN (SELECT p.card_id, SUM(e.quantity) AS n FROM collection_entries e
         JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game} WHERE ${scope.where('e')}
         GROUP BY p.card_id) o ON o.card_id = c.id${sql}`
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

/** Bump when browseFacets changes what it produces: stored rollups aren't rebuilt otherwise. */
const FACETS_ROLLUP = 2

/** browseFacets from its rollup: its answer depends on the catalog alone. */
export function browseFacetsFast(
  db: SqlDb,
  scope: Scope = LOCAL,
  language?: Language
): BrowseFacets {
  const lang = isLanguage(language) ? language : undefined
  return catalogRollup(
    db,
    `browseFacets:${FACETS_ROLLUP}:${scopeGame(db, scope)}:${lang ?? 'all'}`,
    () => browseFacets(db, scope, lang)
  )
}

/**
 * Filter options across the game's whole card database: the sets and rarities of the language
 * (every language's without one), and the languages that have printings.
 */
export function browseFacets(db: SqlDb, scope: Scope = LOCAL, language?: Language): BrowseFacets {
  const lang = inLanguage(isLanguage(language) ? language : undefined, 'card_printings')
  const distinct = (sql: string): string[] =>
    (db.prepare(sql).all() as { v: string }[]).map((r) => r.v)
  const col = (c: string): string[] =>
    distinct(
      `SELECT DISTINCT ${c} AS v FROM cards WHERE +game = ${scope.game} AND ${c} IS NOT NULL AND ${c} <> ''
       ORDER BY ${c}`
    )
  const pkm = scopeGame(db, scope) === 'pkm'
  return {
    cardTypes: pkm ? [] : col('type'),
    attributes: pkm ? [] : col('attribute'),
    races: pkm ? [] : col('race'),
    archetypes: pkm ? [] : col('archetype'),
    setNames: distinct(
      `SELECT DISTINCT set_name AS v FROM card_printings WHERE +game = ${scope.game} AND contributed = 0${lang}
       ORDER BY set_name`
    ),
    rarities: distinct(
      `SELECT DISTINCT set_rarity AS v FROM card_printings
       WHERE +game = ${scope.game} AND contributed = 0${lang} AND set_rarity <> ''
       ORDER BY set_rarity`
    ),
    // One indexed probe per language (no UNION: the server's SQLite caps compound selects).
    languages: LANGUAGES.map((l) => l.code).filter((code) =>
      db
        .prepare(
          `SELECT 1 FROM card_printings WHERE language = ? AND +game = ${scope.game} AND contributed = 0 LIMIT 1`
        )
        .get(code)
    ),
    ...(pkm ? pokemonFacets(db, scope, null) : {})
  }
}
