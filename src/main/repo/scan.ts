import type { SqlDb } from '../db/sql'
import { getMeta } from '../db/meta'
import { rarityRank } from '../../shared/scan/rarity'
import { bestNameMatch, normalizeName, type NameEntry } from '../../shared/scan/names'
import { LANGUAGES, type Language } from '../../shared/languages'
import { parsePrice } from '../../shared/pricing'
import type { ScanPrinting } from '../../shared/scan/types'
import type { CollectorNumber } from '../../shared/scan/collectorNumber'
import { enTwinPrice } from './enTwin'
import { isMarketOnly } from './priceRule'
import { LOCAL, type Scope } from './scope'

interface PrintingRow {
  printingId: number
  cardId: number
  name: string
  frameType: string
  setName: string
  setCode: string
  rarity: string
  language: Language
  rawPrice: number | null
}

const select = (
  scope: Scope
): string => `SELECT p.id AS printingId, p.card_id AS cardId, c.name AS name, c.frame_type AS frameType,
  p.set_name AS setName, p.set_code AS setCode, p.set_rarity AS rarity, p.language AS language,
  CASE WHEN ${isMarketOnly} THEN p.market_price WHEN p.language = 'en' THEN COALESCE(p.market_price, ip.price, p.set_price) ELSE COALESCE(ip.price, ${enTwinPrice(scope.game)}) END AS rawPrice
  FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
  LEFT JOIN intl_prices ip ON ip.printing_id = p.id
  WHERE +p.game = ${scope.game} AND p.contributed = 0`

const languageRank = (l: Language): number => LANGUAGES.findIndex((x) => x.code === l)

/** Attaches each card's artwork ids and sorts by set code, then language, then rarity tier. */
function withImages(db: SqlDb, rows: PrintingRow[], scope: Scope): ScanPrinting[] {
  const ids = [...new Set(rows.map((r) => r.cardId))]
  const images = new Map<number, number[]>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const found = db
      .prepare(
        `SELECT card_id AS cardId, image_id AS imageId FROM card_images
         WHERE +game = ${scope.game} AND card_id IN (${chunk.map(() => '?').join(',')})
         ORDER BY card_id, sort_order`
      )
      .all(...chunk) as { cardId: number; imageId: number }[]
    for (const f of found) {
      const list = images.get(f.cardId)
      if (list) list.push(f.imageId)
      else images.set(f.cardId, [f.imageId])
    }
  }
  return rows
    .map(({ rawPrice, ...r }) => ({
      ...r,
      price: parsePrice(rawPrice),
      imageIds: images.get(r.cardId) ?? []
    }))
    .sort(
      (a, b) =>
        a.setCode.localeCompare(b.setCode) ||
        languageRank(a.language) - languageRank(b.language) ||
        rarityRank(a.rarity) - rarityRank(b.rarity) ||
        a.printingId - b.printingId
    )
}

export function printingsByCode(db: SqlDb, code: string, scope: Scope = LOCAL): ScanPrinting[] {
  const rows = db
    .prepare(`${select(scope)} AND p.set_code = ? COLLATE NOCASE`)
    .all(code) as PrintingRow[]
  return withImages(db, rows, scope)
}

// A Pokémon set_code is "{abbrev} {localId}/{official}" or "{abbrev} {localId}" (scripts/catalog/pokemon/write.ts).
const CODE_REST = `substr(p.set_code, instr(p.set_code, ' ') + 1)`
const CODE_NUMBER = `CASE WHEN instr(${CODE_REST}, '/') > 0 THEN substr(${CODE_REST}, 1, instr(${CODE_REST}, '/') - 1) ELSE ${CODE_REST} END`
const CODE_TOTAL = `CASE WHEN instr(${CODE_REST}, '/') > 0 THEN substr(${CODE_REST}, instr(${CODE_REST}, '/') + 1) END`

/**
 * The Pokémon printings with this printed number (leading zeros ignored), and this set total when
 * read. A printing whose code has no total still matches a read total. The abbreviation narrows
 * the match only when some printing carries it (a card may print "PAL" where TCGdex says "SV2"):
 * a prefix scan on the set_code index, with the number alone as the fallback. Without an
 * abbreviation this reads every printing of the game; the catalog has no index on the number.
 */
export function printingsByNumber(
  db: SqlDb,
  n: CollectorNumber,
  scope: Scope = LOCAL
): ScanPrinting[] {
  const sql = (abbrev: boolean): string =>
    `${select(scope)}
     ${abbrev ? 'AND p.set_code LIKE ?' : ''}
     AND ltrim(${CODE_NUMBER}, '0') = ltrim(?, '0') COLLATE NOCASE
     ${n.total === null ? '' : `AND (${CODE_TOTAL} IS NULL OR ltrim(${CODE_TOTAL}, '0') = ltrim(?, '0') COLLATE NOCASE)`}`
  const rest = n.total === null ? [n.number] : [n.number, n.total]
  const abbrev = n.setAbbrev && /^[A-Za-z0-9]+$/.test(n.setAbbrev) ? n.setAbbrev : null
  let rows: PrintingRow[] = []
  if (abbrev) rows = db.prepare(sql(true)).all(`${abbrev} %`, ...rest) as PrintingRow[]
  if (!rows.length) rows = db.prepare(sql(false)).all(...rest) as PrintingRow[]
  return withImages(db, rows, scope)
}

export function printingsForSet(
  db: SqlDb,
  setName: string,
  language: Language,
  scope: Scope = LOCAL
): ScanPrinting[] {
  const rows = db
    .prepare(`${select(scope)} AND p.set_name = ? AND p.language = ?`)
    .all(setName, language) as PrintingRow[]
  return withImages(db, rows, scope)
}

export function printingsForCards(
  db: SqlDb,
  cardIds: number[],
  scope: Scope = LOCAL
): ScanPrinting[] {
  const ids = [...new Set(cardIds)]
  const rows: PrintingRow[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    rows.push(
      ...(db
        .prepare(`${select(scope)} AND p.card_id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as PrintingRow[])
    )
  }
  return withImages(db, rows, scope)
}

/** The card of each known artwork, by image id; unknown ids are left out. */
export function cardsForImages(
  db: SqlDb,
  imageIds: number[],
  scope: Scope = LOCAL
): { imageId: number; cardId: number }[] {
  const ids = [...new Set(imageIds)]
  const out: { imageId: number; cardId: number }[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    out.push(
      ...(db
        .prepare(
          `SELECT image_id AS imageId, card_id AS cardId FROM card_images
           WHERE +game = ${scope.game} AND image_id IN (${chunk.map(() => '?').join(',')})`
        )
        .all(...chunk) as { imageId: number; cardId: number }[])
    )
  }
  return out.sort((a, b) => a.imageId - b.imageId)
}

// The game's name list, normalized for matching, is rebuilt only when the catalog version or game changes.
const nameCache = new WeakMap<
  object,
  { version: string | null; game: string; names: NameEntry[] }
>()

function cardNames(db: SqlDb, scope: Scope): NameEntry[] {
  const version = getMeta(db, 'db_version')
  const { game } = db.prepare(`SELECT ${scope.game} AS game`).get() as { game: string }
  const hit = nameCache.get(db)
  if (hit && hit.version === version && hit.game === game) return hit.names
  const rows = db.prepare('SELECT id, name FROM cards WHERE game = ?').all(game) as {
    id: number
    name: string
  }[]
  const names = rows.map((r) => ({ ...r, norm: normalizeName(r.name) }))
  nameCache.set(db, { version, game, names })
  return names
}

export function matchName(
  db: SqlDb,
  text: string,
  scope: Scope = LOCAL
): { cardId: number; name: string; score: number } | null {
  const names = cardNames(db, scope)
  const best = bestNameMatch(text, names)
  if (!best) return null
  const name = names.find((n) => n.id === best.id)?.name
  return name === undefined ? null : { cardId: best.id, name, score: best.score }
}
