import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  isSupporterPlan,
  type SupporterPlan,
  type SupporterStatus
} from '../../../src/shared/supporter'
import type { AppDeps } from './app'
import { stripeCall } from './stripe'

/**
 * Supporter subscriptions. Stripe owns the truth: the webhook (stripe.ts) re-reads a customer's
 * subscription and writes it here whole, so the row is always Stripe's latest state.
 */

/** The parts of a Stripe Subscription (API 2026-10-28.endive) this reads. */
export interface StripeSubscription {
  id: string
  customer: string
  status: string
  cancel_at_period_end: boolean
  items: {
    data: {
      current_period_end: number
      price: { unit_amount: number | null; recurring: { interval: string } | null }
    }[]
  }
}

/** Stripe statuses that count as supporting; past_due keeps the badge through payment retries. */
const ACTIVE = ['active', 'trialing', 'past_due']
const ACTIVE_SQL = `status IN ('active', 'trialing', 'past_due')`

export const isActiveStatus = (status: string): boolean => ACTIVE.includes(status)

/** Writes Stripe's state of the account's subscription; `since` is set the first time it is active. */
export function writeSubscription(
  db: SqlDb,
  userId: number,
  sub: StripeSubscription,
  now: Date
): void {
  const item = sub.items.data[0]
  const interval = item?.price.recurring?.interval
  const plan: SupporterPlan | null = interval === 'month' || interval === 'year' ? interval : null
  const until = item ? new Date(item.current_period_end * 1000).toISOString() : null
  const at = now.toISOString()
  const since = isActiveStatus(sub.status) ? at : null
  db.prepare(
    `INSERT INTO supporters (user_id, stripe_customer_id, stripe_subscription_id, plan, status,
       amount_cents, current_period_end, cancel_at_period_end, since, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id, plan = excluded.plan,
       status = excluded.status, amount_cents = excluded.amount_cents,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       since = COALESCE(supporters.since, excluded.since), updated_at = excluded.updated_at`
  ).run(
    userId,
    sub.customer,
    sub.id,
    plan,
    sub.status,
    item?.price.unit_amount ?? null,
    until,
    sub.cancel_at_period_end ? 1 : 0,
    since,
    at
  )
}

interface Row {
  plan: string | null
  status: string
  since: string | null
  current_period_end: string | null
  cancel_at_period_end: number
  show_on_site: number
}

/** The account's supporter details while it is supporting; null otherwise. */
export function supporterOf(db: SqlDb, userId: number): SupporterStatus['supporter'] {
  const r = db
    .prepare(
      `SELECT plan, status, since, current_period_end, cancel_at_period_end, show_on_site
         FROM supporters WHERE user_id = ?`
    )
    .get(userId) as Row | undefined
  if (!r || !isActiveStatus(r.status) || r.since === null) return null
  return {
    plan: r.plan === 'month' ? 'month' : 'year',
    since: r.since,
    until: r.current_period_end,
    cancelling: r.cancel_at_period_end === 1,
    showOnSite: r.show_on_site === 1
  }
}

/** Which of these accounts are supporting (one query). */
export function supporterIds(db: SqlDb, ids: number[]): Set<number> {
  if (ids.length === 0) return new Set()
  const rows = db
    .prepare(
      `SELECT user_id FROM supporters WHERE ${ACTIVE_SQL}
         AND user_id IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(ids)) as { user_id: number }[]
  return new Set(rows.map((r) => r.user_id))
}

export function setShowOnSite(db: SqlDb, userId: number, on: boolean): void {
  db.prepare('UPDATE supporters SET show_on_site = ? WHERE user_id = ?').run(on ? 1 : 0, userId)
}

/** The names supporters chose to show on the site's thanks list, longest supporting first. */
export function thanksNames(db: SqlDb): string[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(u.display_name, ''), u.username) AS name
         FROM supporters s JOIN users u ON u.id = s.user_id
        WHERE s.${ACTIVE_SQL} AND s.show_on_site = 1 AND u.closed_at IS NULL
        ORDER BY s.since, s.user_id`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

const CHECKOUT_ID = 'duelbinder-supporter-kqzmwhrt'

const customerOf = (db: SqlDb, userId: number): string | null =>
  (
    db.prepare('SELECT stripe_customer_id AS id FROM supporters WHERE user_id = ?').get(userId) as
      { id: string } | undefined
  )?.id ?? null

/** Runs a Stripe call, turning its failure into a message the app shows. */
async function viaStripe<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    console.error('stripe call failed', e instanceof Error ? e.message : e)
    throw new CollectionError("Couldn't reach the payment service. Try again.")
  }
}

/** `supporter:status` */
export function supporterStatus(deps: AppDeps, userId: number): SupporterStatus {
  return {
    enabled: deps.env.SUPPORTER_ENABLED === 'on',
    hasCustomer: customerOf(deps.db, userId) !== null,
    supporter: supporterOf(deps.db, userId)
  }
}

/** `supporter:checkout(plan)`: a Checkout Session for the account's Stripe customer (made once). */
export async function startCheckout(
  deps: AppDeps,
  userId: number,
  plan: unknown
): Promise<{ url: string }> {
  if (deps.env.SUPPORTER_ENABLED !== 'on')
    throw new CollectionError("Supporter subscriptions aren't open yet")
  if (!isSupporterPlan(plan)) throw new CollectionError('plan must be month or year')
  const price = plan === 'month' ? deps.env.STRIPE_PRICE_MONTH : deps.env.STRIPE_PRICE_YEAR
  if (!price) throw new CollectionError("Supporter subscriptions aren't open yet")
  if (supporterOf(deps.db, userId))
    throw new CollectionError('You already support Duel Binder. Use Manage to change your plan.')
  const base = deps.env.PUBLIC_URL
  return viaStripe(async () => {
    let customer = customerOf(deps.db, userId)
    if (!customer) {
      customer = (
        await stripeCall<{ id: string }>(deps, 'POST', '/v1/customers', {
          'metadata[user_id]': String(userId)
        })
      ).id
      // Kept straight away, so a second press reuses this customer.
      deps.db
        .prepare(
          `INSERT INTO supporters (user_id, stripe_customer_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO NOTHING`
        )
        .run(userId, customer, deps.now().toISOString())
      customer = customerOf(deps.db, userId) ?? customer
    }
    const session = await stripeCall<{ url: string }>(deps, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: String(userId),
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: `${base}/supporter/thanks`,
      cancel_url: `${base}/supporter/thanks?cancelled=1`,
      integration_identifier: CHECKOUT_ID
    })
    return { url: session.url }
  })
}

/** `supporter:manage`: a Customer Portal session; works whether or not checkout is open. */
export async function openManage(deps: AppDeps, userId: number): Promise<{ url: string }> {
  const customer = customerOf(deps.db, userId)
  if (!customer) throw new CollectionError('No subscription to manage')
  return viaStripe(async () => {
    const session = await stripeCall<{ url: string }>(deps, 'POST', '/v1/billing_portal/sessions', {
      customer,
      return_url: `${deps.env.PUBLIC_URL}/supporter/thanks?managed=1`
    })
    return { url: session.url }
  })
}

/** `supporter:setShowOnSite(on)` */
export function showOnSite(deps: AppDeps, userId: number, on: unknown): SupporterStatus {
  if (typeof on !== 'boolean') throw new CollectionError('on must be true or false')
  if (!supporterOf(deps.db, userId))
    throw new CollectionError('Only supporters are on the thanks list')
  setShowOnSite(deps.db, userId, on)
  return supporterStatus(deps, userId)
}
