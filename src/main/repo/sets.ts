import type Database from 'better-sqlite3'
import { pickDefaultCode, setNumber, setPrefix } from '../../shared/sets'
import type { ChecklistCard, ChecklistRarity, SetChecklist, SetSummary } from '../../shared/types'
import { setImageKey } from '../images/cache'
import { addEntry, CollectionError } from './collection'

interface SummaryDbRow {
  set_name: string
  s_code: string | null
  min_code: string
  tcg_date: string | null
  image_url: string | null
  total_cards: number
  owned_cards: number
  total_rarities: number
  owned_rarities: number
}

// One row per distinct set_name. A (card, rarity) pair is keyed as "<card_id>|<rarity>";
// card_id is an integer, so the first "|" always ends it.
const SUMMARY = `
  SELECT p.set_name, s.set_code AS s_code, MIN(p.set_code) AS min_code, s.tcg_date, s.image_url,
         COUNT(DISTINCT p.card_id) AS total_cards,
         COUNT(DISTINCT CASE WHEN o.printing_id IS NOT NULL THEN p.card_id END) AS owned_cards,
         COUNT(DISTINCT p.card_id || '|' || p.set_rarity) AS total_rarities,
         COUNT(DISTINCT CASE WHEN o.printing_id IS NOT NULL THEN p.card_id || '|' || p.set_rarity END)
           AS owned_rarities
  FROM card_printings p
  LEFT JOIN (SELECT DISTINCT printing_id FROM collection_entries) o ON o.printing_id = p.id
  LEFT JOIN sets s ON s.set_name = p.set_name`

function toSummary(r: SummaryDbRow): SetSummary {
  return {
    setName: r.set_name,
    setCode: r.s_code ? r.s_code : setPrefix(r.min_code),
    tcgDate: r.tcg_date,
    imageKey: setImageKey(r.image_url),
    totalCards: r.total_cards,
    ownedCards: r.owned_cards,
    totalRarities: r.total_rarities,
    ownedRarities: r.owned_rarities
  }
}

/** Completion summary of every set; unsorted. */
export function listSets(db: Database.Database): SetSummary[] {
  return (db.prepare(`${SUMMARY} GROUP BY p.set_name`).all() as SummaryDbRow[]).map(toSummary)
}

interface PrintingDbRow {
  id: number
  card_id: number
  set_code: string
  set_rarity: string
  name: string
  type: string
  image_id: number | null
}

interface EntryDbRow {
  id: number
  printing_id: number
  quantity: number
  updated_at: string
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Most recently updated entry (ties: highest id). */
function latest(entries: EntryDbRow[]): number | null {
  let best: EntryDbRow | null = null
  for (const e of entries) {
    if (
      !best ||
      e.updated_at > best.updated_at ||
      (e.updated_at === best.updated_at && e.id > best.id)
    )
      best = e
  }
  return best?.id ?? null
}

const sum = (entries: EntryDbRow[]): number => entries.reduce((n, e) => n + e.quantity, 0)

/** Checklist cards of a set, optionally limited to one card, sorted by number (nulls last) then name. */
function checklistCards(db: Database.Database, setName: string, cardId?: number): ChecklistCard[] {
  const cardFilter = cardId === undefined ? '' : ' AND p.card_id = ?'
  const params = cardId === undefined ? [setName] : [setName, cardId]
  const printings = db
    .prepare(
      `SELECT p.id, p.card_id, p.set_code, p.set_rarity, c.name, c.type,
              (SELECT i.image_id FROM card_images i WHERE i.card_id = c.id
               ORDER BY i.sort_order, i.image_id LIMIT 1) AS image_id
       FROM card_printings p JOIN cards c ON c.id = p.card_id
       WHERE p.set_name = ?${cardFilter}`
    )
    .all(...params) as PrintingDbRow[]
  const entries = db
    .prepare(
      `SELECT e.id, e.printing_id, e.quantity, e.updated_at
       FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id
       WHERE p.set_name = ?${cardFilter}`
    )
    .all(...params) as EntryDbRow[]

  const entriesByPrinting = new Map<number, EntryDbRow[]>()
  for (const e of entries) {
    const list = entriesByPrinting.get(e.printing_id) ?? []
    list.push(e)
    entriesByPrinting.set(e.printing_id, list)
  }
  const byCard = new Map<number, PrintingDbRow[]>()
  for (const p of printings) {
    const list = byCard.get(p.card_id) ?? []
    list.push(p)
    byCard.set(p.card_id, list)
  }

  const cards: ChecklistCard[] = []
  for (const [id, rows] of byCard) {
    const byRarity = new Map<string, PrintingDbRow[]>()
    for (const p of rows) {
      const list = byRarity.get(p.set_rarity) ?? []
      list.push(p)
      byRarity.set(p.set_rarity, list)
    }
    const rarities: ChecklistRarity[] = [...byRarity]
      .sort(([a], [b]) => cmp(a, b))
      .map(([rarity, ps]) => {
        const codes = ps
          .map((p) => ({
            printingId: p.id,
            setCode: p.set_code,
            owned: sum(entriesByPrinting.get(p.id) ?? [])
          }))
          .sort((a, b) => cmp(a.setCode, b.setCode))
        const rarityEntries = ps.flatMap((p) => entriesByPrinting.get(p.id) ?? [])
        return {
          rarity,
          owned: sum(rarityEntries),
          codes,
          defaultPrintingId: codes[pickDefaultCode(codes)].printingId,
          entryId: latest(rarityEntries)
        }
      })

    let lowest: { number: number | null; label: string } = { number: null, label: '' }
    for (const p of rows) {
      const n = setNumber(p.set_code)
      if (n.number !== null && (lowest.number === null || n.number < lowest.number)) lowest = n
    }
    const cardEntries = rows.flatMap((p) => entriesByPrinting.get(p.id) ?? [])
    cards.push({
      cardId: id,
      name: rows[0].name,
      type: rows[0].type,
      number: lowest.number,
      numberLabel: lowest.label,
      imageId: rows[0].image_id ?? 0,
      owned: sum(cardEntries),
      entryId: latest(cardEntries),
      rarities
    })
  }
  return cards.sort((a, b) => {
    if (a.number !== b.number) {
      if (a.number === null) return 1
      if (b.number === null) return -1
      return a.number - b.number
    }
    return a.name.localeCompare(b.name)
  })
}

/** The set's summary and checklist; null when no printing has that set_name. */
export function getChecklist(db: Database.Database, setName: string): SetChecklist | null {
  const row = db.prepare(`${SUMMARY} WHERE p.set_name = ? GROUP BY p.set_name`).get(setName) as
    SummaryDbRow | undefined
  if (!row) return null
  return { set: toSummary(row), cards: checklistCards(db, setName) }
}

/**
 * Adds one copy of a printing (original art) or removes one (original-art entry first,
 * else the most recently updated). Removing with no entry is a no-op.
 * Returns the printing's card as it now appears in the set's checklist.
 */
export function adjustPrinting(
  db: Database.Database,
  setName: string,
  printingId: number,
  delta: 1 | -1,
  now = new Date()
): ChecklistCard {
  if (delta !== 1 && delta !== -1) throw new CollectionError('Adjustment must be +1 or -1')
  return db.transaction(() => {
    const p = db
      .prepare('SELECT card_id, set_name FROM card_printings WHERE id = ?')
      .get(printingId) as { card_id: number; set_name: string } | undefined
    if (!p || p.set_name !== setName)
      throw new CollectionError(`Printing ${printingId} is not in ${setName}`)
    const original = db
      .prepare(
        'SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order, image_id LIMIT 1'
      )
      .get(p.card_id) as { image_id: number } | undefined

    if (delta === 1) {
      if (!original) throw new CollectionError('The card has no image')
      addEntry(db, { printingId, imageId: original.image_id, quantity: 1 }, now)
    } else {
      const entry = db
        .prepare(
          `SELECT id, quantity FROM collection_entries WHERE printing_id = ?
           ORDER BY image_id = ? DESC, updated_at DESC, id DESC LIMIT 1`
        )
        .get(printingId, original?.image_id ?? null) as { id: number; quantity: number } | undefined
      if (entry && entry.quantity > 1) {
        db.prepare(
          'UPDATE collection_entries SET quantity = quantity - 1, updated_at = ? WHERE id = ?'
        ).run(now.toISOString(), entry.id)
      } else if (entry) {
        db.prepare('DELETE FROM collection_entries WHERE id = ?').run(entry.id)
      }
    }
    return checklistCards(db, setName, p.card_id)[0]
  })()
}
