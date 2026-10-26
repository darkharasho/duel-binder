import type { SqlDb } from '../db/sql'
import { getMeta } from '../db/meta'
import { rarityRank } from '../../shared/scan/rarity'
import { bestNameMatch } from '../../shared/scan/names'
import { LANGUAGES, type Language } from '../../shared/languages'
import type { ScanPrinting } from '../../shared/scan/types'

interface PrintingRow {
  printingId: number
  cardId: number
  name: string
  frameType: string
  setName: string
  setCode: string
  rarity: string
  language: Language
}

const SELECT = `SELECT p.id AS printingId, p.card_id AS cardId, c.name AS name, c.frame_type AS frameType,
  p.set_name AS setName, p.set_code AS setCode, p.set_rarity AS rarity, p.language AS language
  FROM card_printings p JOIN cards c ON c.id = p.card_id`

const languageRank = (l: Language): number => LANGUAGES.findIndex((x) => x.code === l)

/** Attaches each card's artwork ids and sorts by set code, then language, then rarity tier. */
function withImages(db: SqlDb, rows: PrintingRow[]): ScanPrinting[] {
  const ids = [...new Set(rows.map((r) => r.cardId))]
  const images = new Map<number, number[]>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const found = db
      .prepare(
        `SELECT card_id AS cardId, image_id AS imageId FROM card_images
         WHERE card_id IN (${chunk.map(() => '?').join(',')}) ORDER BY card_id, sort_order`
      )
      .all(...chunk) as { cardId: number; imageId: number }[]
    for (const f of found) {
      const list = images.get(f.cardId)
      if (list) list.push(f.imageId)
      else images.set(f.cardId, [f.imageId])
    }
  }
  return rows
    .map((r) => ({ ...r, imageIds: images.get(r.cardId) ?? [] }))
    .sort(
      (a, b) =>
        a.setCode.localeCompare(b.setCode) ||
        languageRank(a.language) - languageRank(b.language) ||
        rarityRank(a.rarity) - rarityRank(b.rarity) ||
        a.printingId - b.printingId
    )
}

export function printingsByCode(db: SqlDb, code: string): ScanPrinting[] {
  const rows = db
    .prepare(`${SELECT} WHERE p.set_code = ? COLLATE NOCASE`)
    .all(code) as PrintingRow[]
  return withImages(db, rows)
}

export function printingsForSet(db: SqlDb, setName: string, language: Language): ScanPrinting[] {
  const rows = db
    .prepare(`${SELECT} WHERE p.set_name = ? AND p.language = ?`)
    .all(setName, language) as PrintingRow[]
  return withImages(db, rows)
}

export function printingsForCards(db: SqlDb, cardIds: number[]): ScanPrinting[] {
  const ids = [...new Set(cardIds)]
  const rows: PrintingRow[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    rows.push(
      ...(db
        .prepare(`${SELECT} WHERE p.card_id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as PrintingRow[])
    )
  }
  return withImages(db, rows)
}

// The English name list is rebuilt only when the catalog version changes.
const nameCache = new WeakMap<
  object,
  { version: string | null; names: { id: number; name: string }[] }
>()

function cardNames(db: SqlDb): { id: number; name: string }[] {
  const version = getMeta(db, 'db_version')
  const hit = nameCache.get(db)
  if (hit && hit.version === version) return hit.names
  const names = db.prepare('SELECT id, name FROM cards').all() as { id: number; name: string }[]
  nameCache.set(db, { version, names })
  return names
}

export function matchName(
  db: SqlDb,
  text: string
): { cardId: number; name: string; score: number } | null {
  const names = cardNames(db)
  const best = bestNameMatch(text, names)
  if (!best) return null
  const name = names.find((n) => n.id === best.id)?.name
  return name === undefined ? null : { cardId: best.id, name, score: best.score }
}
