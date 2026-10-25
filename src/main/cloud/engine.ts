import type Database from 'better-sqlite3'
import { setMeta } from '../db/meta'
import { recordSnapshot } from '../repo/stats'
import { MAX_PULL, MAX_PUSH, editTime, type WireEntry } from '../../shared/cloud'
import type { CloudClient } from './client'
import {
  accountState,
  activeOwner,
  applyPending,
  applyPrices,
  applyRemote,
  dirtyEntries,
  dropEntry,
  markPushed,
  pendingCount,
  purgeCleanTombstones,
  rekey,
  saveAccountState,
  stalePricePkeys,
  tombstoneClean
} from './localSync'

export interface SyncOutcome {
  /** Entries sent to the server. */
  pushed: number
  /** Live entries the server stored (it queues a price run for them). */
  pushedLive: number
  /** Entries received from the server. */
  pulled: number
  /** The owner's entries waiting for this computer's catalog to gain their printing. */
  pending: number
  /** Whether anything the user can see may have changed. */
  changed: boolean
}

const sameAs = (e: WireEntry): string => JSON.stringify(e)

/**
 * One sync of `owner`'s collection: push its unpushed rows, pull what the server has written since the
 * cursor, then fetch server prices. Each step commits as it goes, so a run cut off part way (offline,
 * app quit) loses nothing: unacknowledged pushes stay dirty and the cursor only moves with its page.
 * Throws CloudAuthError / CloudOfflineError from the client.
 */
export async function syncOnce(
  db: Database.Database,
  owner: number,
  client: CloudClient,
  now: () => Date
): Promise<SyncOutcome> {
  let changed = applyPending(db).applied > 0

  // 1. Push. `skip` holds uids the server can't take yet (unknown printing) and rows this run already
  // sent unchanged, so a row the results leave dirty can't loop; a row edited since it was sent goes again.
  const skip = new Set<string>()
  const sent = new Map<string, string>()
  let pushed = 0
  let pushedLive = 0
  for (;;) {
    const batch = dirtyEntries(db, owner, MAX_PUSH, skip)
    if (batch.length === 0) break
    const fresh = batch.filter((e) => {
      if (sent.get(e.uid) !== sameAs(e)) return true
      skip.add(e.uid)
      return false
    })
    if (fresh.length === 0) continue

    const results = await client.push(fresh)
    pushed += fresh.length
    const byUid = new Map(fresh.map((e) => [e.uid, e]))
    db.transaction(() => {
      for (const r of results) {
        const e = byUid.get(r.uid)
        if (!e) continue
        sent.set(e.uid, sameAs(e))
        switch (r.status) {
          case 'applied':
            markPushed(db, e)
            if (e.deletedAt === null) pushedLive++
            break
          case 'stale': {
            const result = applyRemote(db, owner, r.current)
            if (result === 'applied') changed = true
            else if (result === 'kept-local') {
              // An exact edit-time tie: the server keeps its row, so this computer takes it too.
              markPushed(db, e)
              if (applyRemote(db, owner, r.current) === 'applied') changed = true
            }
            break
          }
          case 'merged':
            // The server stored the pushed entry as a tombstone at its edit time; do the same here
            // first (unless edited since), so the winner then lands without a key collision.
            tombstoneClean(db, e, editTime(e))
            applyRemote(db, owner, r.winner)
            changed = true
            break
          case 'unknown-printing':
            skip.add(e.uid)
            break
          case 'rejected':
            // The uid belongs to another account: a tombstone has nothing to keep; a live entry gets a
            // fresh uid and goes again this run.
            if (e.deletedAt !== null) dropEntry(db, e.uid)
            else rekey(db, e.uid)
            break
        }
      }
    })()
  }

  // 2. Pull. Each page and its cursor commit together.
  let pulled = 0
  let cursor = accountState(db, owner).cursor
  for (;;) {
    const page = await client.pull(cursor)
    db.transaction(() => {
      for (const e of page.entries) {
        if (applyRemote(db, owner, e) === 'applied') changed = true
      }
      saveAccountState(db, owner, { cursor: page.cursor })
    })()
    pulled += page.entries.length
    cursor = page.cursor
    if (!page.more || page.entries.length === 0) break
  }

  // 3. Prices the server holds for printings whose local price is missing or stale.
  // Asked even with no keys, to keep price_service_status current.
  const { prices, status } = await client.prices(stalePricePkeys(db, now(), MAX_PULL))
  db.transaction(() => {
    if (applyPrices(db, prices) > 0) changed = true
    if (status !== null) setMeta(db, 'price_service_status', status)
  })()

  // 4. Tidy up and record the run.
  db.transaction(() => {
    purgeCleanTombstones(db, owner)
    saveAccountState(db, owner, { syncedAt: now().toISOString() })
    // recordSnapshot writes the active owner's (LOCAL) snapshot.
    if (changed && activeOwner(db) === owner) recordSnapshot(db, now())
  })()

  return { pushed, pushedLive, pulled, pending: pendingCount(db, owner), changed }
}
