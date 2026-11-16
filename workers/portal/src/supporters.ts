import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  isSupporterPlan,
  type SupporterPlan,
  type SupporterStatus
} from '../../../src/shared/supporter'
import type { AdminSupporters } from '../../../src/shared/admin'
import type { AppDeps } from './app'
import { takeLimit } from './authLimits'
import { isAdmin } from './auth'
import { listSubscriptions, stripeCall } from './stripe'

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
/** The one SQL test for "supporting", matching `supporterOf`: a live status and a since date. */
const supportingSql = (t = ''): string =>
  `${t}status IN ('active', 'trialing', 'past_due') AND ${t}since IS NOT NULL`

export const isActiveStatus = (status: string): boolean => ACTIVE.includes(status)

/** The subscription to track: a live one if any (newest first), else the newest. */
export const pickSubscription = (subs: StripeSubscription[]): StripeSubscription | undefined =>
  subs.find((s) => isActiveStatus(s.status)) ?? subs[0]

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
      `SELECT user_id FROM supporters WHERE ${supportingSql()}
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
        WHERE ${supportingSql('s.')} AND s.show_on_site = 1 AND u.closed_at IS NULL
        ORDER BY s.since, s.user_id`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

const ALREADY = 'You already support Duel Binder. Use Manage to change your plan.'
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
    if (e instanceof CollectionError) throw e
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
  if (supporterOf(deps.db, userId)) throw new CollectionError(ALREADY)
  // Each press makes a Stripe session (and maybe a customer); a person needs only a few.
  if (!takeLimit(deps.db, 'checkout-user', String(userId), deps.now()))
    throw new CollectionError('Too many checkout tries. Wait a little and try again.')
  const base = deps.env.PUBLIC_URL
  return viaStripe(async () => {
    let customer = customerOf(deps.db, userId)
    if (customer) {
      // A payment whose webhook hasn't landed yet must not lead to a second subscription.
      const live = (await listSubscriptions(deps, customer)).find((s) => isActiveStatus(s.status))
      if (live) {
        writeSubscription(deps.db, userId, live, deps.now())
        throw new CollectionError(ALREADY)
      }
    }
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
      const kept = customerOf(deps.db, userId) ?? customer
      // Another press saved its customer first: use that one and remove ours.
      if (kept !== customer) await deleteCustomer(deps, customer)
      customer = kept
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

/**
 * Deletes these accounts' Stripe customers (account delete): that cancels every subscription they
 * have at once and makes any open Checkout unusable, so nothing goes on billing an account that's
 * gone. A failure is logged and left: the account is deleted either way, and the owner can delete
 * the customer in the Stripe Dashboard.
 */
export async function deleteCustomers(deps: AppDeps, userIds: number[]): Promise<void> {
  for (const userId of userIds) {
    const customer = customerOf(deps.db, userId)
    if (customer) await deleteCustomer(deps, customer)
  }
}

/** Deletes a Stripe customer (ending its subscriptions); a failure is logged, not thrown. */
async function deleteCustomer(deps: AppDeps, customer: string): Promise<void> {
  try {
    await stripeCall(deps, 'DELETE', `/v1/customers/${encodeURIComponent(customer)}`)
  } catch (e) {
    console.error('stripe customer delete failed', customer, e instanceof Error ? e.message : e)
  }
}

/**
 * Account merge: the closed account's subscription follows its owner to the survivor, unless the
 * survivor's own is live; then the closed account keeps it (listed in the admin Supporters tab).
 * Call inside the merge's transaction.
 */
export function mergeSupporter(db: SqlDb, survivor: number, closed: number): void {
  const status = (id: number): string | undefined =>
    (
      db.prepare('SELECT status FROM supporters WHERE user_id = ?').get(id) as
        { status: string } | undefined
    )?.status
  const theirs = status(closed)
  if (theirs === undefined) return
  const mine = status(survivor)
  if (mine !== undefined) {
    if (isActiveStatus(mine) || !isActiveStatus(theirs)) return
    db.prepare('DELETE FROM supporters WHERE user_id = ?').run(survivor)
  }
  db.prepare('UPDATE supporters SET user_id = ? WHERE user_id = ?').run(survivor, closed)
}

const noStore = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

/** GET /admin/supporters; admins only, otherwise 404. */
export async function adminSupportersRoute(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'GET' || !(await isAdmin(req, deps)))
    return noStore({ error: 'Not found' }, 404)
  const rows = deps.db
    .prepare(
      `SELECT s.user_id, u.username, u.display_name, s.plan, s.status, s.since,
              s.current_period_end, s.cancel_at_period_end, s.show_on_site, s.amount_cents
         FROM supporters s JOIN users u ON u.id = s.user_id
        ORDER BY s.since IS NULL, s.since DESC, s.user_id`
    )
    .all() as {
    user_id: number
    username: string
    display_name: string | null
    plan: string | null
    status: string
    since: string | null
    current_period_end: string | null
    cancel_at_period_end: number
    show_on_site: number
    amount_cents: number | null
  }[]
  const out: AdminSupporters = { active: 0, monthly: 0, yearly: 0, monthlyCents: 0, list: [] }
  for (const r of rows) {
    const plan = isSupporterPlan(r.plan) ? r.plan : null
    if (isActiveStatus(r.status)) {
      out.active++
      if (plan === 'month') out.monthly++
      if (plan === 'year') out.yearly++
      const cents = r.amount_cents ?? 0
      out.monthlyCents += plan === 'year' ? Math.round(cents / 12) : cents
    }
    out.list.push({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name || null,
      plan,
      amountCents: r.amount_cents,
      status: r.status,
      since: r.since,
      until: r.current_period_end,
      cancelling: r.cancel_at_period_end === 1,
      showOnSite: r.show_on_site === 1
    })
  }
  return noStore(out)
}

/** GET /api/supporters/names: the site's thanks list; public, cached five minutes. */
export function supporterNamesRoute(deps: AppDeps): Response {
  return new Response(JSON.stringify({ names: thanksNames(deps.db) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }
  })
}
