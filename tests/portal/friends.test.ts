import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import {
  FriendError,
  acceptFriend,
  areFriends,
  blockUser,
  friendsOverview,
  ignoreFriend,
  removeFriend,
  requestFriend,
  unblockUser,
  DAILY_REQUEST_LIMIT
} from '../../workers/portal/src/friends'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb } from './helpers'

const NOW = new Date('2026-10-25T12:00:00.000Z')

describe('friends', () => {
  let db: Database.Database
  let alice: number
  let bob: number
  let carol: number

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, 'd-alice', 'alice')
    bob = addUser(db, 'd-bob', 'bob')
    carol = addUser(db, 'd-carol', 'carol')
  })

  const befriend = (): void => {
    requestFriend(db, alice, 'bob', NOW)
    acceptFriend(db, bob, alice, NOW)
  }

  it('sends a request by trimmed, case-insensitive username', () => {
    expect(requestFriend(db, alice, '  BOB ', NOW)).toEqual({ status: 'sent' })
    expect(friendsOverview(db, bob).incoming).toEqual([
      expect.objectContaining({ id: alice, username: 'alice', sentAt: NOW.toISOString() })
    ])
    expect(friendsOverview(db, alice)).toEqual({ friends: [], incoming: [], blocked: [] })
  })

  it('a repeated request stays a single request', () => {
    requestFriend(db, alice, 'bob', NOW)
    expect(requestFriend(db, alice, 'bob', NOW)).toEqual({ status: 'sent' })
    expect(friendsOverview(db, bob).incoming).toHaveLength(1)
  })

  it('a crossed request accepts the friendship', () => {
    requestFriend(db, alice, 'bob', NOW)
    const r = requestFriend(db, bob, 'alice', NOW)
    expect(r).toEqual({
      status: 'accepted',
      friend: expect.objectContaining({ id: alice, username: 'alice' })
    })
    for (const [me, other] of [
      [alice, bob],
      [bob, alice]
    ]) {
      const o = friendsOverview(db, me)
      expect(o.friends.map((f) => f.id)).toEqual([other])
      expect(o.incoming).toEqual([])
    }
  })

  it('accepting makes both sides friends; with no request it throws', () => {
    requestFriend(db, alice, 'bob', NOW)
    acceptFriend(db, bob, alice, NOW)
    expect(friendsOverview(db, alice).friends.map((f) => f.id)).toEqual([bob])
    expect(friendsOverview(db, bob).friends.map((f) => f.id)).toEqual([alice])
    expect(() => acceptFriend(db, bob, carol, NOW)).toThrow(FriendError)
    expect(() => acceptFriend(db, alice, bob, NOW)).toThrow(FriendError)
  })

  it('ignoring removes the request and lets it be sent again', () => {
    requestFriend(db, alice, 'bob', NOW)
    ignoreFriend(db, bob, alice)
    expect(friendsOverview(db, bob).incoming).toEqual([])
    expect(friendsOverview(db, alice)).toEqual({ friends: [], incoming: [], blocked: [] })
    requestFriend(db, alice, 'bob', NOW)
    expect(friendsOverview(db, bob).incoming).toHaveLength(1)
  })

  it('either side can end a friendship', () => {
    befriend()
    expect(areFriends(db, alice, bob)).toBe(true)
    removeFriend(db, alice, bob)
    expect(areFriends(db, alice, bob)).toBe(false)
    expect(areFriends(db, bob, alice)).toBe(false)
    befriend()
    removeFriend(db, bob, alice)
    expect(areFriends(db, alice, bob)).toBe(false)
    expect(friendsOverview(db, alice).friends).toEqual([])
  })

  it('rejects bad requests with clear messages', () => {
    expect(() => requestFriend(db, alice, 'zed', NOW)).toThrow(
      new FriendError('No Duel Binder user called "zed"')
    )
    expect(() => requestFriend(db, alice, 'Alice', NOW)).toThrow(new FriendError("That's you"))
    expect(() => requestFriend(db, alice, '   ', NOW)).toThrow(
      new FriendError('Enter a Discord username')
    )
    befriend()
    expect(() => requestFriend(db, alice, 'bob', NOW)).toThrow(
      new FriendError("You're already friends with bob")
    )
    expect(() => requestFriend(db, bob, 'alice', NOW)).toThrow(
      new FriendError("You're already friends with alice")
    )
  })

  it('areFriends is false while a request is only pending', () => {
    requestFriend(db, alice, 'bob', NOW)
    expect(areFriends(db, alice, bob)).toBe(false)
    expect(areFriends(db, bob, alice)).toBe(false)
  })

  it('reports card count and latest change, tombstones included', () => {
    befriend()
    const printing = db
      .prepare("SELECT id, card_id FROM card_printings WHERE language = 'en' ORDER BY id LIMIT 3")
      .all() as {
      id: number
      card_id: number
    }[]
    const scope = userScope(bob)
    const imageOf = (cardId: number): number =>
      (
        db
          .prepare(
            'SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order, image_id LIMIT 1'
          )
          .get(cardId) as { image_id: number }
      ).image_id
    const add = (i: number, q: number, at: string): ReturnType<typeof addEntry> =>
      addEntry(
        db,
        { printingId: printing[i].id, imageId: imageOf(printing[i].card_id), quantity: q },
        new Date(at),
        scope
      )
    add(0, 2, '2026-10-24T10:00:00.000Z')
    add(1, 3, '2026-10-24T11:00:00.000Z')
    const gone = add(2, 7, '2026-10-24T09:00:00.000Z')
    removeEntry(db, gone.id, new Date('2026-10-25T08:00:00.000Z'), scope)
    const rows = db
      .prepare('SELECT updated_at FROM collection_entries WHERE user_id = ?')
      .all(bob) as { updated_at: string }[]
    const latest = rows
      .map((r) => r.updated_at)
      .sort()
      .at(-1)
    const [f] = friendsOverview(db, alice).friends
    expect(f.cardCount).toBe(5)
    expect(f.updatedAt).toBe(latest)

    befriend2(carol)
    expect(friendsOverview(db, alice).friends.find((x) => x.id === carol)).toMatchObject({
      cardCount: 0,
      updatedAt: null
    })
  })

  function befriend2(other: number): void {
    requestFriend(db, alice, 'carol', NOW)
    acceptFriend(db, other, alice, NOW)
  }

  it('builds the avatar URL only when an avatar is set', () => {
    befriend()
    db.prepare("UPDATE users SET avatar = 'abc' WHERE id = ?").run(bob)
    expect(friendsOverview(db, alice).friends[0].avatarUrl).toBe(
      'https://cdn.discordapp.com/avatars/d-bob/abc.png'
    )
    expect(friendsOverview(db, bob).friends[0].avatarUrl).toBeNull()
  })

  it('sorts friends by display name and incoming newest first', () => {
    db.prepare("UPDATE users SET display_name = 'Zoe' WHERE id = ?").run(bob)
    db.prepare("UPDATE users SET display_name = 'amy' WHERE id = ?").run(carol)
    requestFriend(db, alice, 'bob', NOW)
    acceptFriend(db, bob, alice, NOW)
    requestFriend(db, alice, 'carol', NOW)
    acceptFriend(db, carol, alice, NOW)
    expect(friendsOverview(db, alice).friends.map((f) => f.id)).toEqual([carol, bob])

    requestFriend(db, bob, 'carol', new Date('2026-10-25T13:00:00.000Z'))
    const dave = addUser(db, 'd-dave', 'dave')
    requestFriend(db, dave, 'carol', new Date('2026-10-25T14:00:00.000Z'))
    expect(friendsOverview(db, carol).incoming.map((r) => r.id)).toEqual([dave, bob])
  })

  it('shows the username when the display name is blank, and sorts by it', () => {
    db.prepare("UPDATE users SET display_name = '' WHERE id = ?").run(bob)
    db.prepare("UPDATE users SET display_name = 'Amy' WHERE id = ?").run(carol)
    requestFriend(db, alice, 'bob', NOW)
    expect(friendsOverview(db, bob).incoming).toEqual([
      expect.objectContaining({ id: alice, displayName: null })
    ])
    acceptFriend(db, bob, alice, NOW)
    requestFriend(db, alice, 'carol', NOW)
    acceptFriend(db, carol, alice, NOW)
    const friends = friendsOverview(db, alice).friends
    expect(friends.map((f) => [f.id, f.displayName])).toEqual([
      [carol, 'Amy'],
      [bob, null]
    ])
  })

  it('caps new requests per rolling day, not repeats or accepts', () => {
    const others = Array.from({ length: DAILY_REQUEST_LIMIT + 1 }, (_, i) =>
      addUser(db, `d-u${i}`, `user${i}`)
    )
    for (let i = 0; i < DAILY_REQUEST_LIMIT; i++) requestFriend(db, alice, `user${i}`, NOW)
    // A repeat to a pending request and accepting a crossed one still work.
    expect(requestFriend(db, alice, 'user0', NOW)).toEqual({ status: 'sent' })
    requestFriend(db, bob, 'alice', NOW)
    expect(requestFriend(db, alice, 'bob', NOW).status).toBe('accepted')
    expect(() => requestFriend(db, alice, `user${DAILY_REQUEST_LIMIT}`, NOW)).toThrow(
      /Try again tomorrow/
    )
    // Ignored requests still count, so ignore-and-resend can't get around it.
    ignoreFriend(db, others[1], alice)
    expect(() => requestFriend(db, alice, 'user1', NOW)).toThrow(FriendError)
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1)
    expect(requestFriend(db, alice, `user${DAILY_REQUEST_LIMIT}`, later)).toEqual({
      status: 'sent'
    })
  })

  describe('blocking', () => {
    it('ends the friendship and lists them as blocked', () => {
      befriend()
      blockUser(db, alice, bob, NOW)
      expect(areFriends(db, alice, bob)).toBe(false)
      expect(friendsOverview(db, alice)).toEqual({
        friends: [],
        incoming: [],
        blocked: [expect.objectContaining({ id: bob, username: 'bob' })]
      })
      expect(friendsOverview(db, bob).blocked).toEqual([])
    })

    it('drops a pending request either way', () => {
      requestFriend(db, bob, 'alice', NOW)
      blockUser(db, alice, bob, NOW)
      expect(friendsOverview(db, alice).incoming).toEqual([])
      unblockUser(db, alice, bob)
      requestFriend(db, alice, 'bob', NOW)
      blockUser(db, alice, bob, NOW)
      expect(friendsOverview(db, bob).incoming).toEqual([])
    })

    it("tells the blocked person it was sent, but delivers nothing and doesn't count it", () => {
      blockUser(db, alice, bob, NOW)
      for (let i = 0; i <= DAILY_REQUEST_LIMIT; i++)
        expect(requestFriend(db, bob, 'alice', NOW)).toEqual({ status: 'sent' })
      expect(friendsOverview(db, alice).incoming).toEqual([])
      expect(requestFriend(db, bob, 'carol', NOW)).toEqual({ status: 'sent' })
    })

    it("won't let the blocker send a request until they unblock", () => {
      blockUser(db, alice, bob, NOW)
      expect(() => requestFriend(db, alice, 'bob', NOW)).toThrow(
        "You've blocked bob. Unblock them first."
      )
      unblockUser(db, alice, bob)
      expect(friendsOverview(db, alice).blocked).toEqual([])
      expect(areFriends(db, alice, bob)).toBe(false)
      expect(requestFriend(db, alice, 'bob', NOW)).toEqual({ status: 'sent' })
    })

    it('blocking twice is fine; self and unknown users are refused', () => {
      blockUser(db, alice, bob, NOW)
      blockUser(db, alice, bob, NOW)
      expect(friendsOverview(db, alice).blocked).toHaveLength(1)
      expect(() => blockUser(db, alice, alice, NOW)).toThrow(FriendError)
      expect(() => blockUser(db, alice, 9999, NOW)).toThrow(FriendError)
    })

    it('each side can block the other independently', () => {
      blockUser(db, alice, bob, NOW)
      blockUser(db, bob, alice, NOW)
      unblockUser(db, alice, bob)
      expect(requestFriend(db, alice, 'bob', NOW)).toEqual({ status: 'sent' })
      expect(friendsOverview(db, bob).incoming).toEqual([])
    })
  })
})
