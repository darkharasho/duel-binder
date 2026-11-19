import worker, { resetTokenCache } from '../src/index.js'
import { buildGradedQuery, gradedTitleMatches } from '../src/price.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const listing = (title, value) => ({ title, price: { value: String(value), currency: 'USD' } })

function makeFetch(searchResponses) {
  const calls = []
  const queue = [...searchResponses]
  const fn = vi.fn(async (url) => {
    calls.push(String(url))
    if (String(url).includes('/identity/v1/oauth2/token'))
      return json({ access_token: 'tok', expires_in: 7200 })
    return queue.shift() ?? json({ itemSummaries: [] })
  })
  fn.calls = calls
  return fn
}

function makeKv() {
  const store = new Map()
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    put: vi.fn(async (k, v) => void store.set(k, v))
  }
}

const pkm = { name: 'Dragonite', number: '5', lang: 'en', company: 'PSA', grade: '7' }

describe('gradedTitleMatches', () => {
  it('takes the asked grade only, never a neighbour', () => {
    const ok = (t, p = pkm) => gradedTitleMatches(t, p)
    expect(ok('2012 Pokemon Dragon Vault Dragonite Holo #5 PSA 7 NM')).toBe(true)
    expect(ok('Dragonite 5/20 Dragon Vault PSA 7')).toBe(true)
    expect(ok('Dragonite 5/20 Dragon Vault PSA 8')).toBe(false)
    expect(ok('Dragonite 5/20 PSA 7.5')).toBe(false)
    expect(ok('Dragonite 15/20 PSA 7')).toBe(false)
    expect(ok('Dragonite 5/20 PSA 7 Japanese')).toBe(false)
    expect(ok('Dragonite 5/20 PSA 7 lot of 3')).toBe(false)
    expect(ok('Charizard 5/20 PSA 7')).toBe(false)
    const ten = { ...pkm, grade: '10' }
    expect(ok('Dragonite #5 PSA GEM MINT 10', ten)).toBe(true)
    expect(ok('Dragonite #5 PSA 1', ten)).toBe(false)
    expect(ok('Dragonite #5 PSA 10', { ...pkm, grade: '1' })).toBe(false)
    expect(ok('Dragonite #5 PSA 9.5', { ...pkm, grade: '9' })).toBe(false)
    expect(ok('Dragonite #5 Beckett 9.5', { ...pkm, company: 'BGS', grade: '9.5' })).toBe(true)
    expect(ok('Dragonite #5 PSA Authentic', { ...pkm, grade: 'Authentic' })).toBe(true)
    expect(ok('Dragonite #5 CGC 7', pkm)).toBe(false)
  })

  it('matches a Yu-Gi-Oh! slab by its code', () => {
    const p = { code: 'LOB-EN001', name: 'Blue-Eyes', lang: 'en', company: 'PSA', grade: '9' }
    expect(gradedTitleMatches('Blue-Eyes White Dragon LOB-EN001 1st PSA 9 Mint', p)).toBe(true)
    expect(gradedTitleMatches('Blue-Eyes White Dragon LOB-001 PSA 9', p)).toBe(false)
  })

  it('needs a Japanese listing for a Japanese card', () => {
    const p = { ...pkm, lang: 'ja' }
    expect(gradedTitleMatches('Dragonite 005 PSA 7 Japanese', p)).toBe(true)
    expect(gradedTitleMatches('Dragonite 005 PSA 7', p)).toBe(false)
  })
})

describe('editions', () => {
  it('keeps a 1st Edition slab apart from an Unlimited one', () => {
    const t1 = 'Dragonite 4/62 Fossil 1st Edition Holo PSA 7'
    const tu = 'Dragonite 4/62 Fossil Holo PSA 7'
    expect(gradedTitleMatches(t1, { ...pkm, number: '4', edition: '1st' })).toBe(true)
    expect(gradedTitleMatches(tu, { ...pkm, number: '4', edition: '1st' })).toBe(false)
    expect(gradedTitleMatches(t1, { ...pkm, number: '4', edition: 'unlimited' })).toBe(false)
    expect(gradedTitleMatches(tu, { ...pkm, number: '4', edition: 'unlimited' })).toBe(true)
    expect(buildGradedQuery({ ...pkm, number: '4', edition: '1st' })).toBe(
      '"Dragonite" 4 1st PSA 7'
    )
  })
})

describe('buildGradedQuery', () => {
  it('searches by code, or by name and number, with grader, grade and language', () => {
    expect(buildGradedQuery({ code: 'LOB-EN001', lang: 'en', company: 'PSA', grade: '10' })).toBe(
      '"LOB-EN001" PSA 10'
    )
    expect(buildGradedQuery({ ...pkm, lang: 'ja' })).toBe('"Dragonite" 5 PSA 7 Japanese')
  })
})

describe('GET /v1/graded-price', () => {
  let env
  beforeEach(() => {
    resetTokenCache()
    env = { PRICES: makeKv(), EBAY_APP_ID: 'a', EBAY_CERT_ID: 'c' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const url = (q) =>
    `https://w.test/v1/graded-price?${new URLSearchParams({ game: 'pkm', ...pkm, ...q })}`
  const req = (u, headers = { 'X-Client': 'duel-binder' }) => new Request(u, { headers })

  it('prices one grade from the Graded condition, and caches it', async () => {
    const f = makeFetch([
      json({
        itemSummaries: [
          listing('Dragonite #5 Dragon Vault PSA 7', 40),
          listing('Dragonite 5/20 PSA 7 NM', 50),
          listing('Dragonite 5/20 PSA 8', 90),
          listing('Dragonite 5/20 PSA 7', 1000)
        ]
      })
    ])
    vi.stubGlobal('fetch', f)
    const res = await worker.fetch(req(url()), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      price: 45,
      listingCount: 2,
      currency: 'USD',
      checkedAt: expect.any(String)
    })
    // 1000 is over three times the median, so it's dropped; the PSA 8 isn't this grade.
    const search = f.calls[1]
    expect(search).toContain('category_ids=183454')
    expect(decodeURIComponent(search)).toContain('filter=conditionIds:{2750}')
    expect(decodeURIComponent(search).replace(/\+/g, ' ')).toContain('q="Dragonite" 5 PSA 7')
    expect(env.PRICES.store.size).toBe(1)
    // The second ask is answered from KV.
    const again = await worker.fetch(req(url()), env)
    expect((await again.json()).price).toBe(45)
    expect(f.calls.filter((c) => c.includes('item_summary')).length).toBe(1)
  })

  it('refuses a bad grade, grader, game or client', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    for (const u of [url({ grade: '11' }), url({ company: 'XYZ' }), url({ game: 'nope' })])
      expect((await worker.fetch(req(u), env)).status).toBe(400)
    expect((await worker.fetch(req(url(), {}), env)).status).toBe(400)
  })
})
