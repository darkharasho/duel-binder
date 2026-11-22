import type { SqlDb } from '../../../src/main/db/sql'
import { checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  MAX_PULL,
  replaces,
  type DeckPullResponse,
  type DeckPushResult,
  type WireDeck
} from '../../../src/shared/cloud'
import { DeckFieldError, checkDeckFields } from '../../../src/shared/decks/fields'
import type { DeckEntry } from '../../../src/shared/decks/types'
import { isGameId, type GameId } from '../../../src/shared/games'
import { NEXT_DECK_SEQ } from './scope'
import { checkTime, pageCursor } from './sync'

const MAX_UID = 64
/**
 * Most live decks one user may hold in one game on the server: a ceiling against abuse, well over
 * the 200 every device enforces on save.
 */
export const MAX_SERVER_DECKS_PER_GAME = 1000

/** Validates a decks push body; throws CollectionError (a 400) on anything malformed. */
export function checkDecksPush(body: unknown, now: Date): WireDeck[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireDeck => {
    const o = checkObject(v, 'Entry')
    if (typeof o.uid !== 'string' || !o.uid || o.uid.length > MAX_UID)
      throw new CollectionError('uid must be text')
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    let fields
    try {
      fields = checkDeckFields(o, o.game)
    } catch (e) {
      if (e instanceof DeckFieldError) throw new CollectionError(e.message)
      throw e
    }
    return {
      uid: o.uid,
      game: o.game,
      ...fields,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

/** The synced columns only: last_verdict and last_pack_version are per device and never read here. */
interface DeckRow {
  uid: string
  game: GameId
  format: string
  name: string
  notes: string
  cover: number | null
  private: number
  cards: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

const DECK_COLS =
  'uid, game, format, name, notes, cover, private, cards, created_at, updated_at, deleted_at, seq'

function parseCards(json: string): DeckEntry[] {
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? (v as DeckEntry[]) : []
  } catch {
    return []
  }
}

const toWire = (r: DeckRow): WireDeck => ({
  uid: r.uid,
  game: r.game,
  format: r.format,
  name: r.name,
  notes: r.notes,
  cover: r.cover,
  private: r.private === 1,
  cards: parseCards(r.cards),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/**
 * Applies pushed decks for `userId`, latest edit wins per uid. A row of a game outside `games` is
 * skipped, so the client keeps it and retries. Throws CollectionError (a 400, nothing written) when
 * the push would take the user past MAX_SERVER_DECKS_PER_GAME live decks of one game. The card ids
 * aren't checked against the catalog. A written row's last verdict is left as it is (NULL when new).
 */
export function applyDecksPush(
  db: SqlDb,
  userId: number,
  entries: WireDeck[],
  games: readonly GameId[]
): DeckPushResult[] {
  const find = db.prepare(`SELECT ${DECK_COLS} FROM decks WHERE user_id = ? AND uid = ?`)
  const liveCount = db.prepare(
    'SELECT COUNT(*) AS n FROM decks WHERE user_id = ? AND game = ? AND deleted_at IS NULL'
  )
  const write = db.prepare(
    `INSERT INTO decks (user_id, uid, game, format, name, notes, cover, private, cards,
       created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_DECK_SEQ})
     ON CONFLICT(user_id, uid) DO UPDATE SET game = excluded.game, format = excluded.format,
       name = excluded.name, notes = excluded.notes, cover = excluded.cover,
       private = excluded.private, cards = excluded.cards, created_at = excluded.created_at,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const checkCeiling = (): void => {
    const added = new Map<GameId, Set<string>>()
    for (const d of entries) {
      if (d.deletedAt !== null || !games.includes(d.game)) continue
      const existing = find.get(userId, d.uid) as DeckRow | undefined
      if (existing && existing.deleted_at === null) continue
      let uids = added.get(d.game)
      if (!uids) added.set(d.game, (uids = new Set()))
      uids.add(d.uid)
    }
    for (const [game, uids] of added) {
      const { n } = liveCount.get(userId, game) as { n: number }
      if (n + uids.size > MAX_SERVER_DECKS_PER_GAME)
        throw new CollectionError(
          `An account holds at most ${MAX_SERVER_DECKS_PER_GAME} decks in one game`
        )
    }
  }
  const applyOne = (d: WireDeck): DeckPushResult => {
    if (!games.includes(d.game)) return { uid: d.uid, status: 'skipped' }
    const existing = find.get(userId, d.uid) as DeckRow | undefined
    if (existing) {
      const current = toWire(existing)
      if (JSON.stringify(current) === JSON.stringify(d)) return { uid: d.uid, status: 'applied' }
      if (!replaces(d, current)) return { uid: d.uid, status: 'stale', current }
    } else if (d.deletedAt !== null) {
      // Nothing to delete; storing it would only grow the table.
      return { uid: d.uid, status: 'applied' }
    }
    write.run(
      userId,
      d.uid,
      d.game,
      d.format,
      d.name,
      d.notes,
      d.cover,
      d.private ? 1 : 0,
      JSON.stringify(d.cards),
      d.createdAt,
      d.updatedAt,
      d.deletedAt
    )
    return { uid: d.uid, status: 'applied' }
  }
  return db.transaction(() => {
    checkCeiling()
    return entries.map(applyOne)
  })()
}

/** The caller's decks of `game` written after `cursor`, tombstones included, in seq order. */
export function decksPullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): DeckPullResponse {
  const rows = db
    .prepare(
      `SELECT ${DECK_COLS} FROM decks WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?`
    )
    .all(userId, game, cursor, limit + 1) as DeckRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    entries: page.map(toWire),
    cursor: pageCursor(
      db,
      page.at(-1)?.seq,
      more,
      cursor,
      'SELECT MAX(seq) AS top FROM decks WHERE user_id = ?',
      userId
    ),
    more
  }
}
