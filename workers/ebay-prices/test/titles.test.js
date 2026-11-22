import worker, { resetTokenCache } from '../src/index.js'

const HARVEST = 'harvest-token-SECRET'
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// A PRICES binding that fails the test if the route touches it.
const throwingKv = new Proxy(
  {},
  {
    get: (_t, prop) => () => {
      throw new Error(`PRICES.${String(prop)} touched`)
    }
  }
)

function makeFetch(searchResponse) {
  const fn = vi.fn(async (url) => {
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return json({ access_token: 't', expires_in: 7200 })
    }
    return searchResponse
  })
  return fn
}

const req = (qs = 'q=blue-eyes&game=ygo', token = HARVEST) =>
  new Request(`https://w.test/v1/titles?${qs}`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` }
  })

let env
beforeEach(() => {
  resetTokenCache()
  env = { PRICES: throwingKv, EBAY_APP_ID: 'a', EBAY_CERT_ID: 'c', HARVEST_TOKEN: HARVEST }
  for (const m of ['error', 'warn', 'info', 'debug', 'log']) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET /v1/titles', () => {
  it('returns titles and sellers, one search at limit 200 in the game category', async () => {
    const f = makeFetch(
      json({
        itemSummaries: [
          { title: 'Blue-Eyes PSA 10', seller: { username: 'cardshop' } },
          { title: 'Blue-Eyes raw' }
        ]
      })
    )
    vi.stubGlobal('fetch', f)
    const res = await worker.fetch(req(), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      titles: [
        { title: 'Blue-Eyes PSA 10', seller: 'cardshop' },
        { title: 'Blue-Eyes raw', seller: '' }
      ]
    })
    const searches = f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('item_summary'))
    expect(searches).toHaveLength(1)
    expect(searches[0]).toContain('limit=200')
    expect(searches[0]).toContain('q=blue-eyes')
  })

  it('answers 404 on a wrong or missing token, or when no HARVEST_TOKEN is set', async () => {
    const f = makeFetch(json({ itemSummaries: [] }))
    vi.stubGlobal('fetch', f)
    expect((await worker.fetch(req(undefined, 'nope'), env)).status).toBe(404)
    expect((await worker.fetch(req(undefined, null), env)).status).toBe(404)
    expect((await worker.fetch(req(), { ...env, HARVEST_TOKEN: undefined })).status).toBe(404)
    expect((await worker.fetch(req(undefined, ''), { ...env, HARVEST_TOKEN: '' })).status).toBe(404)
    expect(f).not.toHaveBeenCalled()
  })

  it('answers 400 for a bad game or a bad query', async () => {
    vi.stubGlobal('fetch', makeFetch(json({ itemSummaries: [] })))
    expect((await worker.fetch(req('q=x&game=zzz'), env)).status).toBe(400)
    expect((await worker.fetch(req('q=&game=ygo'), env)).status).toBe(400)
    expect((await worker.fetch(req(`q=${'a'.repeat(201)}&game=ygo`), env)).status).toBe(400)
  })

  it('passes an eBay 429 through', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', makeFetch(json({}, 429)))
    const p = worker.fetch(req(), env)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1000)
    expect((await p).status).toBe(429)
    vi.useRealTimers()
  })
})
