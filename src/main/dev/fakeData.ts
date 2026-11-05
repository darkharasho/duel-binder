import type Database from 'better-sqlite3'
import { getStats, recordSnapshot } from '../repo/stats'
import { checkSessionCards } from '../repo/scanSessions'
import { RARITY_LABEL } from '../db/schema'
import type { ScanSessionCard } from '../../shared/scanSessions'

/** Sets to own, with the share of each set's distinct cards to own. Missing sets are skipped. */
const SET_PLAN: [setName: string, share: number][] = [
  ['Legend of Blue Eyes White Dragon', 1],
  ['Metal Raiders', 0.7],
  ['Starter Deck: Yugi', 0.5],
  ["Pharaoh's Servant", 0.35],
  ['Spell Ruler', 0.15]
]
const PKM_SET_PLAN: [setName: string, share: number][] = [
  ['Base Set', 0.7],
  ['Jungle', 0.5],
  ['Fossil', 0.5],
  ['151', 0.5],
  ['Evolving Skies', 0.3],
  ['Prismatic Evolutions', 0.3]
]
const EXTRA_PRINTINGS = 60
const HISTORY_DAYS = 90
const SEED = 0x59474f

/** Deterministic PRNG (mulberry32) so every fresh fake profile looks the same. */
export function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
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
  if (
    db
      .prepare('SELECT 1 FROM collection_entries WHERE owner_id = 0 AND deleted_at IS NULL LIMIT 1')
      .get()
  )
    return 0
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
    db
      .prepare(
        `SELECT id FROM card_printings WHERE missing_from_api = 0 AND language = 'en' AND card_id IN (SELECT id FROM cards WHERE game = 'ygo') ORDER BY id`
      )
      .all() as {
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
    `INSERT OR IGNORE INTO collection_entries (uid, printing_id, image_id, quantity, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?)`
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
      inserted += insert.run(crypto.randomUUID(), printingId, image.image_id, qty, ts, ts).changes
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

/**
 * Adds sample Pokémon entries to a profile whose catalog has Pokémon (the site's screenshots).
 * No-op once it holds any. Returns the number of entries inserted.
 */
export function seedFakePokemon(db: Database.Database, now = new Date()): number {
  const has = `SELECT 1 FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id
     JOIN cards c ON c.id = p.card_id WHERE e.owner_id = 0 AND c.game = 'pkm' AND e.deleted_at IS NULL LIMIT 1`
  if (db.prepare(has).get()) return 0

  const rand = rng(SEED)
  const printings = db.prepare(
    `SELECT p.id, p.card_id, i.image_id FROM card_printings p
     JOIN cards c ON c.id = p.card_id JOIN card_images i ON i.card_id = p.card_id
     WHERE c.game = 'pkm' AND p.set_name = ? AND p.language = 'en' AND p.missing_from_api = 0
     ORDER BY p.id`
  )
  const insert = db.prepare(
    `INSERT OR IGNORE INTO collection_entries (uid, game, printing_id, image_id, quantity, notes, created_at, updated_at)
     VALUES (?, 'pkm', ?, ?, ?, '', ?, ?)`
  )
  let inserted = 0
  db.transaction(() => {
    const ts = now.toISOString()
    for (const [setName, share] of PKM_SET_PLAN) {
      const byCard = new Map<number, { id: number; image_id: number }[]>()
      for (const p of printings.all(setName) as { id: number; card_id: number; image_id: number }[])
        byCard.set(p.card_id, [...(byCard.get(p.card_id) ?? []), p])
      const owned = shuffle([...byCard.values()], rand).slice(0, Math.ceil(byCard.size * share))
      for (const versions of owned) {
        const p = versions[Math.floor(rand() * versions.length)]
        const quantity = 1 + Math.floor(rand() * 3)
        inserted += insert.run(crypto.randomUUID(), p.id, p.image_id, quantity, ts, ts).changes
      }
    }
  })()
  return inserted
}

/**
 * Sample scan sessions per game, drawn from the cards the fake profile owns: one big enough to need
 * "+N more", two on the same day, one hidden from friends, and older ones going back weeks.
 * Hours before `now`, card count, and whether it is hidden.
 */
const SESSION_PLAN: [hoursAgo: number, cards: number, hidden: boolean][] = [
  [2, 40, false],
  [7, 9, false],
  [27, 3, false],
  [74, 1, true],
  [220, 16, false],
  [650, 6, false]
]

/**
 * Adds sample scan sessions for each game whose fake collection exists and has none yet. They are
 * marked as sent, so a later sign-in doesn't push them. Returns the number of sessions inserted.
 */
export function seedFakeSessions(db: Database.Database, now = new Date()): number {
  let inserted = 0
  db.transaction(() => {
    for (const game of ['ygo', 'pkm'] as const)
      inserted += seedSessionsFor(db, 0, game, SESSION_PLAN, rng(SEED + game.length), now)
  })()
  return inserted
}

/**
 * Sessions per `plan` for one owner and game, drawn from the cards that owner has, marked as sent.
 * No-op when the owner has a session of that game or no cards with a sync key. Returns the number
 * inserted.
 */
export function seedSessionsFor(
  db: Database.Database,
  owner: number,
  game: 'ygo' | 'pkm',
  plan: [hoursAgo: number, cards: number, hidden: boolean][],
  rand: () => number,
  now: Date
): number {
  if (
    db
      .prepare('SELECT 1 FROM scan_sessions WHERE owner_id = ? AND game = ? LIMIT 1')
      .get(owner, game)
  )
    return 0
  type Owned = Omit<ScanSessionCard, 'photoId' | 'quantity' | 'guess' | 'addedAt'>
  const owned = db
    .prepare(
      `SELECT p.id AS printingId, p.card_id AS cardId, p.pkey, e.image_id AS imageId, c.name,
              p.set_code AS setCode, ${RARITY_LABEL} AS rarity,
              COALESCE(p.market_price, p.set_price) AS price
       FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id
       JOIN cards c ON c.id = p.card_id
       WHERE e.owner_id = ? AND c.game = ? AND e.deleted_at IS NULL AND p.pkey IS NOT NULL
       ORDER BY e.printing_id`
    )
    .all(owner, game) as Owned[]
  const pool = shuffle(owned, rand)
  if (pool.length === 0) return 0
  const insert = db.prepare(
    `INSERT OR IGNORE INTO scan_sessions (owner_id, uid, game, cards, friends_visible, created_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  )
  let inserted = 0
  let next = 0
  for (const [hoursAgo, size, hidden] of plan) {
    const start = now.getTime() - hoursAgo * 3_600_000
    const picked = Array.from(
      { length: Math.min(size, pool.length) },
      () => pool[next++ % pool.length]
    )
    const cards = checkSessionCards(
      picked.map((c, i) => ({
        ...c,
        photoId: null,
        quantity: rand() < 0.2 ? 2 + Math.floor(rand() * 2) : 1,
        guess: rand() < 0.1,
        addedAt: start + i * 4_000
      }))
    )
    const at = new Date(start + cards.length * 4_000).toISOString()
    inserted += insert.run(
      owner,
      crypto.randomUUID(),
      game,
      JSON.stringify(cards),
      hidden ? 0 : 1,
      at,
      at
    ).changes
  }
  return inserted
}
