import type Database from 'better-sqlite3'
import { RARITY_LABEL } from '../db/schema'
import { getBinder, listBinders, saveBinder } from '../repo/binders'
import { getFacets, listEntries } from '../repo/collection'
import { listScanSessions } from '../repo/scanSessions'
import { LOCAL, localScope, scopeGame, type Scope } from '../repo/scope'
import { getChecklist, listSets } from '../repo/sets'
import { getStats } from '../repo/stats'
import { listWishlist, setWish } from '../repo/wishlist'
import type { Me } from '../../shared/cloud'
import type { PortalChannel } from '../../shared/portal'
import type { GameId } from '../../shared/games'
import type { Language } from '../../shared/languages'
import type {
  CollectionFilters,
  Friend,
  FriendCardCopies,
  FriendsOverview,
  FriendStats,
  FriendUser,
  FriendWantsCard,
  WishOwners
} from '../../shared/types'
import { rng, seedSessionsFor, shuffle } from './fakeData'

/**
 * Dev fake data's friends: a few made-up people whose collections, scan sessions, binders and wants
 * live in the fake profile's own database under negative owner ids (no real account has one), and a
 * stand-in for the portal's friend channels that reads them with the same repo code the server uses.
 */

/** The fake profile's own user, so the Friends page shows while signed out. */
export const FAKE_ME: Me = {
  id: -1,
  username: 'you',
  displayName: 'You (fake data)',
  avatarUrl: null
}

interface FakePerson {
  user: FriendUser
  /** Printings owned per game, before Pokémon's share. */
  cards: number
  /** As the fake profile's own SESSION_PLAN: hours ago, cards, hidden. */
  sessions: [hoursAgo: number, cards: number, hidden: boolean][]
  wishlistVisible: boolean
  binders: boolean
}

const person = (
  id: number,
  username: string,
  displayName: string | null,
  rest: Omit<FakePerson, 'user'>
): FakePerson => ({ user: { id, username, displayName, avatarUrl: null }, ...rest })

/** Friends, then the one who sent a request. */
export const FAKE_PEOPLE: FakePerson[] = [
  person(-101, 'river_duels', 'River', {
    cards: 260,
    sessions: [
      [5, 22, false],
      [30, 7, false],
      [100, 4, true],
      [400, 12, false]
    ],
    wishlistVisible: true,
    binders: true
  }),
  person(-102, 'mika.tcg', 'Mika', {
    cards: 90,
    sessions: [[50, 5, false]],
    wishlistVisible: false,
    binders: false
  }),
  person(-103, 'binderguy', null, {
    cards: 25,
    sessions: [],
    wishlistVisible: true,
    binders: false
  }),
  person(-104, 'sam_pulls', 'Sam', {
    cards: 60,
    sessions: [[3, 10, false]],
    wishlistVisible: true,
    binders: false
  })
]
const FRIEND_IDS = [-101, -102, -103]
const REQUESTER = -104
const BLOCKED: FriendUser = {
  id: -105,
  username: 'spam_trader',
  displayName: null,
  avatarUrl: null
}

const SEED = 0x46524e

/** The share of a friend's cards that are printings the fake profile owns too. */
const OVERLAP = 0.4

/**
 * Gives each fake person a collection (with their sessions, binders and wants) in each game whose
 * catalog is synced and where they have none yet. Their rows are marked as sent and belong to no
 * signed-in owner, so sync never touches them. Returns the number of entries inserted.
 */
export function seedFakeFriends(db: Database.Database, now = new Date()): number {
  const has = db.prepare(
    'SELECT 1 FROM collection_entries WHERE owner_id = ? AND game = ? AND deleted_at IS NULL LIMIT 1'
  )
  const catalog = db.prepare(
    `SELECT p.id,
            (SELECT i.image_id FROM card_images i WHERE i.card_id = p.card_id ORDER BY i.sort_order LIMIT 1)
              AS image_id
     FROM card_printings p JOIN cards c ON c.id = p.card_id
     WHERE c.game = ? AND p.language = 'en' AND p.missing_from_api = 0 AND p.pkey IS NOT NULL
     ORDER BY p.id`
  )
  const mine = db.prepare(
    `SELECT DISTINCT e.printing_id AS id, e.image_id FROM collection_entries e
     WHERE e.owner_id = 0 AND e.game = ? AND e.deleted_at IS NULL ORDER BY e.printing_id`
  )
  const insert = db.prepare(
    `INSERT OR IGNORE INTO collection_entries
       (uid, owner_id, game, printing_id, image_id, quantity, notes, created_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 0)`
  )
  type Pick = { id: number; image_id: number }
  let inserted = 0
  db.transaction(() => {
    for (const game of ['ygo', 'pkm'] as const) {
      const pool = (catalog.all(game) as (Pick | { id: number; image_id: null })[]).filter(
        (c): c is Pick => c.image_id !== null
      )
      if (pool.length === 0) continue
      const own = mine.all(game) as Pick[]
      FAKE_PEOPLE.forEach((p, n) => {
        if (has.get(p.user.id, game)) return
        const rand = rng(SEED + n * 31 + game.length)
        const size = game === 'ygo' ? p.cards : Math.ceil(p.cards / 3)
        const picks = new Map<number, Pick>()
        for (const c of shuffle([...own], rand).slice(0, Math.floor(size * OVERLAP)))
          picks.set(c.id, c)
        for (let tries = 0; picks.size < size && tries < size * 4; tries++) {
          const c = pool[Math.floor(rand() * pool.length)]
          picks.set(c.id, c)
        }
        for (const c of picks.values()) {
          // Added over the last three months, so their newest additions and last update differ.
          const at = new Date(now.getTime() - Math.floor(rand() * 90 * 86_400_000)).toISOString()
          const quantity = 1 + Math.floor(rand() * 3)
          inserted += insert.run(
            crypto.randomUUID(),
            p.user.id,
            game,
            c.id,
            c.image_id,
            quantity,
            at,
            at
          ).changes
        }
        const scope = localScope(`'${game}'`, String(p.user.id))
        seedSessionsFor(db, p.user.id, game, p.sessions, rand, now)
        seedWants(db, scope, own, pool, rand, now)
        if (p.binders && game === 'ygo') seedBinders(db, scope, now)
      })
    }
    for (const t of [
      'collection_entries',
      'wishlist_entries',
      'binders',
      'binder_edits',
      'scan_sessions'
    ])
      db.prepare(`UPDATE ${t} SET dirty = 0 WHERE owner_id < 0 AND dirty = 1`).run()
  })()
  return inserted
}

/** A few wants: some printings the fake profile owns (so its cards show who wants them), some not. */
function seedWants(
  db: Database.Database,
  scope: Scope,
  own: { id: number }[],
  pool: { id: number }[],
  rand: () => number,
  now: Date
): void {
  const ids = [
    ...shuffle([...own], rand).slice(0, 3),
    ...Array.from({ length: 4 }, () => pool[Math.floor(rand() * pool.length)])
  ].map((c) => c.id)
  for (const id of new Set(ids)) setWish(db, id, rand() < 0.3 ? 2 : null, now, scope)
}

/** One binder friends can see and one they can't. */
function seedBinders(db: Database.Database, scope: Scope, now: Date): void {
  saveBinder(
    db,
    {
      name: 'Metal Raiders',
      rules: { version: 1, rules: [{ field: 'set', values: ['Metal Raiders'] }] },
      goal: 'card',
      languages: ['en'],
      friendsVisible: true
    },
    now,
    scope
  )
  saveBinder(
    db,
    {
      name: 'Dragons (private)',
      rules: { version: 1, rules: [{ field: 'name', op: 'contains', value: 'Dragon' }] },
      goal: 'none',
      languages: [],
      friendsVisible: false
    },
    now,
    scope
  )
}

/** The portal's "not friends" answer, as the app shows it. */
const NOT_FRIENDS = 'You are not friends with this person.'

export interface FakeFriends {
  /**
   * Answers a friends:* portal channel from the fake people; any other channel goes to `real`.
   * Friendships, requests and blocks reset on each launch.
   */
  portal<T>(
    real: <R>(channel: PortalChannel, args: unknown[]) => Promise<R>,
    channel: PortalChannel,
    args: unknown[]
  ): Promise<T>
}

export function createFakeFriends(
  db: Database.Database,
  now = (): Date => new Date()
): FakeFriends {
  const people = new Map(FAKE_PEOPLE.map((p) => [p.user.id, p]))
  const friends = new Set(FRIEND_IDS)
  const incoming = new Map([[REQUESTER, new Date(now().getTime() - 26 * 3_600_000).toISOString()]])
  const blocked = new Map([[BLOCKED.id, BLOCKED]])
  const wishVisible = new Map(FAKE_PEOPLE.map((p) => [p.user.id, p.wishlistVisible]))
  let myWishlistVisible = true

  const userOf = (id: number): FriendUser | undefined => people.get(id)?.user ?? blocked.get(id)
  const game = (): GameId => scopeGame(db, LOCAL)
  const scopeOf = (id: unknown): Scope => {
    if (typeof id !== 'number' || !friends.has(id)) throw new Error(NOT_FRIENDS)
    return localScope(`'${game()}'`, String(id))
  }
  const byName = (a: FriendUser, b: FriendUser): number =>
    (a.displayName || a.username).localeCompare(b.displayName || b.username, undefined, {
      sensitivity: 'base'
    })
  const friendList = (): FriendUser[] => [...friends].map((id) => people.get(id)!.user).sort(byName)
  const idList = (ids: number[]): string => (ids.length ? ids.join(',') : 'NULL')

  const handlers: Partial<Record<PortalChannel, (...args: unknown[]) => unknown>> = {
    'friends:overview': (): FriendsOverview => {
      const totals = db.prepare(
        `SELECT SUM(CASE WHEN deleted_at IS NULL THEN quantity ELSE 0 END) AS cards, MAX(updated_at) AS updated
         FROM collection_entries WHERE owner_id = ? AND game = ?`
      )
      return {
        friends: friendList().map((u): Friend => {
          const t = totals.get(u.id, game()) as { cards: number | null; updated: string | null }
          return { ...u, cardCount: t.cards ?? 0, updatedAt: t.updated }
        }),
        incoming: [...incoming].map(([id, sentAt]) => ({ ...people.get(id)!.user, sentAt })),
        blocked: [...blocked.values()].sort(byName)
      }
    },
    'friends:request': (username) => {
      const name = String(username).trim().toLowerCase()
      const p = FAKE_PEOPLE.find((x) => x.user.username.toLowerCase() === name)
      if (!p) throw new Error('No one has that username.')
      if (friends.has(p.user.id)) throw new Error('You are already friends.')
      if (incoming.delete(p.user.id)) {
        friends.add(p.user.id)
        return { status: 'accepted', friend: p.user }
      }
      return { status: 'sent' }
    },
    'friends:accept': (id) => {
      if (typeof id === 'number' && incoming.delete(id)) friends.add(id)
    },
    'friends:ignore': (id) => void incoming.delete(id as number),
    'friends:remove': (id) => void friends.delete(id as number),
    'friends:block': (id) => {
      const u = userOf(id as number)
      friends.delete(id as number)
      incoming.delete(id as number)
      if (u) blocked.set(u.id, u)
    },
    'friends:unblock': (id) => void blocked.delete(id as number),
    'friends:collection': (id, f) =>
      listEntries(db, { ...(f as CollectionFilters), favourites: undefined }, scopeOf(id)).map(
        (e) => ({
          ...e,
          notes: ''
        })
      ),
    'friends:facets': (id) => getFacets(db, scopeOf(id)),
    'friends:stats': (id): FriendStats => {
      const scope = scopeOf(id)
      const stats = getStats(db, scope)
      const { n } = db
        .prepare(
          `SELECT COUNT(DISTINCT p.card_id) AS n FROM collection_entries e
           JOIN card_printings p ON p.id = e.printing_id
           WHERE ${scope.where('e')}
             AND p.card_id IN (SELECT p2.card_id FROM collection_entries e2
                               JOIN card_printings p2 ON p2.id = e2.printing_id
                               WHERE ${LOCAL.where('e2')})`
        )
        .get() as { n: number }
      const noNotes = <E extends { notes: string }>(es: E[]): E[] =>
        es.map((e) => ({ ...e, notes: '' }))
      return {
        ...stats,
        topEntries: noNotes(stats.topEntries),
        topSingles: noNotes(stats.topSingles),
        recentEntries: noNotes(stats.recentEntries),
        valueHistory: [],
        sharedCards: n
      }
    },
    'friends:sets': (id) => listSets(db, scopeOf(id)),
    'friends:checklist': (id, setName, language) =>
      getChecklist(db, String(setName), language as Language, scopeOf(id)),
    'friends:forCard': (cardId): FriendCardCopies[] => {
      const rows = db
        .prepare(
          `SELECT e.owner_id AS owner, p.set_code, ${RARITY_LABEL} AS set_rarity, p.language,
                  SUM(e.quantity) AS n
           FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id
           WHERE e.owner_id IN (${idList([...friends])}) AND e.game = ? AND e.deleted_at IS NULL
             AND p.card_id = ?
           GROUP BY e.owner_id, p.id ORDER BY p.set_code, p.id`
        )
        .all(game(), cardId) as {
        owner: number
        set_code: string
        set_rarity: string
        language: Language
        n: number
      }[]
      const out = new Map<number, FriendCardCopies>()
      for (const r of rows) {
        const f = out.get(r.owner) ?? { ...people.get(r.owner)!.user, quantity: 0, printings: [] }
        out.set(r.owner, f)
        f.quantity += r.n
        f.printings.push({
          setCode: r.set_code,
          rarity: r.set_rarity,
          language: r.language,
          quantity: r.n
        })
      }
      return [...out.values()].sort((a, b) => b.quantity - a.quantity)
    },
    'friends:wishlist': (id) => {
      const scope = scopeOf(id)
      if (!wishVisible.get(id as number)) return []
      return listWishlist(db, scope).filter((w) => w.owned < (w.quantity ?? 1))
    },
    'friends:binders': (id) => {
      const scope = scopeOf(id)
      const visible = db
        .prepare(`SELECT b.uid FROM binders b WHERE ${scope.where('b')} AND b.friends_visible = 1`)
        .pluck()
        .all() as string[]
      return visible.length ? listBinders(db, scope, new Set(visible)) : []
    },
    'friends:binder': (id, uid) => {
      const b = getBinder(db, String(uid), scopeOf(id))
      return b?.friendsVisible ? b : null
    },
    'friends:sessions': (id) =>
      listScanSessions(db, game(), scopeOf(id)).filter((s) => s.friendsVisible),
    'friends:wanting': (cardId): FriendWantsCard[] =>
      friendList()
        .filter((u) => wishVisible.get(u.id))
        .flatMap((u) => {
          const printings = listWishlist(db, localScope(`'${game()}'`, String(u.id)))
            .filter((w) => w.card.id === cardId && w.owned < (w.quantity ?? 1))
            .map((w) => ({
              setCode: w.printing.setCode,
              rarity: w.printing.setRarity,
              language: w.printing.language
            }))
          return printings.length ? [{ ...u, printings }] : []
        }),
    'friends:owning': (pkeys): WishOwners[] => {
      const rows = db
        .prepare(
          `SELECT p.pkey, e.owner_id AS owner, SUM(e.quantity) AS n
           FROM card_printings p JOIN collection_entries e ON e.printing_id = p.id
           WHERE p.pkey IN (SELECT value FROM json_each(?)) AND e.game = ? AND e.deleted_at IS NULL
             AND e.owner_id IN (${idList([...friends])})
           GROUP BY p.pkey, e.owner_id ORDER BY p.pkey, n DESC, e.owner_id`
        )
        .all(JSON.stringify(pkeys), game()) as { pkey: string; owner: number; n: number }[]
      const out = new Map<string, WishOwners>()
      for (const r of rows) {
        const row = out.get(r.pkey) ?? { pkey: r.pkey, friends: [] }
        out.set(r.pkey, row)
        row.friends.push({ ...people.get(r.owner)!.user, quantity: r.n })
      }
      return [...out.values()]
    },
    'friends:wishlistVisible': () => myWishlistVisible,
    'friends:setWishlistVisible': (visible) => {
      myWishlistVisible = visible === true
    }
  }

  return {
    async portal(real, channel, args) {
      const handler = handlers[channel]
      if (!handler) return real(channel, args)
      return handler(...args) as never
    }
  }
}
