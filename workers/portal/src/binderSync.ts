import type { SqlDb } from '../../../src/main/db/sql'
import { checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  MAX_BINDER_EDITS,
  MAX_BINDER_NAME,
  MAX_BINDER_RULES_BYTES,
  MAX_BINDERS,
  type BinderEditAction,
  type BinderEditLevel
} from '../../../src/shared/binders'
import {
  MAX_PULL,
  binderEditKey,
  replaces,
  type BinderEditPullResponse,
  type BinderEditPushResult,
  type BinderPullResponse,
  type BinderPushResult,
  type WireBinder,
  type WireBinderEdit
} from '../../../src/shared/cloud'
import { isGameId, type GameId } from '../../../src/shared/games'
import { NEXT_BINDER_EDIT_SEQ, NEXT_BINDER_SEQ } from './scope'
import { MAX_PKEY, checkTime, pageCursor } from './sync'

/** Opaque text the server stores for a binder; it never parses these, so a newer client's rule version passes. */
const MAX_SMALL = 256
const MAX_UID = 64
const MAX_SORT = 1_000_000

const LEVELS: readonly BinderEditLevel[] = ['card', 'art', 'printing']
const ACTIONS: readonly BinderEditAction[] = ['add', 'remove']

function text(v: unknown, what: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max)
    throw new CollectionError(`${what} must be a string of ${min} to ${max} characters`)
  return v
}

/** Validates a binders push body; throws CollectionError (a 400) on anything malformed. */
export function checkBinderPush(body: unknown, now: Date): WireBinder[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireBinder => {
    const o = checkObject(v, 'Entry')
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    if (typeof o.friendsVisible !== 'boolean')
      throw new CollectionError('friendsVisible must be true or false')
    if (
      typeof o.sortOrder !== 'number' ||
      !Number.isInteger(o.sortOrder) ||
      Math.abs(o.sortOrder) > MAX_SORT
    )
      throw new CollectionError('sortOrder must be a whole number')
    return {
      uid: text(o.uid, 'uid', 1, MAX_UID),
      game: o.game,
      name: text(o.name, 'name', 1, MAX_BINDER_NAME),
      rules: text(o.rules, 'rules', 0, MAX_BINDER_RULES_BYTES),
      goal: text(o.goal, 'goal', 0, MAX_SMALL),
      languages: text(o.languages, 'languages', 0, MAX_SMALL),
      friendsVisible: o.friendsVisible,
      sortOrder: o.sortOrder,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

/** Validates a binder edits push body; throws CollectionError (a 400) on anything malformed. */
export function checkBinderEditPush(body: unknown, now: Date): WireBinderEdit[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireBinderEdit => {
    const o = checkObject(v, 'Entry')
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    if (!LEVELS.includes(o.level as BinderEditLevel))
      throw new CollectionError('level must be card, art or printing')
    if (!ACTIONS.includes(o.action as BinderEditAction))
      throw new CollectionError('action must be add or remove')
    return {
      binderUid: text(o.binderUid, 'binderUid', 1, MAX_UID),
      level: o.level as BinderEditLevel,
      target: text(o.target, 'target', 1, MAX_PKEY),
      game: o.game,
      action: o.action as BinderEditAction,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

interface BinderRow {
  uid: string
  game: GameId
  name: string
  rules: string
  goal: string
  languages: string
  friends_visible: number
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

interface EditRow {
  binder_uid: string
  level: BinderEditLevel
  target: string
  game: GameId
  action: BinderEditAction
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

const binderWire = (r: BinderRow): WireBinder => ({
  uid: r.uid,
  game: r.game,
  name: r.name,
  rules: r.rules,
  goal: r.goal,
  languages: r.languages,
  friendsVisible: r.friends_visible !== 0,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

const editWire = (r: EditRow): WireBinderEdit => ({
  binderUid: r.binder_uid,
  level: r.level,
  target: r.target,
  game: r.game,
  action: r.action,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/**
 * Applies pushed binders for `userId`, latest edit wins per uid. A binder of a game outside `games`
 * is skipped, so the client keeps it and retries; so is a new live one past MAX_BINDERS for its game.
 * Tombstones and changes to rows the server has always apply.
 */
export function applyBinderPush(
  db: SqlDb,
  userId: number,
  entries: WireBinder[],
  games: readonly GameId[]
): BinderPushResult[] {
  const find = db.prepare('SELECT * FROM binders WHERE user_id = ? AND uid = ?')
  const live = db.prepare(
    'SELECT COUNT(*) AS n FROM binders WHERE user_id = ? AND game = ? AND deleted_at IS NULL'
  )
  const write = db.prepare(
    `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, friends_visible, sort_order,
                          created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_BINDER_SEQ})
     ON CONFLICT(user_id, uid) DO UPDATE SET game = excluded.game, name = excluded.name,
       rules = excluded.rules, goal = excluded.goal, languages = excluded.languages,
       friends_visible = excluded.friends_visible, sort_order = excluded.sort_order,
       created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const applyOne = (b: WireBinder): BinderPushResult => {
    if (!games.includes(b.game)) return { uid: b.uid, status: 'skipped' }
    const existing = find.get(userId, b.uid) as BinderRow | undefined
    if (existing) {
      const current = binderWire(existing)
      if (JSON.stringify(current) === JSON.stringify(b)) return { uid: b.uid, status: 'applied' }
      if (!replaces(b, current)) return { uid: b.uid, status: 'stale', current }
    } else if (b.deletedAt !== null) {
      // Nothing to delete; storing it would only grow the table.
      return { uid: b.uid, status: 'applied' }
    } else if ((live.get(userId, b.game) as { n: number }).n >= MAX_BINDERS) {
      return { uid: b.uid, status: 'skipped' }
    }
    write.run(
      userId, b.uid, b.game, b.name, b.rules, b.goal, b.languages, b.friendsVisible ? 1 : 0,
      b.sortOrder, b.createdAt, b.updatedAt, b.deletedAt
    )
    return { uid: b.uid, status: 'applied' }
  }
  return db.transaction(() => entries.map(applyOne))()
}

/**
 * Applies pushed binder edits for `userId`, latest edit wins per binder, level and target, so two
 * devices editing different cards both survive. An edit for a binder the server lacks is stored as
 * any other (reads ignore orphans, and refusing it would make sync order matter); a new live one past
 * MAX_BINDER_EDITS for its binder is skipped.
 */
export function applyBinderEditPush(
  db: SqlDb,
  userId: number,
  entries: WireBinderEdit[],
  games: readonly GameId[]
): BinderEditPushResult[] {
  const find = db.prepare(
    'SELECT * FROM binder_edits WHERE user_id = ? AND binder_uid = ? AND level = ? AND target = ?'
  )
  const live = db.prepare(
    'SELECT COUNT(*) AS n FROM binder_edits WHERE user_id = ? AND binder_uid = ? AND deleted_at IS NULL'
  )
  const write = db.prepare(
    `INSERT INTO binder_edits (user_id, binder_uid, level, target, game, action, created_at, updated_at,
                               deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_BINDER_EDIT_SEQ})
     ON CONFLICT(user_id, binder_uid, level, target) DO UPDATE SET game = excluded.game,
       action = excluded.action, created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const applyOne = (e: WireBinderEdit): BinderEditPushResult => {
    const key = binderEditKey(e)
    if (!games.includes(e.game)) return { key, status: 'skipped' }
    const existing = find.get(userId, e.binderUid, e.level, e.target) as EditRow | undefined
    if (existing) {
      const current = editWire(existing)
      if (JSON.stringify(current) === JSON.stringify(e)) return { key, status: 'applied' }
      if (!replaces(e, current)) return { key, status: 'stale', current }
    } else if (e.deletedAt !== null) {
      return { key, status: 'applied' }
    } else if ((live.get(userId, e.binderUid) as { n: number }).n >= MAX_BINDER_EDITS) {
      return { key, status: 'skipped' }
    }
    write.run(
      userId, e.binderUid, e.level, e.target, e.game, e.action, e.createdAt, e.updatedAt, e.deletedAt
    )
    return { key, status: 'applied' }
  }
  return db.transaction(() => entries.map(applyOne))()
}

/** The caller's binders of `game` written after `cursor`, tombstones included, in seq order. */
export function binderPullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): BinderPullResponse {
  const rows = db
    .prepare('SELECT * FROM binders WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?')
    .all(userId, game, cursor, limit + 1) as BinderRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    entries: page.map(binderWire),
    cursor: pageCursor(
      db, page.at(-1)?.seq, more, cursor,
      'SELECT MAX(seq) AS top FROM binders WHERE user_id = ?', userId
    ),
    more
  }
}

/** The caller's binder edits of `game` written after `cursor`, tombstones included, in seq order. */
export function binderEditPullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): BinderEditPullResponse {
  const rows = db
    .prepare(
      'SELECT * FROM binder_edits WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?'
    )
    .all(userId, game, cursor, limit + 1) as EditRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    entries: page.map(editWire),
    cursor: pageCursor(
      db, page.at(-1)?.seq, more, cursor,
      'SELECT MAX(seq) AS top FROM binder_edits WHERE user_id = ?', userId
    ),
    more
  }
}
