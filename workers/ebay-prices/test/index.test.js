import worker, { resetTokenCache } from '../src/index.js'

const APP = 'test-app-id-SECRET'
const CERT = 'test-cert-id-SECRET'
const TOKEN = 'test-token-SECRET'

function makeKv() {
  const store = new Map()
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    put: vi.fn(async (k, v, opts) => {
      store.set(k, v)
      store.opts = opts
    })
  }
}

// Drives fake timers until the request settles (the SHA-256 digest resolves off-microtask).
async function settle(p) {
  let done = false
  p.then(
    () => (done = true),
    () => (done = true)
  )
  for (let i = 0; i < 200 && !done; i++) {
    await vi.advanceTimersByTimeAsync(1000)
    await new Promise((r) => setImmediate(r))
  }
  return p
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function items(titles, value = '10.00') {
  return {
    itemSummaries: titles.map((title, i) => ({
      title,
      price: { value: String(Number(value) + i), currency: 'USD' }
    }))
  }
}

function makeFetch(searchResponses) {
  const calls = []
  const queue = [...searchResponses]
  const fn = vi.fn(async (url) => {
    calls.push(String(url))
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return json({ access_token: TOKEN, expires_in: 7200 })
    }
    return queue.shift() ?? json(items([]))
  })
  fn.calls = calls
  return fn
}

const URL_OK =
  'https://w.test/v1/price?code=LOB-DE001&name=Blue-Eyes%20White%20Dragon&set=Legend&rarity=Ultra%20Rare&lang=de'
const req = (url = URL_OK, headers = { 'X-Client': 'duel-binder' }, method = 'GET') =>
  new Request(url, { method, headers })

let env
let errSpy
let logSpy

beforeEach(() => {
  resetTokenCache()
  env = { PRICES: makeKv(), EBAY_APP_ID: APP, EBAY_CERT_ID: CERT }
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const m of ['warn', 'info', 'debug']) vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET /v1/price', () => {
  it('returns the contract shape', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch([json(items(['LOB-DE001 Blue-Eyes', 'lob-de001 holo', 'LOB-DE001 x'], '10'))])
    )
    const res = await worker.fetch(req(), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toEqual({
      price: 11,
      listingCount: 3,
      rarityFallback: false,
      currency: 'USD',
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    })
    expect(env.PRICES.store.opts).toEqual({ expirationTtl: 604800 })
  })

  it('sends the OAuth and Browse requests as specified', async () => {
    const f = makeFetch([json(items(['LOB-DE001 a', 'LOB-DE001 b']))])
    vi.stubGlobal('fetch', f)
    await worker.fetch(req(), env)
    expect(f.calls[0]).toBe('https://api.ebay.com/identity/v1/oauth2/token')
    expect(f.calls[1]).toContain('https://api.ebay.com/buy/browse/v1/item_summary/search?')
    expect(f.calls[1]).toContain('category_ids=31395')
    expect(f.calls[1]).toContain('limit=50')
    const [, init] = f.mock.calls[0]
    expect(init.headers.Authorization).toBe(`Basic ${btoa(`${APP}:${CERT}`)}`)
    expect(init.body).toBe(
      'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    )
    expect(f.mock.calls[1][1].headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US')
  })

  it('accepts the X-Client header sent by app versions before the rename', async () => {
    vi.stubGlobal('fetch', makeFetch([json(items(['LOB-DE001 a', 'LOB-DE001 b']))]))
    const res = await worker.fetch(req(URL_OK, { 'X-Client': 'ygo-collection-tracker' }), env)
    expect(res.status).toBe(200)
  })

  it('rejects a missing or wrong X-Client header', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    for (const headers of [{}, { 'X-Client': 'nope' }]) {
      const res = await worker.fetch(req(URL_OK, headers), env)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad request' })
    }
  })

  it('rejects bad params', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    for (const q of [
      'code=A-1&name=&set=s&rarity=r&lang=de',
      'code=A-1&name=x&set=s&rarity=r&lang=xx'
    ]) {
      const res = await worker.fetch(req(`https://w.test/v1/price?${q}`), env)
      expect(res.status).toBe(400)
    }
  })

  it('rejects non-GET with 405', async () => {
    const res = await worker.fetch(req(URL_OK, { 'X-Client': 'duel-binder' }, 'POST'), env)
    expect(res.status).toBe(405)
  })

  it('serves the second identical request from KV without calling eBay', async () => {
    const f = makeFetch([json(items(['LOB-DE001 a', 'LOB-DE001 b']))])
    vi.stubGlobal('fetch', f)
    const first = await (await worker.fetch(req(), env)).json()
    f.mockClear()
    const second = await (await worker.fetch(req(), env)).json()
    expect(f).not.toHaveBeenCalled()
    expect(second).toEqual(first)
  })

  it('caches a fallback result under the original request', async () => {
    const f = makeFetch([
      json(items(['LOB-DE001 only one'])),
      json(items(['LOB-DE001 a', 'LOB-DE001 b', 'LOB-DE001 c']))
    ])
    vi.stubGlobal('fetch', f)
    await worker.fetch(req(), env)
    f.mockClear()
    await worker.fetch(req(), env)
    expect(f).not.toHaveBeenCalled()
  })

  it('searches again without rarity when fewer than 2 listings match', async () => {
    const f = makeFetch([
      json(items(['LOB-DE001 only one', 'unrelated card'])),
      json(items(['LOB-DE001 a', 'LOB-DE001 b', 'LOB-DE001 c']))
    ])
    vi.stubGlobal('fetch', f)
    const body = await (await worker.fetch(req(), env)).json()
    const searches = f.calls.filter((u) => u.includes('item_summary'))
    expect(searches).toHaveLength(2)
    expect(decodeURIComponent(searches[0].replaceAll('+', ' '))).toContain('Ultra Rare')
    expect(decodeURIComponent(searches[1].replaceAll('+', ' '))).not.toContain('Ultra Rare')
    expect(body.listingCount).toBe(3)
    expect(body.rarityFallback).toBe(true)
  })

  it('drops other rarities, slabs and lots from the fallback search', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch([
        json(items([])),
        json({
          itemSummaries: [
            ['LOB-DE001 a', '10'],
            ['LOB-DE001 b', '12'],
            ['LOB-DE001 Secret Rare', '400'],
            ['PSA 10 LOB-DE001', '900'],
            ['Lot of 3 LOB-DE001', '30']
          ].map(([title, value]) => ({ title, price: { value, currency: 'USD' } }))
        })
      ])
    )
    const body = await (await worker.fetch(req(), env)).json()
    expect(body).toMatchObject({ price: 11, listingCount: 2, rarityFallback: true })
  })

  it('prices a Secret Rare from Secret Rare listings, not pricier Secret variants', async () => {
    const mk = (title, value) => ({ title, price: { value, currency: 'USD' } })
    vi.stubGlobal(
      'fetch',
      makeFetch([
        json({
          itemSummaries: [
            mk('LOB-DE001 Secret Rare', '3'),
            mk('LOB-DE001 Secret Rare NM', '3'),
            mk('LOB-DE001 Quarter Century Secret Rare', '30'),
            mk('LOB-DE001 Quarter Century Secret Rare NM', '30'),
            mk('LOB-DE001 Extra Secret Rare', '30')
          ]
        })
      ])
    )
    const res = await worker.fetch(
      req(URL_OK.replace('Ultra%20Rare', 'Secret%20Rare'), undefined),
      env
    )
    expect(await res.json()).toMatchObject({ price: 3, listingCount: 2, rarityFallback: false })
  })

  it('returns 502 when OAuth fails and leaks no secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'invalid_client', echo: `${APP}${CERT}` }, 401))
    )
    const res = await worker.fetch(req(), env)
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(JSON.parse(text)).toEqual({ error: 'upstream' })
    const logged = JSON.stringify([...errSpy.mock.calls, ...logSpy.mock.calls])
    for (const s of [APP, CERT, TOKEN, btoa(`${APP}:${CERT}`)]) {
      expect(text).not.toContain(s)
      expect(logged).not.toContain(s)
    }
  })

  it('retries a 503 from Browse and then succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const f = makeFetch([json({}, 503), json(items(['LOB-DE001 a', 'LOB-DE001 b']))])
    vi.stubGlobal('fetch', f)
    const p = worker.fetch(req(), env)
    const res = await settle(p)
    expect(res.status).toBe(200)
    expect(f.calls.filter((u) => u.includes('item_summary'))).toHaveLength(2)
  })

  it('treats a KV get error as a cache miss', async () => {
    vi.stubGlobal('fetch', makeFetch([json(items(['LOB-DE001 a', 'LOB-DE001 b']))]))
    env.PRICES.get = vi.fn(async () => {
      throw new Error('kv down')
    })
    const res = await worker.fetch(req(), env)
    expect(res.status).toBe(200)
    expect((await res.json()).listingCount).toBe(2)
  })

  it('still returns 200 when a KV put rejects or throws', async () => {
    for (const put of [
      vi.fn(async () => {
        throw new Error('kv down')
      }),
      vi.fn(() => {
        throw new Error('kv down')
      })
    ]) {
      vi.stubGlobal('fetch', makeFetch([json(items(['LOB-DE001 a', 'LOB-DE001 b']))]))
      env.PRICES.put = put
      expect((await worker.fetch(req(), env)).status).toBe(200)
    }
  })

  it('uses ctx.waitUntil for the put when available', async () => {
    vi.stubGlobal('fetch', makeFetch([json(items(['LOB-DE001 a', 'LOB-DE001 b']))]))
    env.PRICES.put = vi.fn(async () => {
      throw new Error('kv down')
    })
    const ctx = { waitUntil: vi.fn() }
    expect((await worker.fetch(req(), env, ctx)).status).toBe(200)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    await expect(ctx.waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
  })

  it('rejects over-long fields with 400', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    const long = 'a'.repeat(201)
    const res = await worker.fetch(
      req(`https://w.test/v1/price?code=&name=${long}&set=s&rarity=r&lang=de`),
      env
    )
    expect(res.status).toBe(400)
  })

  it('normalizes code case for the language word and the cache key', async () => {
    const f = makeFetch([json(items(['LB-05 a', 'LB-05 b']))])
    vi.stubGlobal('fetch', f)
    const u = (c) =>
      `https://w.test/v1/price?code=${c}&name=Dark%20Magician&set=Vol.1&rarity=&lang=ja`
    await worker.fetch(req(u('lb-05')), env)
    expect(decodeURIComponent(f.calls[1]).replaceAll('+', ' ')).toContain('"LB-05" Japanese')
    f.mockClear()
    await worker.fetch(req(u('LB-05')), env)
    expect(f).not.toHaveBeenCalled()
  })

  it('keeps the rarity result when the fallback finds fewer listings', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch([json(items(['LOB-DE001 only one'], '20')), json(items(['unrelated']))])
    )
    const body = await (await worker.fetch(req(), env)).json()
    expect(body).toMatchObject({ price: null, listingCount: 1 })
  })

  it.each([
    ['500', () => json({}, 500)],
    ['throw', () => Promise.reject(new Error(`boom ${TOKEN} ${APP}`))]
  ])('leaks nothing when OAuth succeeds but Browse fails (%s)', async (_n, fail) => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('oauth2/token')
          ? json({ access_token: TOKEN, expires_in: 7200 })
          : fail()
      )
    )
    const p = worker.fetch(req(), env)
    const res = await settle(p)
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(JSON.parse(text)).toEqual({ error: 'upstream' })
    const logged = JSON.stringify(
      ['error', 'log', 'warn', 'info', 'debug'].map((m) => console[m].mock?.calls)
    )
    for (const s of [APP, CERT, TOKEN, btoa(`${APP}:${CERT}`)]) {
      expect(text).not.toContain(s)
      expect(logged).not.toContain(s)
    }
  })

  it('keeps the KV key short for long multi-byte input and still hits the cache', async () => {
    const f = makeFetch([json(items(['x', 'x']))])
    vi.stubGlobal('fetch', f)
    const field = encodeURIComponent('龍'.repeat(200))
    const u = `https://w.test/v1/price?code=${field}&name=${field}&set=${field}&rarity=${field}&lang=ja`
    expect((await worker.fetch(req(u), env)).status).toBe(200)
    const keys = [...env.PRICES.store.keys()]
    expect(keys).toHaveLength(1)
    expect(new TextEncoder().encode(keys[0]).length).toBeLessThanOrEqual(512)
    f.mockClear()
    expect((await worker.fetch(req(u), env)).status).toBe(200)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('GET /v1/set', () => {
  const SET_URL = 'https://w.test/v1/set?key=CORI-JP&lang=ja'
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }))
  const page = (n) => ({
    itemSummaries: Array.from({ length: n }, (_, i) => ({
      title: `CORI-JP${String((i % 5) + 1).padStart(3, '0')} UR`,
      price: { value: String(10 + i), currency: 'USD' }
    }))
  })

  it('pages until a short page', async () => {
    const f = makeFetch([json(page(200)), json(page(37))])
    vi.stubGlobal('fetch', f)
    const res = await settle(worker.fetch(req(SET_URL), env))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.calls).toBe(2)
    expect(body.codes['CORI-JP001']).toBeDefined()
    expect(body.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const searches = f.calls.filter((c) => c.includes('item_summary'))
    expect(searches).toHaveLength(2)
    expect(searches[0]).toContain('limit=200')
    expect(searches[1]).toContain('offset=200')
    expect(env.PRICES.put).not.toHaveBeenCalled()
  })

  it('sends the key unquoted and without rarity', async () => {
    const f = makeFetch([json(page(1))])
    vi.stubGlobal('fetch', f)
    await settle(worker.fetch(req(SET_URL), env))
    const q = new URL(f.calls.find((c) => c.includes('item_summary'))).searchParams.get('q')
    expect(q).toBe('CORI-JP')
  })

  it('stops at five pages', async () => {
    const f = makeFetch(Array.from({ length: 6 }, () => json(page(200))))
    vi.stubGlobal('fetch', f)
    const body = await (await settle(worker.fetch(req(SET_URL), env))).json()
    expect(body.calls).toBe(5)
  })

  it('rejects English', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    const res = await worker.fetch(req('https://w.test/v1/set?key=LOB-EN&lang=en'), env)
    expect(res.status).toBe(400)
  })

  it('rejects a missing X-Client header', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    expect((await worker.fetch(req(SET_URL, {}), env)).status).toBe(400)
  })

  it('passes through 429', async () => {
    vi.stubGlobal('fetch', makeFetch([json({}, 429), json({}, 429), json({}, 429)]))
    const res = await settle(worker.fetch(req(SET_URL), env))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate limited' })
  })
})

describe('GET /v1/quota', () => {
  const QUOTA = 'https://w.test/v1/quota'
  const analytics = {
    rateLimits: [
      {
        apiContext: 'buy',
        apiName: 'browse',
        resources: [
          {
            name: 'buy.browse',
            rates: [{ remaining: 4321, reset: '2026-10-29T00:00:00.000Z' }]
          }
        ]
      }
    ]
  }

  it('reads browse remaining', async () => {
    const f = makeFetch([json(analytics)])
    vi.stubGlobal('fetch', f)
    const res = await worker.fetch(req(QUOTA), env)
    expect(await res.json()).toEqual({ remaining: 4321, resetAt: '2026-10-29T00:00:00.000Z' })
    expect(f.calls[1]).toBe(
      'https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=browse'
    )
  })

  it('is null on failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubGlobal('fetch', makeFetch([json({}, 500)]))
    const res = await settle(worker.fetch(req(QUOTA), env))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ remaining: null, resetAt: null })
  })
})
