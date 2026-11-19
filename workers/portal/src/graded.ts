import type { SqlDb } from '../../../src/main/db/sql'
import { checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  MAX_PULL,
  replaces,
  type GradedPullResponse,
  type GradedPushResult,
  type WireGraded
} from '../../../src/shared/cloud'
import { isGameId, type GameId } from '../../../src/shared/games'
import { GradedFieldError, checkGradedFields } from '../../../src/shared/graded'
import { NEXT_GRADED_SEQ } from './scope'
import { MAX_PKEY, checkTime, pageCursor } from './sync'

const MAX_UID = 64

/** Validates a graded-copies push body; throws CollectionError (a 400) on anything malformed. */
export function checkGradedPush(body: unknown, now: Date): WireGraded[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireGraded => {
    const o = checkObject(v, 'Entry')
    if (typeof o.uid !== 'string' || !o.uid || o.uid.length > MAX_UID)
      throw new CollectionError('uid must be text')
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    if (typeof o.pkey !== 'string' || !o.pkey || o.pkey.length > MAX_PKEY)
      throw new CollectionError('pkey must be text')
    if (typeof o.imageId !== 'number' || !Number.isSafeInteger(o.imageId))
      throw new CollectionError('imageId must be a whole number')
    let fields
    try {
      fields = checkGradedFields(o)
    } catch (e) {
      if (e instanceof GradedFieldError) throw new CollectionError(e.message)
      throw e
    }
    // An app from before subgrades leaves them out: undefined keeps the server's.
    const subgrades = o.subgrades === undefined ? undefined : fields.subgrades
    return {
      uid: o.uid,
      game: o.game,
      pkey: o.pkey,
      imageId: o.imageId,
      ...fields,
      subgrades,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

interface GradedRow {
  uid: string
  game: GameId
  pkey: string
  image_id: number
  company: string
  grade: string
  label: string
  cert: string
  subgrades: string
  value: number | null
  paid: number | null
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

const toWire = (r: GradedRow): WireGraded => ({
  uid: r.uid,
  game: r.game,
  pkey: r.pkey,
  imageId: r.image_id,
  company: r.company,
  grade: r.grade,
  label: r.label,
  cert: r.cert,
  subgrades: r.subgrades,
  value: r.value,
  paid: r.paid,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/**
 * Applies pushed graded copies for `userId`, latest edit wins per uid. A row of a game outside
 * `games` is skipped, so the client keeps it and retries. The printing isn't checked against the
 * catalog: one the server lacks just doesn't show until it has it.
 */
export function applyGradedPush(
  db: SqlDb,
  userId: number,
  entries: WireGraded[],
  games: readonly GameId[]
): GradedPushResult[] {
  const find = db.prepare('SELECT * FROM graded_copies WHERE user_id = ? AND uid = ?')
  const write = db.prepare(
    `INSERT INTO graded_copies (user_id, uid, game, pkey, image_id, company, grade, label, cert, subgrades,
       value, paid, notes, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_GRADED_SEQ})
     ON CONFLICT(user_id, uid) DO UPDATE SET game = excluded.game, pkey = excluded.pkey,
       image_id = excluded.image_id, company = excluded.company, grade = excluded.grade,
       label = excluded.label, cert = excluded.cert, subgrades = excluded.subgrades,
       value = excluded.value, paid = excluded.paid,
       notes = excluded.notes, created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const applyOne = (g: WireGraded): GradedPushResult => {
    if (!games.includes(g.game)) return { uid: g.uid, status: 'skipped' }
    const existing = find.get(userId, g.uid) as GradedRow | undefined
    if (g.subgrades === undefined) g = { ...g, subgrades: existing?.subgrades ?? '' }
    if (existing) {
      const current = toWire(existing)
      if (JSON.stringify(current) === JSON.stringify(g)) return { uid: g.uid, status: 'applied' }
      if (!replaces(g, current)) return { uid: g.uid, status: 'stale', current }
    } else if (g.deletedAt !== null) {
      // Nothing to delete; storing it would only grow the table.
      return { uid: g.uid, status: 'applied' }
    }
    write.run(
      userId,
      g.uid,
      g.game,
      g.pkey,
      g.imageId,
      g.company,
      g.grade,
      g.label,
      g.cert,
      g.subgrades,
      g.value,
      g.paid,
      g.notes,
      g.createdAt,
      g.updatedAt,
      g.deletedAt
    )
    return { uid: g.uid, status: 'applied' }
  }
  return db.transaction(() => entries.map(applyOne))()
}

/** The caller's graded copies of `game` written after `cursor`, tombstones included, in seq order. */
export function gradedPullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): GradedPullResponse {
  const rows = db
    .prepare(
      'SELECT * FROM graded_copies WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?'
    )
    .all(userId, game, cursor, limit + 1) as GradedRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    entries: page.map(toWire),
    cursor: pageCursor(
      db,
      page.at(-1)?.seq,
      more,
      cursor,
      'SELECT MAX(seq) AS top FROM graded_copies WHERE user_id = ?',
      userId
    ),
    more
  }
}
