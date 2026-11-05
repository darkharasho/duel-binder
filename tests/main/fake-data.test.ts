import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { seedFakeCollection, seedFakeSessions } from '../../src/main/dev/fakeData'
import { createFakeFriends, seedFakeFriends, type FakeFriends } from '../../src/main/dev/fakeFriends'
import { listScanSessions } from '../../src/main/repo/scanSessions'
import { getStats } from '../../src/main/repo/stats'
import type { ScanSession } from '../../src/shared/scanSessions'
import type {
  BinderSummary,
  EntryView,
  FriendsOverview,
  FriendStats
} from '../../src/shared/types'
import { seededDb } from './helpers'

const NOW = new Date(2026, 9, 23, 12)

describe('seedFakeCollection', () => {
  it('owns every card of a fully planned set and writes a value history', async () => {
    const db = await seededDb()
    expect(seedFakeCollection(db, NOW)).toBeGreaterThan(0)

    const lobCards = db
      .prepare(
        `SELECT COUNT(DISTINCT p.card_id) AS n FROM collection_entries e
         JOIN card_printings p ON p.id = e.printing_id WHERE p.set_name = 'Legend of Blue Eyes White Dragon'`
      )
      .get() as { n: number }
    expect(lobCards.n).toBe(2)

    const snapshots = db.prepare('SELECT date FROM value_snapshots ORDER BY date').all() as {
      date: string
    }[]
    expect(snapshots).toHaveLength(91)
    expect(snapshots.at(-1)?.date).toBe('2026-10-23')
  })

  it('does nothing when the collection already has entries', async () => {
    const db = await seededDb()
    seedFakeCollection(db, NOW)
    const before = db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()
    expect(seedFakeCollection(db, NOW)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual(before)
  })

  it('does nothing before the catalogue is synced', () => {
    const db = openDatabase(':memory:')
    expect(seedFakeCollection(db, NOW)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM value_snapshots').get()).toEqual({ n: 0 })
  })
})

describe('seedFakeSessions', () => {
  it('adds sessions from owned cards, one hidden, once', async () => {
    const db = await seededDb()
    seedFakeCollection(db, NOW)
    const n = seedFakeSessions(db, NOW)
    expect(n).toBeGreaterThan(0)
    const sessions = listScanSessions(db, 'ygo')
    expect(sessions).toHaveLength(n)
    expect(sessions.filter((s) => !s.friendsVisible)).toHaveLength(1)
    expect(sessions.every((s) => s.cards.length > 0 && s.cards.every((c) => c.pkey))).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM scan_sessions WHERE dirty = 1').get()).toEqual({
      n: 0
    })
    expect(seedFakeSessions(db, NOW)).toBe(0)
  })

  it('does nothing without a collection', async () => {
    const db = await seededDb()
    expect(seedFakeSessions(db, NOW)).toBe(0)
  })
})

describe('seedFakeFriends', () => {
  const real = async (): Promise<never> => {
    throw new Error('went to the portal')
  }
  const setUp = async (): Promise<{ db: Awaited<ReturnType<typeof seededDb>>; f: FakeFriends }> => {
    const db = await seededDb()
    seedFakeCollection(db, NOW)
    seedFakeSessions(db, NOW)
    expect(seedFakeFriends(db, NOW)).toBeGreaterThan(0)
    return { db, f: createFakeFriends(db, () => NOW) }
  }

  it("leaves the profile's own collection and sessions as they were, and syncs nothing", async () => {
    const db = await seededDb()
    seedFakeCollection(db, NOW)
    seedFakeSessions(db, NOW)
    const own = getStats(db).totalCards
    const sessions = listScanSessions(db, 'ygo').length
    seedFakeFriends(db, NOW)
    expect(getStats(db).totalCards).toBe(own)
    expect(listScanSessions(db, 'ygo')).toHaveLength(sessions)
    for (const t of ['collection_entries', 'wishlist_entries', 'binders', 'scan_sessions'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE owner_id < 0 AND dirty = 1`).get()).toEqual({ n: 0 })
    expect(seedFakeFriends(db, NOW)).toBe(0)
  })

  it('answers the friend pages from the fake friends', async () => {
    const { f } = await setUp()
    const o = await f.portal<FriendsOverview>(real, 'friends:overview', [])
    expect(o.friends.map((x) => x.username)).toEqual(['binderguy', 'mika.tcg', 'river_duels'])
    expect(o.friends.every((x) => x.cardCount > 0)).toBe(true)
    expect(o.incoming.map((x) => x.username)).toEqual(['sam_pulls'])
    expect(o.blocked.map((x) => x.username)).toEqual(['spam_trader'])

    const river = o.friends.find((x) => x.username === 'river_duels')!.id
    const sessions = await f.portal<ScanSession[]>(real, 'friends:sessions', [river])
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((s) => s.friendsVisible)).toBe(true)
    const binders = await f.portal<BinderSummary[]>(real, 'friends:binders', [river])
    expect(binders.map((b) => b.name)).toEqual(['Metal Raiders'])
    const entries = await f.portal<EntryView[]>(real, 'friends:collection', [river, {}])
    expect(entries.length).toBeGreaterThan(0)
    expect((await f.portal<FriendStats>(real, 'friends:stats', [river])).sharedCards).toBeGreaterThan(0)

    // Mika hides their wants.
    const mika = o.friends.find((x) => x.username === 'mika.tcg')!.id
    expect(await f.portal(real, 'friends:wishlist', [mika])).toEqual([])
  })

  it('accepts the request, and refuses someone who is not a friend', async () => {
    const { f } = await setUp()
    await expect(f.portal(real, 'friends:sessions', [-104])).rejects.toThrow('not friends')
    await f.portal(real, 'friends:accept', [-104])
    const o = await f.portal<FriendsOverview>(real, 'friends:overview', [])
    expect(o.incoming).toEqual([])
    expect(o.friends.map((x) => x.username)).toContain('sam_pulls')
    expect((await f.portal<ScanSession[]>(real, 'friends:sessions', [-104])).length).toBe(1)
  })

  it('sends other channels to the real portal', async () => {
    const { f } = await setUp()
    await expect(f.portal(real, 'account:signIns', [])).rejects.toThrow('went to the portal')
  })
})
