import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'
import { fakeStripe, stripeSub } from './stripeFake'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { writeSubscription } from '../../workers/portal/src/supporters'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-16T12:00:00.000Z')

describe('supporter RPC', () => {
  let db: Database.Database
  let deps: AppDeps
  let stripe: ReturnType<typeof fakeStripe>
  let alice: number

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update('tok').digest('hex'),
      alice,
      'desktop',
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
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
        PRICE_WORKER_URL: 'https://prices.test',
        STRIPE_SECRET_KEY: 'rk_test_x',
        STRIPE_PRICE_MONTH: 'price_month',
        STRIPE_PRICE_YEAR: 'price_year',
        SUPPORTER_ENABLED: 'on'
      },
      now: () => NOW,
      fetch: stripe.fetch
    }
  })

  const rpc = async (
    channel: string,
    args: unknown[] = [],
    token: string | null = 'tok'
  ): Promise<{ status: number; body: { result?: unknown; error?: string } }> => {
    const res = await handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ args })
      }),
      deps
    )
    return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } }
  }
  const posts = (path: string) => stripe.calls.filter((c) => c.method === 'POST' && c.path === path)

  it('answers 401 signed out', async () => {
    for (const ch of [
      'supporter:status',
      'supporter:checkout',
      'supporter:manage',
      'supporter:setShowOnSite'
    ])
      expect((await rpc(ch, [], null)).status).toBe(401)
  })

  it('reports the gate and no subscription', async () => {
    deps.env.SUPPORTER_ENABLED = 'off'
    expect((await rpc('supporter:status')).body.result).toEqual({
      enabled: false,
      hasCustomer: false,
      supporter: null
    })
  })

  it('refuses checkout while the gate is off or for an unknown plan', async () => {
    deps.env.SUPPORTER_ENABLED = undefined
    expect(await rpc('supporter:checkout', ['month'])).toEqual({
      status: 400,
      body: { error: "Supporter subscriptions aren't open yet" }
    })
    deps.env.SUPPORTER_ENABLED = 'on'
    expect((await rpc('supporter:checkout', ['week'])).status).toBe(400)
    expect(stripe.calls).toHaveLength(0)
  })

  it('starts a checkout for a new customer', async () => {
    const res = await rpc('supporter:checkout', ['year'])
    expect(res).toEqual({
      status: 200,
      body: { result: { url: 'https://checkout.stripe.test/cs_1' } }
    })
    expect(posts('/v1/customers')[0].form.get('metadata[user_id]')).toBe(String(alice))
    const f = posts('/v1/checkout/sessions')[0].form
    expect(Object.fromEntries(f)).toEqual({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: String(alice),
      'line_items[0][price]': 'price_year',
      'line_items[0][quantity]': '1',
      success_url: `${BASE}/supporter/thanks`,
      cancel_url: `${BASE}/supporter/thanks?cancelled=1`,
      integration_identifier: 'duelbinder-supporter-kqzmwhrt'
    })
    expect(f.has('payment_method_types')).toBe(false)
  })

  it('reuses the customer on a second checkout', async () => {
    await rpc('supporter:checkout', ['year'])
    await rpc('supporter:checkout', ['month'])
    expect(posts('/v1/customers')).toHaveLength(1)
    const sessions = posts('/v1/checkout/sessions')
    expect(sessions[1].form.get('customer')).toBe('cus_1')
    expect(sessions[1].form.get('line_items[0][price]')).toBe('price_month')
    expect((await rpc('supporter:status')).body.result).toMatchObject({
      hasCustomer: true,
      supporter: null
    })
  })

  it('refuses checkout to a current supporter', async () => {
    writeSubscription(db, alice, stripeSub(), NOW)
    expect((await rpc('supporter:checkout', ['month'])).body.error).toBe(
      'You already support Duel Binder. Use Manage to change your plan.'
    )
  })

  it('checks Stripe before a second checkout, in case a payment has not landed yet', async () => {
    await rpc('supporter:checkout', ['month'])
    // They paid, but the webhook hasn't arrived: the row still says none.
    stripe.subs.set('cus_1', stripeSub({ interval: 'month', amount: 300 }))
    const res = await rpc('supporter:checkout', ['year'])
    expect(res.body.error).toBe('You already support Duel Binder. Use Manage to change your plan.')
    expect(posts('/v1/checkout/sessions')).toHaveLength(1)
    expect((await rpc('supporter:status')).body.result).toMatchObject({
      supporter: { plan: 'month' }
    })
  })

  it('opens the Customer Portal only with a customer', async () => {
    expect(await rpc('supporter:manage')).toEqual({
      status: 400,
      body: { error: 'No subscription to manage' }
    })
    writeSubscription(db, alice, stripeSub(), NOW)
    expect((await rpc('supporter:manage')).body.result).toEqual({
      url: 'https://billing.stripe.test/bps_1'
    })
    expect(Object.fromEntries(posts('/v1/billing_portal/sessions')[0].form)).toEqual({
      customer: 'cus_1',
      return_url: `${BASE}/supporter/thanks?managed=1`
    })
  })

  it('opens Manage even while the gate is off', async () => {
    deps.env.SUPPORTER_ENABLED = 'off'
    writeSubscription(db, alice, stripeSub(), NOW)
    expect((await rpc('supporter:manage')).status).toBe(200)
  })

  it('sets the thanks-list choice only for supporters', async () => {
    expect((await rpc('supporter:setShowOnSite', [true])).status).toBe(400)
    writeSubscription(db, alice, stripeSub(), NOW)
    const res = await rpc('supporter:setShowOnSite', [true])
    expect(res.body.result).toMatchObject({ supporter: { showOnSite: true } })
    expect((await rpc('supporter:setShowOnSite', ['yes'])).status).toBe(400)
  })

  it('reports a Stripe failure as a plain error', async () => {
    stripe.fail.add('/v1/customers')
    const res = await rpc('supporter:checkout', ['month'])
    expect(res).toEqual({
      status: 400,
      body: { error: "Couldn't reach the payment service. Try again." }
    })
  })
})
