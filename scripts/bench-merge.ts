/**
 * Speed check for merging two accounts (account linking, Task 4). Builds an in-memory server
 * database with two accounts of 20,000 cards each, half of them the same (printing, art), and
 * times the merge screen's preview (planCardMerge + cardTotal for all four choices) and one
 * `higher` merge. 40,000 entries and a few hundred catalog rows; nothing is written to disk.
 *
 * Run: npx tsx scripts/bench-merge.ts
 *
 * Limit: the merge well under 5 s.
 */
import Database from 'better-sqlite3'
import { performance } from 'node:perf_hooks'
import { migrateServer } from '../workers/portal/src/migrate'
import { mergeAccounts } from '../workers/portal/src/merge'
import { cardTotal, planCardMerge } from '../workers/portal/src/mergePlan'
import type { CardChoice } from '../src/shared/account'

const PER_ACCOUNT = 20_000
const PRINTINGS = 200
const IMAGES = 150 // PRINTINGS × IMAGES = 30,000 distinct cards, enough for 20,000 + 10,000
const TS = '2026-10-24T10:00:00.000Z'

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
migrateServer(db)

db.transaction(() => {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (1, 'Dragon', 'Normal Monster', 'normal', 'Dragon', '', ?, 'ygo')`
  ).run(TS)
  const image = db.prepare(
    "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, 1, ?, 'ygo')"
  )
  for (let i = 1; i <= IMAGES; i++) image.run(i, i)
  const printing = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, game)
     VALUES (1, 'Set', ?, 'Rare', 'ygo')`
  )
  for (let i = 0; i < PRINTINGS; i++) printing.run(`S-${i}`)
  const user = db.prepare(
    'INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  user.run(1, '111', 'survivor', TS, TS)
  user.run(2, 'apple:sub2', 'closed', TS, TS)
  db.prepare(
    "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '111', 1, ?)"
  ).run(TS)
  db.prepare(
    "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('apple', 'sub2', 2, ?)"
  ).run(TS)

  const ids = (
    db.prepare('SELECT id FROM card_printings ORDER BY id').all() as { id: number }[]
  ).map((r) => r.id)
  const entry = db.prepare(
    `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, notes,
       created_at, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`
  )
  let seq = 0
  const add = (user: number, key: number): void => {
    const printingId = ids[Math.floor(key / IMAGES)]
    const imageId = (key % IMAGES) + 1
    entry.run(user, `u${user}-${key}`, printingId, imageId, 1 + (key % 4), TS, TS, ++seq)
  }
  // Survivor: cards 0 … 19,999. Closed: 10,000 … 29,999, so 10,000 match.
  for (let k = 0; k < PER_ACCOUNT; k++) add(1, k)
  for (let k = PER_ACCOUNT / 2; k < PER_ACCOUNT * 1.5; k++) add(2, k)
})()

const live = (userId: number): number =>
  (
    db
      .prepare(
        'SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL'
      )
      .get(userId) as { n: number }
  ).n

let t = performance.now()
const totals = Object.fromEntries(
  (['higher', 'mine', 'theirs', 'sum'] as CardChoice[]).map((c) => [
    c,
    cardTotal(db, 1, planCardMerge(db, 1, 2, c))
  ])
)
const previewMs = performance.now() - t

t = performance.now()
mergeAccounts(db, {
  survivor: 1,
  closed: 2,
  cards: 'higher',
  username: 'mine',
  moved: { provider: 'apple', subject: 'sub2' },
  appleRefreshToken: null,
  now: new Date('2026-11-02T12:00:00.000Z')
})
const mergeMs = performance.now() - t

const after = live(1)
console.log(`entries: ${PER_ACCOUNT} + ${PER_ACCOUNT}, ${PER_ACCOUNT / 2} shared`)
console.log(`preview (4 choices): ${previewMs.toFixed(0)} ms; totals ${JSON.stringify(totals)}`)
console.log(`merge (higher): ${mergeMs.toFixed(0)} ms; survivor now ${after} cards`)
if (after !== totals.higher) {
  console.error(`MISMATCH: preview said ${totals.higher}, merge left ${after}`)
  process.exit(1)
}
if (mergeMs >= 5000) {
  console.error('Too slow: the merge must stay well under 5 s')
  process.exit(1)
}
