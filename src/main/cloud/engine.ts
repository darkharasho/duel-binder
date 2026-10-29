import type { SqlDb } from '../db/sql'
import { setMeta } from '../db/meta'
import { recordSnapshot } from '../repo/stats'
import { MAX_CONTRIBUTE, type ContributeResult } from '../../shared/catalogFeed'
import { MAX_PULL, MAX_PUSH, editTime, type WireEntry } from '../../shared/cloud'
import { isGameId, type GameId } from '../../shared/games'
import { CloudAuthError, CloudOfflineError, type CloudClient } from './client'
import {
  activeOwner,
  applyPending,
  applyPrices,
  applyRemote,
  contributionGroups,
  dirtyEntries,
  gameCursor,
  pullPriceChanges,
  dropEntry,
  markPushed,
  pendingCount,
  pruneSyncIssues,
  purgeCleanTombstones,
  recordSyncIssue,
  rekey,
  saveAccountState,
  saveGameCursor,
  stalePricePkeys,
  syncIssueCount,
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
  /** The owner's entries that can't sync (the server lacks their printing and wouldn't take it). */
  unsynced: number
  /** Whether anything the user can see may have changed. */
  changed: boolean
}

const sameAs = (e: WireEntry): string => JSON.stringify(e)

/**
 * The games the account may sync, from `me()`. An old server leaves `games` out, which means
 * Yu-Gi-Oh! only; so does a failing `me()` (other than signed-out), so the rest of the run goes on.
 */
async function syncedGames(client: CloudClient): Promise<GameId[]> {
  try {
    const games = (await client.me()).games?.filter(isGameId) ?? []
    return games.includes('ygo') ? games : ['ygo', ...games]
  } catch (e) {
    if (e instanceof CloudAuthError) throw e
    return ['ygo']
  }
}

/**
 * One sync of `owner`'s collection: push its unpushed rows, pull what the server has written since the
 * cursor, then fetch server prices. Each step commits as it goes, so a run cut off part way (offline,
 * app quit) loses nothing: unacknowledged pushes stay dirty and the cursor only moves with its page.
 * Throws CloudAuthError / CloudOfflineError from the client.
 */
export async function syncOnce(
  db: SqlDb,
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
  /** Uids the server answered `unknown-printing` for, in this pass of the push loop. */
  const unknown = new Set<string>()
  const pushDirty = async (): Promise<void> => {
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
      // Recorded before the results are read, so a uid the server leaves out isn't pushed again this run.
      for (const e of fresh) sent.set(e.uid, sameAs(e))
      const byUid = new Map(fresh.map((e) => [e.uid, e]))
      db.transaction(() => {
        for (const r of results) {
          const e = byUid.get(r.uid)
          if (!e) continue
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
              unknown.add(e.uid)
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
  }
  await pushDirty()

  // 1b. Offer the server the printings it lacks, push those entries again, and note what still can't sync.
  const reasons = new Map<string, string>()
  const pkeys = new Map<string, string>()
  if (unknown.size > 0) {
    const retry = new Set<string>()
    const { groups, missing } = contributionGroups(db, owner, [...unknown])
    for (const g of groups) for (const uid of g.uids) pkeys.set(uid, g.pkey)
    for (const uid of missing) reasons.set(uid, 'unknown-printing')
    for (let i = 0; i < groups.length; i += MAX_CONTRIBUTE) {
      const chunk = groups.slice(i, i + MAX_CONTRIBUTE)
      let results: ContributeResult[]
      try {
        results = await client.contribute(chunk.map((g) => g.printing))
      } catch (err) {
        if (err instanceof CloudAuthError || err instanceof CloudOfflineError) throw err
        console.warn('Contributing printings failed; entries stay unsynced', err)
        break // the rest stay recorded as unknown-printing
      }
      // Results answer the request rows in order; the pkey can be '' so it is never used to match.
      chunk.forEach((g, j) => {
        const r = results[j]
        for (const uid of g.uids) {
          if (r && r.status !== 'rejected') retry.add(uid)
          else if (r) reasons.set(uid, r.reason ?? 'unknown-printing')
        }
      })
    }
    for (const uid of retry) {
      unknown.delete(uid)
      skip.delete(uid)
      sent.delete(uid)
    }
    if (retry.size > 0) await pushDirty()
  }
  // Whatever is still unknown after the retry can't sync for now.
  db.transaction(() => {
    const keep = new Set<string>()
    for (const uid of unknown) {
      recordSyncIssue(
        db,
        owner,
        uid,
        pkeys.get(uid) ?? '',
        reasons.get(uid) ?? 'unknown-printing',
        now()
      )
      keep.add(uid)
    }
    pruneSyncIssues(db, owner, keep)
  })()

  // 2. Pull, once per game the account may use, each from its own cursor (a game newly allowed
  // starts from 0). Each page and its cursor commit together.
  const games = await syncedGames(client)
  let pulled = 0
  for (const game of games) {
    let cursor = gameCursor(db, owner, game, 'entries')
    for (;;) {
      const page = await client.pull(cursor, game)
      db.transaction(() => {
        for (const e of page.entries) {
          if (applyRemote(db, owner, e) === 'applied') changed = true
        }
        saveGameCursor(db, owner, game, 'entries', page.cursor)
      })()
      pulled += page.entries.length
      cursor = page.cursor
      if (!page.more || page.entries.length === 0) break
    }
  }

  // 3. Every price change the server has made in each game, then prices for printings whose local
  // price is missing or stale (a printing the server hasn't priced yet).
  for (const game of games) if ((await pullPriceChanges(db, client, owner, game)) > 0) changed = true
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

  return {
    pushed,
    pushedLive,
    pulled,
    pending: pendingCount(db, owner),
    unsynced: syncIssueCount(db, owner),
    changed
  }
}
