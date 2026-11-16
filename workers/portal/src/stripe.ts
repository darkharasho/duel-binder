import type { AppDeps } from './app'
import { sameString } from './auth'
import { writeSubscription, type StripeSubscription } from './supporters'

/** Every Stripe call pins this version (the latest when written); responses are read to its shapes. */
export const STRIPE_VERSION = '2026-10-28.endive'
/** How old a webhook's signed timestamp may be. */
const TOLERANCE_S = 300

export class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * One Stripe REST call with the restricted key, form-encoded. Throws StripeError on anything but
 * 2xx; the message is Stripe's error text, never the key or the request.
 */
export async function stripeCall<T>(
  deps: AppDeps,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  form?: Record<string, string>
): Promise<T> {
  const key = deps.env.STRIPE_SECRET_KEY
  if (!key) throw new StripeError(503, 'Stripe is not set up')
  const body = form ? new URLSearchParams(form).toString() : undefined
  const res = await deps.fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'stripe-version': STRIPE_VERSION,
      ...(body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
    },
    body
  })
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok)
    throw new StripeError(res.status, data?.error?.message ?? `Stripe answered ${res.status}`)
  return data as T
}

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Checks a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`) against the raw body. */
export async function verifyStripeSignature(
  secret: string,
  header: string | null,
  body: string,
  now: Date
): Promise<boolean> {
  if (!header) return false
  let t: string | null = null
  const sigs: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't') t = v
    else if (k === 'v1') sigs.push(v)
  }
  if (t === null || !/^\d+$/.test(t) || sigs.length === 0) return false
  if (Math.abs(now.getTime() / 1000 - Number(t)) > TOLERANCE_S) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const expected = toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))
  )
  return sigs.some((s) => sameString(s, expected))
}

/** Events that may change a customer's subscription; each re-reads it from Stripe. */
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'radar.early_fraud_warning.created'
])

const idOf = (v: unknown): string | null =>
  typeof v === 'string'
    ? v
    : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'
      ? (v as { id: string }).id
      : null

const ok = (): Response =>
  new Response(JSON.stringify({ received: true }), {
    headers: { 'content-type': 'application/json' }
  })

/**
 * POST /stripe/webhook. Verifies the signature, resolves the event to its Stripe customer, and
 * writes that customer's newest subscription as Stripe has it now; so replayed and out-of-order
 * events land on the same state. Unknown customers and other events are acknowledged and skipped.
 * A Stripe failure answers 500, so Stripe retries the event later.
 */
export async function stripeWebhookRoute(req: Request, deps: AppDeps): Promise<Response> {
  const secret = deps.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const body = await req.text()
  if (!(await verifyStripeSignature(secret, req.headers.get('stripe-signature'), body, deps.now())))
    return new Response(JSON.stringify({ error: 'bad-signature' }), { status: 400 })
  let event: { type?: unknown; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response(JSON.stringify({ error: 'bad-body' }), { status: 400 })
  }
  const type = typeof event.type === 'string' ? event.type : ''
  const object = event.data?.object ?? {}
  if (!HANDLED.has(type)) return ok()

  try {
    let customer = idOf(object.customer)
    if (!customer && type === 'radar.early_fraud_warning.created') {
      const charge = idOf(object.charge)
      if (charge)
        customer = idOf(
          (
            await stripeCall<{ customer?: unknown }>(
              deps,
              'GET',
              `/v1/charges/${encodeURIComponent(charge)}`
            )
          ).customer
        )
    }
    if (!customer) return ok()
    let userId = (
      deps.db
        .prepare('SELECT user_id FROM supporters WHERE stripe_customer_id = ?')
        .get(customer) as { user_id: number } | undefined
    )?.user_id
    if (userId === undefined && type === 'checkout.session.completed') {
      const ref = Number(object.client_reference_id)
      if (Number.isInteger(ref) && deps.db.prepare('SELECT 1 FROM users WHERE id = ?').get(ref))
        userId = ref
    }
    if (userId === undefined) return ok()
    const list = await stripeCall<{ data: StripeSubscription[] }>(
      deps,
      'GET',
      `/v1/subscriptions?${new URLSearchParams({ customer, status: 'all', limit: '1' })}`
    )
    const sub = list.data[0]
    if (sub) writeSubscription(deps.db, userId, sub, deps.now())
    return ok()
  } catch (e) {
    console.error('stripe webhook failed', type, e instanceof Error ? e.message : e)
    return new Response(JSON.stringify({ error: 'retry' }), { status: 500 })
  }
}
