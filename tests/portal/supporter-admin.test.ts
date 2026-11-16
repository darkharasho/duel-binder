import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'
import { fakeStripe, stripeSub } from './stripeFake'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { setShowOnSite, supporterOf, writeSubscription } from '../../workers/portal/src/supporters'
import { mergeAccounts } from '../../workers/portal/src/merge'
import type { AdminSupporters } from '../../src/shared/admin'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-16T12:00:00.000Z')
const LATER = new Date('2026-11-17T12:00:00.000Z')

describe('supporters around the portal', () => {
  let db: Database.Database
  let deps: AppDeps
  let stripe: ReturnType<typeof fakeStripe>
  let owner: number
  let alice: number
  let bob: number

  const session = (userId: number, token: string): void => {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
    ).run(
      createHash('sha256').update(token).digest('hex'),
      userId,
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }
  const get = (path: string, token?: string): Promise<Response> =>
    handle(new Request(BASE + path, { headers: token ? { cookie: `session=${token}` } : {} }), deps)
  const post = (path: string, token: string, body: unknown): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: 'POST',
        headers: { cookie: `session=${token}`, origin: BASE, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      deps
    )

  beforeEach(async () => {
    db = await seededServerDb()
    owner = addUser(db, '999', 'owner')
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    session(owner, 'tok-owner')
    session(alice, 'tok-alice')
    session(bob, 'tok-bob')
    stripe = fakeStripe()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'secret',
        ADMIN_TOKEN: 'admin',
        ADMIN_DISCORD_ID: '999',
        PRICE_WORKER_URL: 'https://prices.test',
        STRIPE_SECRET_KEY: 'rk_test_x'
      },
      now: () => NOW,
      fetch: stripe.fetch
    }
  })

  describe('account delete', () => {
    it('cancels a live subscription before deleting', async () => {
      writeSubscription(db, alice, stripeSub(), NOW)
      const res = await post('/api/account/delete', 'tok-alice', { confirm: 'delete' })
      expect(res.status).toBe(204)
      expect(stripe.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'DELETE /v1/customers/cus_1'
      ])
      expect(db.prepare('SELECT count(*) AS n FROM supporters').get()).toEqual({ n: 0 })
    })

    it('still deletes when the cancel fails', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      writeSubscription(db, alice, stripeSub(), NOW)
      stripe.fail.add('/v1/customers/cus_1')
      expect((await post('/api/account/delete', 'tok-alice', { confirm: 'delete' })).status).toBe(
        204
      )
      expect(db.prepare('SELECT count(*) AS n FROM users WHERE id = ?').get(alice)).toEqual({
        n: 0
      })
      expect(log).toHaveBeenCalled()
      log.mockRestore()
    })

    it('deletes the customer even with only a checkout started', async () => {
      db.prepare(
        'INSERT INTO supporters (user_id, stripe_customer_id, updated_at) VALUES (?, ?, ?)'
      ).run(alice, 'cus_9', NOW.toISOString())
      expect((await post('/api/account/delete', 'tok-alice', { confirm: 'delete' })).status).toBe(
        204
      )
      expect(stripe.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'DELETE /v1/customers/cus_9'
      ])
    })

    it('makes no Stripe call without a customer', async () => {
      expect((await post('/api/account/delete', 'tok-alice', { confirm: 'delete' })).status).toBe(
        204
      )
      expect(stripe.calls).toHaveLength(0)
    })
  })

  describe('account merge', () => {
    let bea: number
    beforeEach(() => {
      bea = addUser(db, 'apple:bea-sub', 'bea')
    })
    const merge = (survivor: number, closed: number): void =>
      mergeAccounts(db, {
        survivor,
        closed,
        cards: 'higher',
        username: 'mine',
        moved: { provider: 'apple', subject: 'bea-sub' },
        appleRefreshToken: null,
        now: NOW
      })

    it("moves the closed account's subscription to the survivor", () => {
      writeSubscription(db, bea, stripeSub({ id: 'sub_b', customer: 'cus_b' }), NOW)
      merge(alice, bea)
      expect(supporterOf(db, alice)).not.toBeNull()
      expect(db.prepare('SELECT user_id FROM supporters').all()).toEqual([{ user_id: alice }])
    })

    it("takes the closed account's live subscription over the survivor's ended one", () => {
      writeSubscription(db, alice, stripeSub({ status: 'canceled' }), NOW)
      writeSubscription(db, bea, stripeSub({ id: 'sub_b', customer: 'cus_b' }), NOW)
      merge(alice, bea)
      expect(db.prepare('SELECT user_id, stripe_customer_id FROM supporters').all()).toEqual([
        { user_id: alice, stripe_customer_id: 'cus_b' }
      ])
    })

    it("keeps the survivor's live subscription and holds the other with the closed account", () => {
      writeSubscription(db, alice, stripeSub(), NOW)
      writeSubscription(db, bea, stripeSub({ id: 'sub_b', customer: 'cus_b' }), NOW)
      merge(alice, bea)
      expect(db.prepare('SELECT user_id FROM supporters ORDER BY user_id').all()).toEqual([
        { user_id: alice },
        { user_id: bea }
      ])
    })
  })

  it('marks supporting friends in the overview', async () => {
    for (const other of [bob, owner])
      db.prepare(
        "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'accepted', ?, ?)"
      ).run(alice, other, NOW.toISOString(), NOW.toISOString())
    writeSubscription(db, bob, stripeSub({ id: 'sub_b', customer: 'cus_b' }), NOW)
    const res = await handle(
      new Request(`${BASE}/api/rpc/friends:overview`, {
        method: 'POST',
        headers: { cookie: 'session=tok-alice', origin: BASE, 'content-type': 'application/json' },
        body: JSON.stringify({ args: [] })
      }),
      deps
    )
    const { friends } = (
      (await res.json()) as { result: { friends: { id: number; supporter?: true }[] } }
    ).result
    expect(friends.find((f) => f.id === bob)?.supporter).toBe(true)
    expect('supporter' in friends.find((f) => f.id === owner)!).toBe(false)
  })

  describe('/admin/supporters', () => {
    it('is not found for anyone but an admin', async () => {
      expect((await get('/admin/supporters', 'tok-alice')).status).toBe(404)
      expect((await get('/admin/supporters')).status).toBe(404)
    })

    it('counts supporters and monthly income', async () => {
      writeSubscription(db, alice, stripeSub({ interval: 'month', amount: 300 }), NOW)
      writeSubscription(db, bob, stripeSub({ id: 'sub_b', customer: 'cus_b' }), LATER)
      const r = (await (await get('/admin/supporters', 'tok-owner')).json()) as AdminSupporters
      expect(r).toMatchObject({ active: 2, monthly: 1, yearly: 1, monthlyCents: 508 })
      expect(r.list.map((s) => s.username)).toEqual(['bob', 'alice'])
      expect(r.list[1]).toEqual({
        userId: alice,
        username: 'alice',
        displayName: null,
        plan: 'month',
        amountCents: 300,
        status: 'active',
        since: NOW.toISOString(),
        until: '2027-11-16T00:00:00.000Z',
        cancelling: false,
        showOnSite: false
      })
    })

    it('lists lapsed customers but leaves them out of the counts', async () => {
      writeSubscription(db, alice, stripeSub({ status: 'canceled' }), NOW)
      const r = (await (await get('/admin/supporters', 'tok-owner')).json()) as AdminSupporters
      expect(r).toMatchObject({ active: 0, monthlyCents: 0 })
      expect(r.list).toHaveLength(1)
    })
  })

  it('lists opted-in supporters for the site, cached for a while', async () => {
    writeSubscription(db, alice, stripeSub(), NOW)
    writeSubscription(db, bob, stripeSub({ id: 'sub_b', customer: 'cus_b' }), NOW)
    setShowOnSite(db, alice, true)
    const res = await get('/api/supporters/names')
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await res.json()).toEqual({ names: ['alice'] })
  })
})
