import { deleteMeta, getMeta, setMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import { priceCandidates } from '../prices/candidates'
import type { ContributedPrinting } from '../../shared/catalogFeed'
import type { UnsyncedEntry } from '../../shared/types'
import { isLanguage } from '../../shared/languages'
import {
  MAX_NOTES,
  editTime,
  keepsKey,
  replaces,
  type WireEntry,
  type WirePrice
} from '../../shared/cloud'

/**
 * The desktop side of sync: per-owner SQL the sync engine drives. `owner` is a server user id (≥ 1);
 * owner 0 is this computer's never-signed-in collection. Nothing here goes through the repo write
 * functions, so rows written from the server are never marked dirty.
 */

/** The owner whose collection the app shows (meta `cloud_active_owner`), 0 when none. */
export function activeOwner(db: SqlDb): number {
  const v = getMeta(db, 'cloud_active_owner')
  return v === null ? 0 : Number(v)
}

export function setActiveOwner(db: SqlDb, owner: number): void {
  if (owner === 0) deleteMeta(db, 'cloud_active_owner')
  else setMeta(db, 'cloud_active_owner', String(owner))
}

/** Records the account (or its new display name), keeping its cursor. */
export function ensureAccount(db: SqlDb, owner: number, name: string): void {
  db.prepare(
    `INSERT INTO cloud_accounts (owner_id, name) VALUES (?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET name = excluded.name`
  ).run(owner, name)
}

export function accountName(db: SqlDb, owner: number): string | null {
  const r = db.prepare('SELECT name FROM cloud_accounts WHERE owner_id = ?').get(owner) as
    { name: string } | undefined
  return r?.name ?? null
}

/** The account's pull cursor and last sync time; cursor 0 for an account not yet recorded. */
export function accountState(
  db: SqlDb,
  owner: number
): { cursor: number; syncedAt: string | null } {
  const r = db
    .prepare('SELECT cursor, synced_at FROM cloud_accounts WHERE owner_id = ?')
    .get(owner) as { cursor: number; synced_at: string | null } | undefined
  return { cursor: r ? Number(r.cursor) : 0, syncedAt: r?.synced_at ?? null }
}

/** Updates the given fields of the account, recording it (with no name yet) if `ensureAccount` hasn't. */
export function saveAccountState(
  db: SqlDb,
  owner: number,
  s: { cursor?: number; syncedAt?: string }
): void {
  db.prepare(
    `INSERT INTO cloud_accounts (owner_id, name, cursor, synced_at) VALUES (?, '', COALESCE(?, 0), ?)
     ON CONFLICT(owner_id) DO UPDATE SET cursor = COALESCE(?, cursor), synced_at = COALESCE(?, synced_at)`
  ).run(owner, s.cursor ?? null, s.syncedAt ?? null, s.cursor ?? null, s.syncedAt ?? null)
}

/** Whether this computer has never-signed-in entries (owner 0), tombstones included. */
export function hasLocalData(db: SqlDb): boolean {
  return (
    db.prepare('SELECT 1 FROM collection_entries WHERE owner_id = 0 LIMIT 1').get() !== undefined
  )
}

/**
 * Moves the never-signed-in collection (owner 0) to `owner`, to be pushed; returns the entries moved.
 * Owner-0 rows exist only before the first sign-in ever, so the adopting owner has no local rows yet.
 */
export function adoptLocalData(db: SqlDb, owner: number): number {
  return db.transaction(() => {
    const moved = db
      .prepare('UPDATE collection_entries SET owner_id = ?, dirty = 1 WHERE owner_id = 0')
      .run(owner)
    // A day the owner already has a snapshot for keeps the owner's.
    db.prepare('UPDATE OR IGNORE value_snapshots SET owner_id = ? WHERE owner_id = 0').run(owner)
    db.prepare('DELETE FROM value_snapshots WHERE owner_id = 0').run()
    return moved.changes
  })()
}

interface LocalRow {
  id: number
  uid: string
  owner_id: number
  printing_id: number
  image_id: number
  pkey: string
  quantity: number
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}

const ROW_SELECT = `SELECT e.id, e.uid, e.owner_id, e.printing_id, e.image_id, p.pkey, e.quantity, e.notes,
  e.created_at, e.updated_at, e.deleted_at, e.dirty
  FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id`

const toWire = (r: LocalRow): WireEntry => ({
  uid: r.uid,
  pkey: r.pkey,
  imageId: r.image_id,
  quantity: r.quantity,
  notes: r.notes.slice(0, MAX_NOTES),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/** Up to `limit` of the owner's unpushed rows, tombstones included, oldest first, leaving out `skip`. */
export function dirtyEntries(
  db: SqlDb,
  owner: number,
  limit: number,
  skip: ReadonlySet<string> = new Set()
): WireEntry[] {
  const rows = db
    .prepare(
      `${ROW_SELECT}
       WHERE e.owner_id = ? AND e.dirty = 1 AND e.uid NOT IN (SELECT value FROM json_each(?))
       ORDER BY e.id LIMIT ?`
    )
    .all(owner, JSON.stringify([...skip]), limit) as LocalRow[]
  return rows.map(toWire)
}

/** Marks a pushed row clean, unless it was edited again since `e` was read; a clean row has no sync issue. */
export function markPushed(db: SqlDb, e: WireEntry): void {
  const row = db.prepare('SELECT owner_id FROM collection_entries WHERE uid = ?').get(e.uid) as
    { owner_id: number } | undefined
  const r = db
    .prepare(
      'UPDATE collection_entries SET dirty = 0 WHERE uid = ? AND updated_at = ? AND deleted_at IS ?'
    )
    .run(e.uid, e.updatedAt, e.deletedAt)
  if (row && r.changes > 0) clearSyncIssue(db, row.owner_id, e.uid)
}

/**
 * Tombstones the pushed entry `e` at `ts`, clean, as the server did (a `merged` push). Like
 * `markPushed`, it leaves a row edited since `e` was read alone: still live and dirty.
 */
export function tombstoneClean(db: SqlDb, e: WireEntry, ts: string): void {
  db.prepare(
    `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, dirty = 0
     WHERE uid = ? AND updated_at = ? AND deleted_at IS ?`
  ).run(ts, ts, e.uid, e.updatedAt, e.deletedAt)
}

const findPrinting = (db: SqlDb, e: WireEntry): number | undefined =>
  (
    db
      .prepare(
        `SELECT p.id FROM card_printings p JOIN card_images i ON i.card_id = p.card_id AND i.image_id = ?
         WHERE p.pkey = ?`
      )
      .get(e.imageId, e.pkey) as { id: number } | undefined
  )?.id

/** Keeps `e` for when the catalog has its printing, unless a newer copy is already waiting. */
function park(db: SqlDb, owner: number, e: WireEntry): void {
  const waiting = db
    .prepare('SELECT entry FROM sync_pending WHERE owner_id = ? AND uid = ?')
    .get(owner, e.uid) as { entry: string } | undefined
  if (waiting && !replaces(e, JSON.parse(waiting.entry) as WireEntry)) return
  db.prepare(
    `INSERT INTO sync_pending (owner_id, uid, pkey, entry, received_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, uid) DO UPDATE SET pkey = excluded.pkey, entry = excluded.entry, received_at = excluded.received_at`
  ).run(owner, e.uid, e.pkey, JSON.stringify(e), new Date().toISOString())
}

/** `unchanged`: the local row is clean and already holds exactly this entry (e.g. the echo of our own push). */
export type ApplyResult = 'applied' | 'unchanged' | 'kept-local' | 'pending' | 'ignored'

const sameEntry = (x: WireEntry, y: WireEntry): boolean =>
  x.pkey === y.pkey &&
  x.imageId === y.imageId &&
  x.quantity === y.quantity &&
  x.notes === y.notes &&
  x.createdAt === y.createdAt &&
  x.updatedAt === y.updatedAt &&
  x.deletedAt === y.deletedAt

/**
 * Applies one server entry to `owner`'s rows, clean. A newer unpushed local edit of the same uid is
 * kept; a live-key collision follows `keepsKey`, tombstoning the loser at the incoming entry's edit
 * time as the server does. Entries on a printing the catalog lacks wait in sync_pending.
 */
export function applyRemote(db: SqlDb, owner: number, e: WireEntry): ApplyResult {
  return db.transaction((): ApplyResult => {
    const local = db.prepare(`${ROW_SELECT} WHERE e.uid = ?`).get(e.uid) as LocalRow | undefined
    if (local && local.owner_id !== owner) return 'ignored'
    if (!local && e.deletedAt !== null) return 'ignored'

    if (local && local.dirty === 0 && sameEntry(e, toWire(local))) {
      db.prepare('DELETE FROM sync_pending WHERE owner_id = ? AND uid = ?').run(owner, e.uid)
      return 'unchanged'
    }

    if (local && local.dirty === 1 && !replaces(e, toWire(local))) return 'kept-local'

    let printingId = findPrinting(db, e)
    let imageId = e.imageId
    if (printingId === undefined) {
      if (!(local && e.deletedAt !== null)) {
        park(db, owner, e)
        return 'pending'
      }
      // A delete needs no catalog: keep the row's own printing and art.
      printingId = local.printing_id
      imageId = local.image_id
    }

    const write = (deletedAt: string | null, updatedAt: string, dirty: number): void => {
      const fields = [
        owner,
        printingId,
        imageId,
        e.quantity,
        e.notes,
        e.createdAt,
        updatedAt,
        deletedAt,
        dirty
      ]
      if (local)
        db.prepare(
          `UPDATE collection_entries SET owner_id = ?, printing_id = ?, image_id = ?, quantity = ?, notes = ?,
             created_at = ?, updated_at = ?, deleted_at = ?, dirty = ? WHERE uid = ?`
        ).run(...fields, e.uid)
      else
        db.prepare(
          `INSERT INTO collection_entries (owner_id, printing_id, image_id, quantity, notes, created_at, updated_at,
             deleted_at, dirty, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(...fields, e.uid)
      db.prepare('DELETE FROM sync_pending WHERE owner_id = ? AND uid = ?').run(owner, e.uid)
    }

    if (e.deletedAt === null) {
      const other = db
        .prepare(
          `${ROW_SELECT} WHERE e.owner_id = ? AND e.printing_id = ? AND e.image_id = ? AND e.deleted_at IS NULL
             AND e.uid <> ?`
        )
        .get(owner, printingId, imageId, e.uid) as LocalRow | undefined
      if (other) {
        const at = editTime(e)
        if (keepsKey(e, toWire(other))) {
          // The local row loses; it stays dirty so the server hears of the delete.
          db.prepare(
            'UPDATE collection_entries SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?'
          ).run(at, at, other.id)
        } else {
          // The remote loses. A uid held here (on another key) becomes the tombstone the server will make of it.
          if (local) write(at, at, 0)
          return 'ignored'
        }
      }
    }

    write(e.deletedAt, e.updatedAt, 0)
    return 'applied'
  })()
}

/**
 * Retries every owner's waiting entries against the current catalog. A waiting entry no newer than the
 * local row is dropped unapplied, so a late replay can't roll back a row the server has since updated.
 */
export function applyPending(db: SqlDb): { applied: number; remaining: number } {
  return db.transaction(() => {
    const rows = db
      .prepare('SELECT owner_id, uid, entry FROM sync_pending ORDER BY received_at, owner_id')
      .all() as {
      owner_id: number
      uid: string
      entry: string
    }[]
    let applied = 0
    const drop = db.prepare('DELETE FROM sync_pending WHERE owner_id = ? AND uid = ?')
    const byUid = db.prepare(`${ROW_SELECT} WHERE e.uid = ?`)
    for (const r of rows) {
      const e = JSON.parse(r.entry) as WireEntry
      const local = byUid.get(e.uid) as LocalRow | undefined
      if (local && !replaces(e, toWire(local))) {
        drop.run(r.owner_id, r.uid)
        continue
      }
      const result = applyRemote(db, r.owner_id, e)
      if (result === 'applied') applied++
      if (result !== 'pending') drop.run(r.owner_id, r.uid)
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM sync_pending').get() as { n: number }
    return { applied, remaining: Number(n) }
  })()
}

export function pendingCount(db: SqlDb, owner: number): number {
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM sync_pending WHERE owner_id = ?')
    .get(owner) as { n: number }
  return Number(n)
}

/** Gives an entry a fresh uid (the server said the old one belongs to another account); returns it. */
export function rekey(db: SqlDb, uid: string): string {
  const fresh = crypto.randomUUID()
  db.prepare('UPDATE collection_entries SET uid = ?, dirty = 1 WHERE uid = ?').run(fresh, uid)
  return fresh
}

export function dropEntry(db: SqlDb, uid: string): void {
  db.prepare('DELETE FROM collection_entries WHERE uid = ?').run(uid)
}

/** Deletes the owner's tombstones the server already has; returns how many. */
export function purgeCleanTombstones(db: SqlDb, owner: number): number {
  return db
    .prepare(
      'DELETE FROM collection_entries WHERE owner_id = ? AND deleted_at IS NOT NULL AND dirty = 0'
    )
    .run(owner).changes
}

/** Printing keys whose price is missing or stale, most needed first. */
export function stalePricePkeys(db: SqlDb, now: Date, limit: number): string[] {
  return priceCandidates(db, now, { limit }).map((c) => c.pkey)
}

/** Stores server prices for printings this computer knows, where fresher than the local price; returns rows written. */
export function applyPrices(db: SqlDb, prices: WirePrice[]): number {
  const upsert = db.prepare(
    `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at)
     SELECT p.id, ?, ?, ? FROM card_printings p WHERE p.pkey = ?
     ON CONFLICT(printing_id) DO UPDATE SET price = excluded.price, listing_count = excluded.listing_count,
       checked_at = excluded.checked_at
     WHERE julianday(excluded.checked_at) > julianday(intl_prices.checked_at)`
  )
  return db.transaction(() =>
    prices.reduce((n, p) => n + upsert.run(p.price, p.listingCount, p.checkedAt, p.pkey).changes, 0)
  )()
}

/** A printing to offer the server and the entries (uids) that sit on it. */
interface ContributionGroup {
  printing: ContributedPrinting
  pkey: string
  uids: string[]
}

/**
 * The owner's entries among `uids`, grouped by printing so each is offered once. `missing` holds uids
 * whose printing row isn't in this catalog (nothing to offer for them).
 */
export function contributionGroups(
  db: SqlDb,
  owner: number,
  uids: string[]
): { groups: ContributionGroup[]; missing: string[] } {
  const find = db.prepare(
    `SELECT p.id AS printing_id, p.pkey, p.card_id, p.set_name, p.set_code, p.set_rarity, p.set_rarity_code,
       p.language, p.variant, p.tcg_product_id
     FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id
     WHERE e.owner_id = ? AND e.uid = ?`
  )
  const groups = new Map<number, ContributionGroup>()
  const missing: string[] = []
  for (const uid of uids) {
    const r = find.get(owner, uid) as
      | {
          printing_id: number
          pkey: string
          card_id: number
          set_name: string
          set_code: string
          set_rarity: string
          set_rarity_code: string | null
          language: string
          variant: string | null
          tcg_product_id: number | null
        }
      | undefined
    if (!r) {
      missing.push(uid)
      continue
    }
    const group = groups.get(r.printing_id)
    if (group) group.uids.push(uid)
    else
      groups.set(r.printing_id, {
        pkey: r.pkey,
        printing: {
          card_id: r.card_id,
          set_name: r.set_name,
          set_code: r.set_code,
          set_rarity: r.set_rarity,
          // The server rejects an omitted field, so an empty optional one is an explicit null.
          set_rarity_code: r.set_rarity_code || null,
          language: r.language,
          variant: r.variant || null,
          tcg_product_id: r.tcg_product_id ?? null
        },
        uids: [uid]
      })
  }
  return { groups: [...groups.values()], missing }
}

/** The distinct printings of the owner's entries `uids`, in the shape the server's contribute takes. */
export function printingsToContribute(
  db: SqlDb,
  owner: number,
  uids: string[]
): ContributedPrinting[] {
  return contributionGroups(db, owner, uids).groups.map((g) => g.printing)
}

/** Notes that an entry can't sync; an issue already recorded for the uid keeps its `since`. */
export function recordSyncIssue(
  db: SqlDb,
  owner: number,
  uid: string,
  pkey: string,
  reason: string,
  now: Date
): void {
  db.prepare(
    `INSERT INTO sync_issues (owner_id, uid, pkey, reason, since) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, uid) DO UPDATE SET pkey = excluded.pkey, reason = excluded.reason`
  ).run(owner, uid, pkey, reason, now.toISOString())
}

export function clearSyncIssue(db: SqlDb, owner: number, uid: string): void {
  db.prepare('DELETE FROM sync_issues WHERE owner_id = ? AND uid = ?').run(owner, uid)
}

/** Forgets the owner's issues for uids not in `keep` (entries that synced, were removed or re-keyed). */
export function pruneSyncIssues(db: SqlDb, owner: number, keep: ReadonlySet<string>): void {
  db.prepare(
    'DELETE FROM sync_issues WHERE owner_id = ? AND uid NOT IN (SELECT value FROM json_each(?))'
  ).run(owner, JSON.stringify([...keep]))
}

export function syncIssueCount(db: SqlDb, owner: number): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sync_issues i
       JOIN collection_entries e ON e.uid = i.uid AND e.owner_id = i.owner_id AND e.deleted_at IS NULL
       WHERE i.owner_id = ?`
    )
    .get(owner) as { n: number }
  return Number(n)
}

/**
 * The owner's entries that can't sync, with what the user needs to recognise them, oldest issue
 * first. Lists every entry `syncIssueCount` counts: one whose printing (or card) row is missing
 * locally still shows, named through its image's card and with set details left blank.
 */
export function listSyncIssues(db: SqlDb, owner: number): UnsyncedEntry[] {
  const rows = db
    .prepare(
      `SELECT i.uid, COALESCE(c.name, ic.name, 'Unknown card') AS name,
              COALESCE(p.set_code, '') AS set_code, COALESCE(p.set_name, '') AS set_name,
              COALESCE(p.set_rarity, '') AS set_rarity, p.language, i.pkey, e.quantity, i.reason
       FROM sync_issues i
       JOIN collection_entries e ON e.uid = i.uid AND e.owner_id = i.owner_id AND e.deleted_at IS NULL
       LEFT JOIN card_printings p ON p.id = e.printing_id
       LEFT JOIN cards c ON c.id = p.card_id
       LEFT JOIN card_images im ON im.image_id = e.image_id
       LEFT JOIN cards ic ON ic.id = im.card_id
       WHERE i.owner_id = ?
       ORDER BY i.since, name, i.uid`
    )
    .all(owner) as {
    uid: string
    name: string
    set_code: string
    set_name: string
    set_rarity: string
    language: string | null
    pkey: string
    quantity: number
    reason: string
  }[]
  return rows.map((r) => {
    // With no printing row, the pkey's first part is still the language.
    const language = r.language ?? r.pkey.split('|')[0]
    return {
      uid: r.uid,
      name: r.name,
      setCode: r.set_code,
      setName: r.set_name,
      rarity: r.set_rarity,
      language: isLanguage(language) ? language : 'en',
      quantity: r.quantity,
      reason: r.reason
    }
  })
}
