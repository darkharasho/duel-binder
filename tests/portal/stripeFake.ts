import type { StripeSubscription } from '../../workers/portal/src/supporters'

export interface StripeCall {
  method: string
  path: string
  query: URLSearchParams
  form: URLSearchParams
  headers: Headers
}

/**
 * An in-memory Stripe: customers, sessions, subscriptions by customer, charges. `subs` and
 * `charges` are set by the test; `calls` records every request; `fail` makes a path answer 500.
 */
export function fakeStripe() {
  const calls: StripeCall[] = []
  const subs = new Map<string, StripeSubscription>()
  const charges = new Map<string, { id: string; customer: string }>()
  const fail = new Set<string>()
  /** Older subscriptions of a customer, listed after the newest (`subs`). */
  const older = new Map<string, StripeSubscription[]>()
  let customers = 0
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    calls.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      form,
      headers: new Headers(init?.headers)
    })
    if (url.hostname !== 'api.stripe.com') return json({ error: 'not stripe' }, 404)
    if (fail.has(url.pathname)) return json({ error: { message: 'boom' } }, 500)
    const p = url.pathname
    if (method === 'POST' && p === '/v1/customers') return json({ id: `cus_${++customers}` })
    if (method === 'POST' && p === '/v1/checkout/sessions')
      return json({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
    if (method === 'POST' && p === '/v1/billing_portal/sessions')
      return json({ id: 'bps_1', url: 'https://billing.stripe.test/bps_1' })
    if (method === 'GET' && p === '/v1/subscriptions') {
      const customer = url.searchParams.get('customer') ?? ''
      const status = url.searchParams.get('status') ?? 'active'
      const limit = Number(url.searchParams.get('limit') ?? '10')
      const s = subs.get(customer)
      const all = [...(s ? [s] : []), ...(older.get(customer) ?? [])]
      const data = all.filter((x) => status === 'all' || x.status === status).slice(0, limit)
      return json({ object: 'list', data })
    }
    const customerId = /^\/v1\/customers\/([^/]+)$/.exec(p)?.[1]
    if (method === 'DELETE' && customerId) {
      for (const x of [subs.get(customerId), ...(older.get(customerId) ?? [])])
        if (x) x.status = 'canceled'
      return json({ id: customerId, deleted: true })
    }
    const subId = /^\/v1\/subscriptions\/([^/]+)$/.exec(p)?.[1]
    if (method === 'DELETE' && subId) {
      for (const s of subs.values()) if (s.id === subId) s.status = 'canceled'
      return json({ id: subId, status: 'canceled' })
    }
    const chargeId = /^\/v1\/charges\/([^/]+)$/.exec(p)?.[1]
    if (method === 'GET' && chargeId) {
      const c = charges.get(chargeId)
      return c ? json(c) : json({ error: { message: 'No such charge' } }, 404)
    }
    return json({ error: { message: `unhandled ${method} ${p}` } }, 404)
  }) as typeof globalThis.fetch
  return { fetch, calls, subs, older, charges, fail }
}

const END = Date.parse('2027-11-16T00:00:00.000Z') / 1000

/** A subscription as Stripe returns it; year at $25 unless told otherwise. */
export function stripeSub(
  over: Partial<StripeSubscription> & { interval?: 'month' | 'year'; amount?: number } = {}
): StripeSubscription {
  const { interval = 'year', amount = 2500, ...rest } = over
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    items: {
      data: [{ current_period_end: END, price: { unit_amount: amount, recurring: { interval } } }]
    },
    ...rest
  }
}
