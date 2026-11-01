import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta } from '../../../src/main/db/meta'
import { checkNotesLength, checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import { recordSnapshot } from '../../../src/main/repo/stats'
import {
  FUTURE_SKEW_MS,
  MAX_PRICE_CHANGES,
  MAX_PRICE_REQUEST,
  MAX_PULL,
  MAX_PUSH,
  editTime,
  keepsKey,
  replaces,
  type PriceChange,
  type PriceChangesResponse,
  type PricesResponse,
  type PullResponse,
  type PulledEntry,
  type PushResult,
  type WireEntry,
  type WirePrice
} from '../../../src/shared/cloud'
import type { GameId } from '../../../src/shared/games'
import type { AppDeps } from './app'
import { currentUser, gamesFor } from './auth'
import { requestPrices } from './priceRequests'
import {
  applyBinderEditPush,
  applyBinderPush,
  binderEditPullSince,
  binderPullSince,
  checkBinderEditPush,
  checkBinderPush
} from './binderSync'
import { applyWishPush, checkWishPush, wishPullSince } from './wishlist'
import { NEXT_SEQ, userScope } from './scope'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const MAX_PKEY = 300

/** A client time as toISOString(), clamped to `now` when beyond the allowed clock skew. */
export function checkTime(v: unknown, what: string, now: Date): string {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN
  if (Number.isNaN(ms)) throw new CollectionError(`${what} must be a date`)
  return new Date(ms > now.getTime() + FUTURE_SKEW_MS ? now.getTime() : ms).toISOString()
}

/** Validates a push body; throws CollectionError (a 400) on anything malformed. */
export function checkPush(body: unknown, now: Date): WireEntry[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireEntry => {
    const o = checkObject(v, 'Entry')
    if (typeof o.uid !== 'string' || !UUID_RE.test(o.uid))
      throw new CollectionError('uid must be a UUID')
    if (typeof o.pkey !== 'string' || o.pkey.length < 1 || o.pkey.length > MAX_PKEY)
      throw new CollectionError(`pkey must be a string of 1 to ${MAX_PKEY} characters`)
    if (typeof o.imageId !== 'number' || !Number.isSafeInteger(o.imageId) || o.imageId < 1)
      throw new CollectionError('imageId must be a positive whole number')
    if (typeof o.quantity !== 'number' || !Number.isSafeInteger(o.quantity) || o.quantity < 1)
      throw new CollectionError('quantity must be a whole number of at least 1')
    if (typeof o.notes !== 'string') throw new CollectionError('notes must be a string')
    checkNotesLength(o)
    return {
      uid: o.uid,
      pkey: o.pkey,
      imageId: o.imageId,
      quantity: o.quantity,
      notes: o.notes,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

interface EntryRow {
  id: number
  user_id: number
  printing_id: number
  uid: string
  /** Null only from `byUid`, when the row's printing has left the catalog. */
  pkey: string | null
  image_id: number
  quantity: number
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  server_seq: number
}

const ENTRY_SELECT = `SELECT e.id, e.user_id, e.printing_id, e.uid, p.pkey, e.image_id, e.quantity, e.notes,
  e.created_at, e.updated_at, e.deleted_at, e.server_seq
  FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id`

/** The printing a pushed pkey names. */
interface Printing {
  id: number
  game: GameId
}

/** A row whose printing is in the catalog. */
type WireRow = EntryRow & { pkey: string }

const toWire = (r: WireRow): WireEntry => ({
  uid: r.uid,
  pkey: r.pkey,
  imageId: r.image_id,
  quantity: r.quantity,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

const sameEntry = (x: WireEntry, y: WireEntry): boolean =>
  x.pkey === y.pkey &&
  x.imageId === y.imageId &&
  x.quantity === y.quantity &&
  x.notes === y.notes &&
  x.createdAt === y.createdAt &&
  x.updatedAt === y.updatedAt &&
  x.deletedAt === y.deletedAt

/**
 * Applies pushed entries for `userId` with latest-edit-wins per uid and one live row per printing+art,
 * then records the user's value snapshots, all in one transaction. Each entry takes the game of the
 * printing its pkey names; a game outside `games` (the user's) answers `unknown-printing`, so the
 * client keeps the entry and retries it later. `wroteLive` is set when a live entry was actually
 * written (an identical re-push writes nothing).
 */
export function applyPush(
  db: SqlDb,
  userId: number,
  entries: WireEntry[],
  now: Date,
  games: readonly GameId[] = ['ygo']
): { results: PushResult[]; wroteLive: boolean } {
  const findPrinting = db.prepare(
    `SELECT p.id, p.game FROM card_printings p JOIN card_images i ON i.card_id = p.card_id AND i.image_id = ?
     WHERE p.pkey = ?`
  )
  // LEFT JOIN: a uid must be found even if its printing has left the catalog, or the insert below
  // would hit the uid UNIQUE constraint.
  const byUid = db.prepare(`${ENTRY_SELECT.replace(' JOIN ', ' LEFT JOIN ')} WHERE e.uid = ?`)
  const liveOnKey = db.prepare(
    `${ENTRY_SELECT} WHERE e.user_id = ? AND e.printing_id = ? AND e.image_id = ? AND e.deleted_at IS NULL AND e.uid <> ?`
  )
  const tombstone = db.prepare(
    `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, server_seq = ${NEXT_SEQ} WHERE id = ?`
  )
  const bumpSeq = db.prepare(`UPDATE collection_entries SET server_seq = ${NEXT_SEQ} WHERE id = ?`)
  const update = db.prepare(
    `UPDATE collection_entries SET game = ?, printing_id = ?, image_id = ?, quantity = ?, notes = ?, created_at = ?,
       updated_at = ?, deleted_at = ?, server_seq = ${NEXT_SEQ}
     WHERE id = ? AND user_id = ?`
  )
  const insert = db.prepare(
    `INSERT INTO collection_entries (user_id, uid, game, printing_id, image_id, quantity, notes, created_at, updated_at,
       deleted_at, server_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_SEQ})`
  )

  const store = (existing: EntryRow | undefined, printing: Printing, e: WireEntry): void => {
    const fields = [
      printing.game,
      printing.id,
      e.imageId,
      e.quantity,
      e.notes,
      e.createdAt,
      e.updatedAt,
      e.deletedAt
    ]
    if (existing) update.run(...fields, existing.id, userId)
    else insert.run(userId, e.uid, ...fields)
  }

  let wroteLive = false
  /** Yu-Gi-Oh! always gets its snapshot, as before games; another game only when pushed to. */
  const touched = new Set<GameId>(['ygo'])
  const applyOne = (e: WireEntry): PushResult => {
    const printing = findPrinting.get(e.imageId, e.pkey) as Printing | undefined
    // Never 'rejected' for a game the user can't use yet: that would make the client drop the uid.
    if (!printing || !games.includes(printing.game))
      return { uid: e.uid, status: 'unknown-printing' }
    touched.add(printing.game)

    const existing = byUid.get(e.uid) as EntryRow | undefined
    if (existing && existing.user_id !== userId) return { uid: e.uid, status: 'rejected' }
    if (existing && existing.pkey !== null) {
      const current = toWire({ ...existing, pkey: existing.pkey })
      if (sameEntry(e, current)) return { uid: e.uid, status: 'applied' }
      if (!replaces(e, current)) return { uid: e.uid, status: 'stale', current }
    } else if (!existing && e.deletedAt !== null) {
      // Nothing to delete; storing it would only grow the table.
      return { uid: e.uid, status: 'applied' }
    }

    if (e.deletedAt === null) {
      const other = liveOnKey.get(userId, printing.id, e.imageId, e.uid) as WireRow | undefined
      if (other) {
        const winner = toWire(other)
        if (keepsKey(e, winner)) {
          // Tombstone the loser first so its seq comes before the winner's.
          // Both times set to the winner's edit time, as the desktop does, so the two sides agree on the row.
          const at = editTime(e)
          tombstone.run(at, at, other.id)
        } else {
          store(existing, printing, { ...e, deletedAt: editTime(e) })
          // Re-sequence the winner so, here too, the loser's tombstone comes first in a pull.
          bumpSeq.run(other.id)
          return { uid: e.uid, status: 'merged', winner }
        }
      }
    }
    // An owned row whose printing is gone can't be sent back as `current`, so the incoming entry replaces it.
    store(existing, printing, e)
    if (e.deletedAt === null) wroteLive = true
    return { uid: e.uid, status: 'applied' }
  }

  const results = db.transaction(() => {
    const out = entries.map(applyOne)
    for (const game of touched) recordSnapshot(db, now, userScope(userId, game))
    return out
  })()
  return { results, wroteLive }
}

/**
 * A page's cursor. Mid-feed it is the last row returned; on the last page it is the feed's highest seq
 * of any game, so a feed read for one game moves past the other games' seqs and never re-reads them.
 */
export function pageCursor(
  db: SqlDb,
  last: number | undefined,
  more: boolean,
  from: number,
  maxSql: string,
  ...args: unknown[]
): number {
  if (more) return last!
  const { top } = db.prepare(maxSql).get(...args) as { top: number | null }
  return Math.max(from, last ?? 0, Number(top ?? 0))
}

/** The caller's rows of `game` written after `cursor`, tombstones included, in seq order. */
export function pullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): PullResponse {
  const rows = db
    .prepare(
      `${ENTRY_SELECT} WHERE e.user_id = ? AND e.game = ? AND e.server_seq > ? ORDER BY e.server_seq LIMIT ?`
    )
    .all(userId, game, cursor, limit + 1) as WireRow[]
  const page = rows.slice(0, limit)
  const entries: PulledEntry[] = page.map((r) => ({ ...toWire(r), seq: r.server_seq }))
  const more = rows.length > limit
  return {
    entries,
    cursor: pageCursor(
      db,
      page.at(-1)?.server_seq,
      more,
      cursor,
      'SELECT MAX(server_seq) AS top FROM collection_entries WHERE user_id = ?',
      userId
    ),
    more
  }
}

/**
 * Server prices for the given printing keys (catalog data, shared by every user), for printings of
 * `games` only. Unknown keys, and keys of other games, are absent.
 */
export function pricesFor(
  db: SqlDb,
  pkeys: string[],
  games: readonly GameId[] = ['ygo']
): PricesResponse {
  // One JSON parameter per list keeps under the Durable Object's bound-parameter limit.
  const prices = db
    .prepare(
      `SELECT p.pkey, ip.price, ip.listing_count AS listingCount, ip.checked_at AS checkedAt
       FROM intl_prices ip JOIN card_printings p ON p.id = ip.printing_id
       WHERE p.pkey IN (SELECT value FROM json_each(?)) AND p.game IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(pkeys), JSON.stringify(games)) as WirePrice[]
  return { prices, status: getMeta(db, 'price_service_status') }
}

/**
 * Server price changes of `game` after `since`, oldest first; unpriced printings the server never
 * saw are absent.
 */
export function priceChanges(
  db: SqlDb,
  since: number,
  limit = MAX_PRICE_CHANGES,
  game: GameId = 'ygo'
): PriceChangesResponse {
  const rows = db
    .prepare(
      `SELECT p.pkey, ip.price, ip.listing_count AS listingCount, ip.checked_at AS checkedAt, ip.price_seq AS seq
       FROM intl_prices ip JOIN card_printings p ON p.id = ip.printing_id
       WHERE ip.price_seq > ? AND +p.game = ? ORDER BY ip.price_seq LIMIT ?`
    )
    .all(since, game, limit + 1) as PriceChange[]
  const prices = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    prices,
    cursor: pageCursor(
      db,
      prices.at(-1)?.seq,
      more,
      since,
      'SELECT MAX(price_seq) AS top FROM intl_prices'
    ),
    more
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new CollectionError('Body must be JSON')
  }
}

/** Checks a body's `pkeys`: an array of strings of at most MAX_PKEY characters. */
function checkPkeys(body: unknown): string[] {
  const pkeys = (body as { pkeys?: unknown } | null)?.pkeys
  if (!Array.isArray(pkeys) || !pkeys.every((k) => typeof k === 'string' && k.length <= MAX_PKEY))
    throw new CollectionError(`pkeys must be an array of strings of at most ${MAX_PKEY} characters`)
  return pkeys as string[]
}

const POST_PATHS: ReadonlySet<string> = new Set([
  'push',
  'prices',
  'price-requests',
  'wishlist-push',
  'binders-push',
  'binder-edits-push'
])
const GET_PATHS: ReadonlySet<string> = new Set([
  'pull',
  'price-changes',
  'wishlist-pull',
  'binders-pull',
  'binder-edits-pull'
])

/**
 * POST /api/sync/push, GET /api/sync/pull, GET /api/sync/price-changes, POST /api/sync/prices,
 * POST /api/sync/price-requests, POST /api/sync/wishlist-push and GET /api/sync/wishlist-pull, and the same
 * pairs for binders (binders-push/-pull) and their edits (binder-edits-push/-pull);
 * desktop tokens only (the phone app has one too).
 */
export async function syncRoute(req: Request, deps: AppDeps, path: string): Promise<Response> {
  const method = GET_PATHS.has(path) ? 'GET' : POST_PATHS.has(path) ? 'POST' : null
  if (!method) return json({ error: 'Not found' }, 404)
  if (req.method !== method) return json({ error: 'method-not-allowed' }, 405)
  const user = await currentUser(req, deps)
  if (!user || user.kind !== 'desktop') return json({ error: 'signed-out' }, 401)

  // The game named by `game` (default Yu-Gi-Oh!), checked against the user's games as RPC does.
  const asked = new URL(req.url).searchParams.get('game') || 'ygo'
  const games = gamesFor(deps, user.id)
  const game = games.find((g) => g === asked)
  if (!game) return json({ error: 'game-not-allowed' }, 403)

  try {
    if (path.endsWith('pull')) {
      const raw = new URL(req.url).searchParams.get('cursor') ?? ''
      const cursor = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
      if (!Number.isSafeInteger(cursor))
        throw new CollectionError('cursor must be a whole number of at least 0')
      const pull =
        path === 'pull'
          ? pullSince
          : path === 'wishlist-pull'
            ? wishPullSince
            : path === 'binders-pull'
              ? binderPullSince
              : binderEditPullSince
      return json(pull(deps.db, user.id, cursor, MAX_PULL, game))
    }

    if (path === 'price-changes') {
      const raw = new URL(req.url).searchParams.get('since') ?? ''
      const since = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
      if (!Number.isSafeInteger(since))
        throw new CollectionError('since must be a whole number of at least 0')
      return json(priceChanges(deps.db, since, MAX_PRICE_CHANGES, game))
    }

    const body = await readJson(req)
    if (path === 'push') {
      const raw = (body as { entries?: unknown } | null)?.entries
      if (Array.isArray(raw) && raw.length > MAX_PUSH) return json({ error: 'too-many' }, 413)
      const now = deps.now()
      const entries = checkPush(body, now)
      const { results, wroteLive } = applyPush(deps.db, user.id, entries, now, games)
      if (wroteLive) await deps.prices.soon()
      return json({ results })
    }

    if (path === 'wishlist-push') {
      const raw = (body as { entries?: unknown } | null)?.entries
      if (Array.isArray(raw) && raw.length > MAX_PUSH) return json({ error: 'too-many' }, 413)
      const entries = checkWishPush(body, deps.now())
      return json({ results: applyWishPush(deps.db, user.id, entries, games) })
    }

    if (path === 'binders-push' || path === 'binder-edits-push') {
      const raw = (body as { entries?: unknown } | null)?.entries
      if (Array.isArray(raw) && raw.length > MAX_PUSH) return json({ error: 'too-many' }, 413)
      const now = deps.now()
      return json({
        results:
          path === 'binders-push'
            ? applyBinderPush(deps.db, user.id, checkBinderPush(body, now), games)
            : applyBinderEditPush(deps.db, user.id, checkBinderEditPush(body, now), games)
      })
    }

    const pkeys = checkPkeys(body)
    if (path === 'price-requests') {
      if (pkeys.length > MAX_PRICE_REQUEST) return json({ error: 'too-many' }, 413)
      const result = requestPrices(deps.db, user.id, pkeys, deps.now())
      // Paced: requests come with every page view, and mustn't run the alarm faster than its batches.
      // While the eBay Worker is failing, the alarm's own hour-long backoff picks them up.
      if (result.queued > 0 && getMeta(deps.db, 'price_service_status') !== 'unavailable')
        await deps.prices.soon({ paced: true })
      return json(result)
    }
    if (pkeys.length > MAX_PULL) return json({ error: 'too-many' }, 413)
    return json(pricesFor(deps.db, pkeys, games))
  } catch (e) {
    if (e instanceof CollectionError) return json({ error: e.message }, 400)
    throw e
  }
}
