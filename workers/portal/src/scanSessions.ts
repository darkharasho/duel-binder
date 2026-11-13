import type { SqlDb } from '../../../src/main/db/sql'
import { checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  checkSessionCards,
  localizeSessions,
  mergeSessionCards
} from '../../../src/main/repo/scanSessions'
import { MAX_PULL, replaces } from '../../../src/shared/cloud'
import { isGameId, type GameId } from '../../../src/shared/games'
import type {
  ScanSession,
  ScanSessionCard,
  ScanSessionPullResponse,
  ScanSessionPushResult,
  WireScanSession
} from '../../../src/shared/scanSessions'
import { NEXT_SESSION_SEQ } from './scope'
import { checkTime, pageCursor } from './sync'

const MAX_UID = 64

interface SessionRow {
  uid: string
  game: GameId
  cards: string
  friends_visible: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

/** Validates a sessions push body; throws CollectionError (a 400) on anything malformed. */
export function checkSessionPush(body: unknown, now: Date): WireScanSession[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireScanSession => {
    const o = checkObject(v, 'Entry')
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    if (typeof o.uid !== 'string' || o.uid.length < 1 || o.uid.length > MAX_UID)
      throw new CollectionError(`uid must be a string of 1 to ${MAX_UID} characters`)
    if (typeof o.friendsVisible !== 'boolean')
      throw new CollectionError('friendsVisible must be true or false')
    return {
      uid: o.uid,
      game: o.game,
      cards: checkSessionCards(o.cards),
      friendsVisible: o.friendsVisible,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

const wire = (r: SessionRow): WireScanSession => ({
  uid: r.uid,
  game: r.game,
  cards: JSON.parse(r.cards) as ScanSessionCard[],
  friendsVisible: r.friends_visible !== 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

const sameCard = (a: ScanSessionCard, b: ScanSessionCard): boolean =>
  (Object.keys(a) as (keyof ScanSessionCard)[]).length ===
    (Object.keys(b) as (keyof ScanSessionCard)[]).length &&
  (Object.keys(a) as (keyof ScanSessionCard)[]).every((k) => a[k] === b[k])

const sameCards = (a: ScanSessionCard[], b: ScanSessionCard[]): boolean =>
  a.length === b.length && a.every((c, i) => sameCard(c, b[i]))

/** Whether two sessions hold the same data, whatever order their keys came in. */
function sameSession(a: WireScanSession, b: WireScanSession): boolean {
  return (
    a.uid === b.uid &&
    a.game === b.game &&
    a.friendsVisible === b.friendsVisible &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.deletedAt === b.deletedAt &&
    sameCards(a.cards, b.cards)
  )
}

/**
 * Applies pushed sessions for `userId`, latest edit wins per uid. A session of a game outside
 * `games` is skipped, so the client keeps it and retries. A tombstone for an unknown uid is not stored.
 */
export function applySessionPush(
  db: SqlDb,
  userId: number,
  entries: WireScanSession[],
  games: readonly GameId[]
): ScanSessionPushResult[] {
  const find = db.prepare('SELECT * FROM scan_sessions WHERE user_id = ? AND uid = ?')
  const write = db.prepare(
    `INSERT INTO scan_sessions (user_id, uid, game, cards, friends_visible, created_at, updated_at,
                                deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_SESSION_SEQ})
     ON CONFLICT(user_id, uid) DO UPDATE SET game = excluded.game, cards = excluded.cards,
       friends_visible = excluded.friends_visible, created_at = excluded.created_at,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const writeCards = db.prepare(
    `UPDATE scan_sessions SET cards = ?, seq = ${NEXT_SESSION_SEQ} WHERE user_id = ? AND uid = ?`
  )
  const applyOne = (pushed: WireScanSession): ScanSessionPushResult => {
    if (!games.includes(pushed.game)) return { uid: pushed.uid, status: 'skipped' }
    const existing = find.get(userId, pushed.uid) as SessionRow | undefined
    let s = pushed
    if (existing) {
      let current = wire(existing)
      // A price once set never changes, whichever push is newer; the newer edit's card list stands.
      s = {
        ...pushed,
        cards: mergeSessionCards(current.cards, pushed.cards, replaces(pushed, current))
      }
      if (sameSession(current, s)) return { uid: s.uid, status: 'applied' }
      if (!replaces(s, current)) {
        // An older or same-time push still brings its prices (a fill leaves the edit time as it
        // was), but never its hidden or deleted state: those stay the stored edit's.
        if (!sameCards(current.cards, s.cards)) {
          writeCards.run(JSON.stringify(s.cards), userId, s.uid)
          current = { ...current, cards: s.cards }
          if (sameSession(current, s)) return { uid: s.uid, status: 'applied' }
        }
        return { uid: s.uid, status: 'stale', current }
      }
    } else if (s.deletedAt !== null) {
      return { uid: s.uid, status: 'applied' }
    }
    write.run(
      userId,
      s.uid,
      s.game,
      JSON.stringify(s.cards),
      s.friendsVisible ? 1 : 0,
      s.createdAt,
      s.updatedAt,
      s.deletedAt
    )
    return { uid: s.uid, status: 'applied' }
  }
  return db.transaction(() => entries.map(applyOne))()
}

/** The caller's sessions of `game` written after `cursor`, tombstones included, in seq order. */
export function sessionPullSince(
  db: SqlDb,
  userId: number,
  game: GameId,
  cursor: number,
  limit = MAX_PULL
): ScanSessionPullResponse {
  const rows = db
    .prepare(
      'SELECT * FROM scan_sessions WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?'
    )
    .all(userId, game, cursor, limit + 1) as SessionRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    sessions: page.map(wire),
    cursor: pageCursor(
      db,
      page.at(-1)?.seq,
      more,
      cursor,
      'SELECT MAX(seq) AS top FROM scan_sessions WHERE user_id = ?',
      userId
    ),
    more
  }
}

/**
 * A friend's live sessions they chose to show, newest first. Hidden ones are left out entirely.
 * Each card's printing is the server catalog's for its pkey (the ids stored are the friend's
 * device's), right for the web app; the desktop and phone apps look it up in their own catalog (friendSession).
 */
export function friendSessions(db: SqlDb, friend: number, game: GameId): ScanSession[] {
  const rows = db
    .prepare(
      `SELECT * FROM scan_sessions WHERE user_id = ? AND game = ? AND friends_visible = 1
         AND deleted_at IS NULL ORDER BY created_at DESC, uid DESC`
    )
    .all(friend, game) as SessionRow[]
  return localizeSessions(
    db,
    rows.map((r) => ({
      uid: r.uid,
      game: r.game,
      cards: JSON.parse(r.cards) as ScanSessionCard[],
      friendsVisible: true,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  )
}
