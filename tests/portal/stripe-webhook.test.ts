import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { fakeStripe, stripeSub } from './stripeFake'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { verifyStripeSignature } from '../../workers/portal/src/stripe'
import { supporterOf } from '../../workers/portal/src/supporters'
import { areaOf } from '../../workers/portal/src/meter'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-16T12:00:00.000Z')
const SECRET = 'whsec_test'
const T = Math.floor(NOW.getTime() / 1000)

const sign = (body: string, secret = SECRET, t = T): string =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`

describe('Stripe webhook', () => {
  let db: Database.Database
  let deps: AppDeps
  let stripe: ReturnType<typeof fakeStripe>
  let alice: number

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
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
        STRIPE_WEBHOOK_SECRET: SECRET
      },
      now: () => NOW,
      fetch: stripe.fetch
    }
  })

  const send = (type: string, object: Record<string, unknown>, header?: string | null): Promise<Response> => {
    const body = JSON.stringify({ id: 'evt_1', type, data: { object } })
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const sig = header === undefined ? sign(body) : header
    if (sig !== null) headers['stripe-signature'] = sig
    return handle(new Request(`${BASE}/stripe/webhook`, { method: 'POST', headers, body }), deps)
  }
  const checkout = (): Promise<Response> =>
    send('checkout.session.completed', {
      object: 'checkout.session',
      client_reference_id: String(alice),
      customer: 'cus_1',
      subscription: 'sub_1'
    })

  describe('signature', () => {
    it('accepts a good signature, including among several v1 entries', async () => {
      const body = '{"a":1}'
      expect(await verifyStripeSignature(SECRET, sign(body), body, NOW)).toBe(true)
      const both = `t=${T},v1=${'0'.repeat(64)},v1=${sign(body).split('v1=')[1]}`
      expect(await verifyStripeSignature(SECRET, both, body, NOW)).toBe(true)
    })

    it('refuses a wrong secret, a stale time, a changed body and no header', async () => {
      const body = '{"a":1}'
      expect(await verifyStripeSignature(SECRET, sign(body, 'whsec_other'), body, NOW)).toBe(false)
      expect(await verifyStripeSignature(SECRET, sign(body, SECRET, T - 301), body, NOW)).toBe(false)
      expect(await verifyStripeSignature(SECRET, sign(body), '{"a":2}', NOW)).toBe(false)
      expect(await verifyStripeSignature(SECRET, null, body, NOW)).toBe(false)
      expect(await verifyStripeSignature(SECRET, 'garbage', body, NOW)).toBe(false)
    })

    it('answers 400 to a badly signed event and writes nothing', async () => {
      stripe.subs.set('cus_1', stripeSub())
      expect((await send('checkout.session.completed', { customer: 'cus_1' }, 'bad')).status).toBe(400)
      expect((await send('checkout.session.completed', { customer: 'cus_1' }, null)).status).toBe(400)
      expect(supporterOf(db, alice)).toBeNull()
    })

    it('answers 404 while no webhook secret is set', async () => {
      deps.env.STRIPE_WEBHOOK_SECRET = undefined
      expect((await checkout()).status).toBe(404)
    })
  })

  it('makes the buyer a supporter on checkout', async () => {
    stripe.subs.set('cus_1', stripeSub())
    expect((await checkout()).status).toBe(200)
    expect(supporterOf(db, alice)).toMatchObject({ plan: 'year', since: NOW.toISOString() })
    const row = db.prepare('SELECT stripe_customer_id FROM supporters WHERE user_id = ?').get(alice)
    expect(row).toEqual({ stripe_customer_id: 'cus_1' })
    const call = stripe.calls.find((c) => c.path === '/v1/subscriptions')!
    expect(call.query.get('customer')).toBe('cus_1')
    expect(call.query.get('status')).toBe('all')
    expect(call.headers.get('stripe-version')).toBe('2026-10-28.endive')
    expect(call.headers.get('authorization')).toBe('Bearer rk_test_x')
  })

  it("writes Stripe's latest state, not the event's", async () => {
    stripe.subs.set('cus_1', stripeSub())
    await checkout()
    stripe.subs.set('cus_1', stripeSub({ status: 'canceled' }))
    await send('customer.subscription.updated', { ...stripeSub({ status: 'active' }) })
    expect(supporterOf(db, alice)).toBeNull()
    // An old event replayed after the cancel changes nothing.
    await send('customer.subscription.created', { ...stripeSub({ status: 'active' }) })
    expect(supporterOf(db, alice)).toBeNull()
  })

  it('keeps the badge while a failed payment is retried', async () => {
    stripe.subs.set('cus_1', stripeSub())
    await checkout()
    stripe.subs.set('cus_1', stripeSub({ status: 'past_due' }))
    expect((await send('invoice.payment_failed', { object: 'invoice', customer: 'cus_1' })).status).toBe(200)
    expect(supporterOf(db, alice)).not.toBeNull()
  })

  it('re-syncs on refunds, disputes and fraud warnings', async () => {
    stripe.subs.set('cus_1', stripeSub())
    await checkout()
    stripe.subs.set('cus_1', stripeSub({ status: 'canceled' }))
    await send('charge.refunded', { object: 'charge', id: 'ch_1', customer: 'cus_1' })
    expect(supporterOf(db, alice)).toBeNull()

    stripe.subs.set('cus_1', stripeSub())
    await send('charge.dispute.created', { object: 'dispute', charge: 'ch_1', customer: 'cus_1' })
    expect(supporterOf(db, alice)).not.toBeNull()

    stripe.subs.set('cus_1', stripeSub({ status: 'canceled' }))
    stripe.charges.set('ch_2', { id: 'ch_2', customer: 'cus_1' })
    await send('radar.early_fraud_warning.created', { object: 'radar.early_fraud_warning', charge: 'ch_2' })
    expect(supporterOf(db, alice)).toBeNull()
  })

  it('ignores customers it does not know', async () => {
    stripe.subs.set('cus_x', stripeSub({ customer: 'cus_x' }))
    expect((await send('customer.subscription.updated', { ...stripeSub({ customer: 'cus_x' }) })).status).toBe(200)
    expect(db.prepare('SELECT count(*) AS n FROM supporters').get()).toEqual({ n: 0 })
  })

  it('ignores a checkout naming an account that does not exist', async () => {
    stripe.subs.set('cus_1', stripeSub())
    const res = await send('checkout.session.completed', {
      client_reference_id: '99999',
      customer: 'cus_1',
      subscription: 'sub_1'
    })
    expect(res.status).toBe(200)
    expect(db.prepare('SELECT count(*) AS n FROM supporters').get()).toEqual({ n: 0 })
  })

  it('answers 200 to other event types without calling Stripe', async () => {
    expect((await send('product.created', { object: 'product' })).status).toBe(200)
    expect(stripe.calls).toHaveLength(0)
  })

  it('leaves the row alone when Stripe has no subscription for the customer', async () => {
    stripe.subs.set('cus_1', stripeSub())
    await checkout()
    stripe.subs.delete('cus_1')
    await send('customer.subscription.deleted', { ...stripeSub() })
    expect(supporterOf(db, alice)).not.toBeNull()
  })

  it('meters webhook requests under their own area', () => {
    expect(areaOf('/stripe/webhook')).toBe('stripe/webhook')
  })
})
