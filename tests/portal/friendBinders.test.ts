import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { friendBinder, friendBinders } from '../../workers/portal/src/friendBinders'
import { userScope } from '../../workers/portal/src/scope'
import { addEntry } from '../../src/main/repo/collection'
import { saveBinder } from '../../src/main/repo/binders'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-01T12:00:00.000Z')

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const draft = (over: Record<string, unknown> = {}): never =>
  ({
    name: 'Shown',
    rules: { version: 1, rules: [{ field: 'name', op: 'contains', value: 'a' }] },
    goal: 'card',
    languages: [],
    friendsVisible: true,
    ...over
  }) as never

describe('friends read binders', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number
  let bob: number
  let ca: string
  let cb: string

  const session = async (userId: number, token: string): Promise<string> => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(
      await sha256Hex(token),
      userId,
      NOW.toISOString(),
      new Date(NOW.getTime() + 3600_000).toISOString()
    )
    return `session=${token}`
  }
  const call = async (
    channel: string,
    args: unknown[],
    cookie: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ status: number; body: any }> => {
    const res = await handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ args })
      }),
      deps
    )
    return { status: res.status, body: await res.json() }
  }
  const befriend = async (): Promise<void> => {
    await call('friends:request', ['bob'], ca)
    await call('friends:accept', [alice], cb)
  }
  const bobScope = (): ReturnType<typeof userScope> => userScope(bob, 'ygo')

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
    ca = await session(alice, 'ta')
    cb = await session(bob, 'tb')
  })

  it('shows only visible binders, with cards and missing slots', async () => {
    const shown = saveBinder(db, draft(), NOW, bobScope())
    saveBinder(db, draft({ name: 'Secret', friendsVisible: false }), NOW, bobScope())
    await befriend()
    const list = await call('friends:binders', [bob], ca)
    expect(list.body.result.map((b: { uid: string }) => b.uid)).toEqual([shown])
    const one = await call('friends:binder', [bob, shown], ca)
    expect(one.body.result.cards.length).toBeGreaterThan(0)
    expect(one.body.result.missingSlots).toBeGreaterThan(0)
  })

  it('answers null for a private binder, as for an unknown one', async () => {
    const priv = saveBinder(db, draft({ friendsVisible: false }), NOW, bobScope())
    await befriend()
    const a = await call('friends:binder', [bob, priv], ca)
    const b = await call('friends:binder', [bob, 'nope'], ca)
    expect(a).toEqual(b)
    expect(a.body.result).toBeNull()
  })

  it('refuses non-friends, blocked users and removed friends', async () => {
    const uid = saveBinder(db, draft(), NOW, bobScope())
    const NOT = { error: "You aren't friends with this user" }
    expect((await call('friends:binders', [bob], ca)).body).toEqual(NOT)
    expect((await call('friends:binder', [bob, uid], ca)).body).toEqual(NOT)
    await befriend()
    expect((await call('friends:binders', [bob], ca)).body.result).toHaveLength(1)
    await call('friends:remove', [bob], ca)
    expect((await call('friends:binders', [bob], ca)).body).toEqual(NOT)
    await befriend()
    await call('friends:block', [alice], cb)
    expect((await call('friends:binder', [bob, uid], ca)).body).toEqual(NOT)
  })

  it('refuses a block from either side', async () => {
    const uid = saveBinder(db, draft(), NOW, bobScope())
    const NOT = { error: "You aren't friends with this user" }
    await befriend()
    await call('friends:block', [bob], ca)
    expect((await call('friends:binder', [bob, uid], ca)).body).toEqual(NOT)
    expect((await call('friends:binders', [alice], cb)).body).toEqual(NOT)
  })

  it('answers null for a visible uid under the wrong game', () => {
    const uid = saveBinder(db, draft(), NOW, bobScope())
    expect(friendBinder(db, bob, 'ygo', uid)).not.toBeNull()
    expect(friendBinder(db, bob, 'pkm', uid)).toBeNull()
    expect(friendBinders(db, bob, 'pkm')).toEqual([])
  })

  it('checks arguments', async () => {
    await befriend()
    for (const args of [
      [bob, ''],
      [bob, 5],
      [bob, 'x'.repeat(65)],
      ['bob', 'u']
    ])
      expect((await call('friends:binder', args, ca)).status).toBe(400)
    expect((await call('friends:binders', ['bob'], ca)).status).toBe(400)
  })

  it("counts progress from the owner's copies, not the caller's", () => {
    const printing = db
      .prepare(
        `SELECT p.id, i.image_id FROM card_printings p
           JOIN card_images i ON i.card_id = p.card_id WHERE p.game = 'ygo' LIMIT 1`
      )
      .get() as { id: number; image_id: number }
    const uid = saveBinder(db, draft(), NOW, bobScope())
    const before = friendBinders(db, bob, 'ygo')[0].ownedSlots
    addEntry(
      db,
      { printingId: printing.id, imageId: printing.image_id, quantity: 1 },
      NOW,
      userScope(alice, 'ygo')
    )
    expect(friendBinders(db, bob, 'ygo')[0].ownedSlots).toBe(before)
    addEntry(
      db,
      { printingId: printing.id, imageId: printing.image_id, quantity: 1 },
      NOW,
      bobScope()
    )
    const after = friendBinder(db, bob, 'ygo', uid)!
    expect(after.ownedSlots).toBe(before + 1)
    expect(after.cards.some((c) => c.owned > 0)).toBe(true)
  })
})
