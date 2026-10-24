import type Database from 'better-sqlite3'
import { getStats, recordSnapshot } from '../repo/stats'

/** Sets to own, with the share of each set's distinct cards to own. Missing sets are skipped. */
const SET_PLAN: [setName: string, share: number][] = [
  ['Legend of Blue Eyes White Dragon', 1],
  ['Metal Raiders', 0.7],
  ['Starter Deck: Yugi', 0.5],
  ["Pharaoh's Servant", 0.35],
  ['Spell Ruler', 0.15]
]
const EXTRA_PRINTINGS = 60
const HISTORY_DAYS = 90
const SEED = 0x59474f

/** Deterministic PRNG (mulberry32) so every fresh fake profile looks the same. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Fills an empty collection with sample entries drawn from the synced catalogue, plus a value
 * history for the dashboard. No-op when the collection already has entries or no cards are synced.
 * Returns the number of entries inserted.
 */
export function seedFakeCollection(db: Database.Database, now = new Date()): number {
  if (db.prepare('SELECT 1 FROM collection_entries LIMIT 1').get()) return 0
  if (!db.prepare('SELECT 1 FROM cards LIMIT 1').get()) return 0

  const rand = rng(SEED)
  const quantity = (): number => 1 + Math.floor(rand() * 3)
  const picks = new Map<number, number>() // printing id → quantity

  const cardsInSet = db.prepare(
    `SELECT DISTINCT card_id FROM card_printings WHERE set_name = ? AND missing_from_api = 0 AND language = 'en' ORDER BY card_id`
  )
  const printingsOf = db.prepare(
    `SELECT id FROM card_printings WHERE set_name = ? AND card_id = ? AND missing_from_api = 0 AND language = 'en' ORDER BY id`
  )
  for (const [setName, share] of SET_PLAN) {
    const cardIds = (cardsInSet.all(setName) as { card_id: number }[]).map((r) => r.card_id)
    const owned = shuffle(cardIds, rand).slice(0, Math.ceil(cardIds.length * share))
    for (const cardId of owned) {
      const ids = (printingsOf.all(setName, cardId) as { id: number }[]).map((r) => r.id)
      picks.set(ids[Math.floor(rand() * ids.length)], quantity())
    }
  }

  const allPrintings = (
    db.prepare(`SELECT id FROM card_printings WHERE missing_from_api = 0 AND language = 'en' ORDER BY id`).all() as {
      id: number
    }[]
  ).map((r) => r.id)
  for (let i = 0; i < EXTRA_PRINTINGS && allPrintings.length > 0; i++) {
    picks.set(allPrintings[Math.floor(rand() * allPrintings.length)], quantity())
  }

  const firstImage = db.prepare(
    `SELECT i.image_id FROM card_printings p JOIN card_images i ON i.card_id = p.card_id
     WHERE p.id = ? ORDER BY i.sort_order LIMIT 1`
  )
  const insert = db.prepare(
    `INSERT OR IGNORE INTO collection_entries (printing_id, image_id, quantity, notes, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`
  )
  const snapshot = db.prepare(
    'INSERT OR REPLACE INTO value_snapshots (date, total_value, total_cards) VALUES (?, ?, ?)'
  )

  let inserted = 0
  db.transaction(() => {
    const ts = now.toISOString()
    for (const [printingId, qty] of picks) {
      const image = firstImage.get(printingId) as { image_id: number } | undefined
      if (!image) continue
      inserted += insert.run(printingId, image.image_id, qty, ts, ts).changes
    }

    // A collection that grew toward today's totals, with some day-to-day price noise.
    const { totalValue, totalCards } = getStats(db)
    for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
      const growth = 0.55 + 0.45 * (1 - daysAgo / HISTORY_DAYS)
      const noise = 0.95 + rand() * 0.1
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo)
      snapshot.run(
        localDate(day),
        Math.round(totalValue * growth * noise * 100) / 100,
        Math.round(totalCards * growth)
      )
    }
    recordSnapshot(db, now)
  })()
  return inserted
}
