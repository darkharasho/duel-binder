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
  localName: string | null
}

const select = (
  scope: Scope
): string => `SELECT p.id AS printingId, p.card_id AS cardId, c.name AS name, c.frame_type AS frameType,
  p.set_name AS setName, p.set_code AS setCode, p.set_rarity AS rarity, p.language AS language,
  CASE WHEN ${isMarketOnly} THEN p.market_price WHEN p.language = 'en' THEN COALESCE(p.market_price, ip.price, p.set_price) ELSE COALESCE(ip.price, ${enTwinPrice(scope.game)}) END AS rawPrice,
  pc.local_name AS localName
  FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
  LEFT JOIN intl_prices ip ON ip.printing_id = p.id
  LEFT JOIN pokemon_cards pc ON pc.card_id = p.card_id
  WHERE +p.game = ${scope.game} AND p.contributed = 0`

const languageRank = (l: Language): number => LANGUAGES.findIndex((x) => x.code === l)

/**
 * Attaches each card's artwork ids and sorts by set code, then language, then rarity tier; with
 * twins, marks a Pokémon printing's unseenTwin (a scan of every card with no artwork per card,
 * so only for the few cards an art match brings).
 */
function withImages(db: SqlDb, rows: PrintingRow[], scope: Scope, twins = false): ScanPrinting[] {
  const ids = [...new Set(rows.map((r) => r.cardId))]
  const images = new Map<number, number[]>()
  // Cards and languages with an art twin the scanner can't see (ScanPrinting.unseenTwin).
  const twinned = new Set<string>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const unseen = !twins
      ? []
      : (db
          .prepare(
            // CROSS JOIN keeps this order: the few cards asked for first, then the cards with no
            // artwork, rather than every printing. A tcgplayer product photo is a poor reference,
            // often missing (a 403) or matched far behind the card it reprints, so it counts as none.
            // A Japanese card may be named in English or Japanese, and a blank as any run of _.
            `SELECT DISTINCT pc.card_id AS cardId, tp.language AS language
         FROM pokemon_cards pc CROSS JOIN cards c CROSS JOIN pokemon_cards t CROSS JOIN cards tc
         CROSS JOIN card_printings tp
         WHERE pc.card_id IN (${chunk.map(() => '?').join(',')}) AND c.id = pc.card_id
           AND (t.image_url IS NULL OR t.image_url LIKE 'https://tcgplayer-cdn.%')
           AND t.card_id <> pc.card_id AND t.illustrator IS pc.illustrator AND tc.id = t.card_id
           AND (lower(replace(tc.name, '_', '')) = lower(replace(c.name, '_', ''))
             OR COALESCE(t.local_name, tc.name) = COALESCE(pc.local_name, c.name))
           AND tp.card_id = t.card_id`
          )
          .all(...chunk) as { cardId: number; language: string }[])
    for (const t of unseen) twinned.add(`${t.cardId}|${t.language}`)
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
    .map(({ rawPrice, localName, ...r }) => ({
      ...r,
      price: parsePrice(rawPrice),
      imageIds: images.get(r.cardId) ?? [],
      // Only where the catalog has one, so a Yu-Gi-Oh printing is as it always was.
      ...(localName ? { localName } : {}),
      ...(twinned.has(`${r.cardId}|${r.language}`) ? { unseenTwin: true as const } : {})
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

interface NumberEntry {
  id: number
  total: string | null
  abbrev: string
}

// The game's printings by printed number, rebuilt only when the catalog version or game changes.
const numberCache = new WeakMap<
  object,
  { version: string | null; game: string; byNumber: Map<string, NumberEntry[]> }
>()

const stripZeros = (s: string): string => s.toUpperCase().replace(/^0+/, '')

/** A Pokémon set_code is "{abbrev} {localId}/{official}" or "{abbrev} {localId}" (scripts/catalog/pokemon/write.ts). */
function numberIndex(db: SqlDb, scope: Scope): Map<string, NumberEntry[]> {
  const version = getMeta(db, 'db_version')
  const { game } = db.prepare(`SELECT ${scope.game} AS game`).get() as { game: string }
  const hit = numberCache.get(db)
  if (hit && hit.version === version && hit.game === game) return hit.byNumber
  const rows = db
    .prepare(
      `SELECT p.id, p.set_code AS code FROM card_printings p WHERE +p.game = ${scope.game} AND p.contributed = 0`
    )
    .all() as { id: number; code: string }[]
  const byNumber = new Map<string, NumberEntry[]>()
  for (const { id, code } of rows) {
    const space = code.indexOf(' ')
    if (space < 0) continue
    const rest = code.slice(space + 1)
    const slash = rest.indexOf('/')
    const key = stripZeros(slash < 0 ? rest : rest.slice(0, slash))
    const entry = {
      id,
      total: slash < 0 ? null : stripZeros(rest.slice(slash + 1)),
      abbrev: code.slice(0, space).toUpperCase()
    }
    const list = byNumber.get(key)
    if (list) list.push(entry)
    else byNumber.set(key, [entry])
  }
  numberCache.set(db, { version, game, byNumber })
  return byNumber
}

/**
 * The Pokémon printings with this printed number (leading zeros ignored). A read total must equal
 * the code's total, so a code with no total (a promo) matches only when no total was read. The
 * abbreviation narrows the match only when some printing carries it (a card may print "PAL" where
 * TCGdex says "SV2"); otherwise the number alone decides.
 */
export function printingsByNumber(
  db: SqlDb,
  n: CollectorNumber,
  scope: Scope = LOCAL
): ScanPrinting[] {
  let found = numberIndex(db, scope).get(stripZeros(n.number)) ?? []
  if (n.total !== null) {
    const total = stripZeros(n.total)
    found = found.filter((e) => e.total === total)
  }
  if (n.setAbbrev) {
    const abbrev = n.setAbbrev.toUpperCase()
    const same = found.filter((e) => e.abbrev === abbrev)
    if (same.length) found = same
  }
  const ids = found.map((e) => e.id)
  const rows: PrintingRow[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    rows.push(
      ...(db
        .prepare(`${select(scope)} AND p.id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as PrintingRow[])
    )
  }
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
  return withImages(db, rows, scope, true)
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
