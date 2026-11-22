import worker, { resetTokenCache } from '../src/index.js'
import { buildGradedQuery, gradedTitleMatches, numberForms } from '../src/price.js'

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
    expect(ok('Dragonite 5/20 AGS 7', { ...pkm, company: 'AGS' })).toBe(true)
    expect(ok('Dragonite 5/20 PSA 7', { ...pkm, company: 'AGS' })).toBe(false)
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

describe('set totals and reprints', () => {
  it('needs the set total when the number has one, and keeps reprint lines apart', () => {
    const base = { ...pkm, name: 'Charizard', number: '4/102', set: 'Base Set', grade: '9' }
    expect(gradedTitleMatches('Charizard 4/102 Base Set Holo PSA 9', base)).toBe(true)
    expect(gradedTitleMatches('Charizard #004/102 Holo PSA 9', base)).toBe(true)
    // Base Set 2's Charizard is a 4 too, of 130.
    expect(gradedTitleMatches('Charizard 4/130 Base Set 2 PSA 9', base)).toBe(false)
    expect(gradedTitleMatches('Charizard #4 Holo PSA 9', base)).toBe(false)
    // Celebrations' Classic Collection prints it as 4/102 again.
    expect(gradedTitleMatches('Charizard 4/102 Celebrations Classic Collection PSA 9', base)).toBe(
      false
    )
    const cc = { ...base, set: 'Celebrations: Classic Collection' }
    expect(gradedTitleMatches('Charizard 4/102 Celebrations Classic Collection PSA 9', cc)).toBe(
      true
    )
    // A Japanese number's zeros.
    expect(
      gradedTitleMatches('Palafin 021/081 Japanese PSA 9', {
        ...base,
        name: 'Palafin',
        number: '21/81',
        lang: 'ja'
      })
    ).toBe(true)
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
    const shadowless = 'Dragonite 4/62 Shadowless Holo PSA 7'
    expect(gradedTitleMatches(shadowless, { ...pkm, number: '4', edition: 'unlimited' })).toBe(
      false
    )
    expect(buildGradedQuery({ ...pkm, number: '4', edition: '1st' })).toBe(
      '"Dragonite" (4,004) 1st PSA 7'
    )
  })
})

describe('buildGradedQuery', () => {
  it('searches by code, or by name and number, with grader, grade and language', () => {
    expect(buildGradedQuery({ code: 'LOB-EN001', lang: 'en', company: 'PSA', grade: '10' })).toBe(
      '"LOB-EN001" PSA 10'
    )
    expect(buildGradedQuery({ ...pkm, lang: 'ja' })).toBe('"Dragonite" (5,005) PSA 7 Japanese')
  })
})

describe('how sellers write the number', () => {
  it('searches padded numbers, padded totals and gallery totals', () => {
    expect(numberForms('141/86')).toEqual(['141/86', '141/086'])
    expect(numberForms('271/217')).toEqual(['271/217'])
    expect(numberForms('GG49/70')).toEqual(['GG49/70', 'GG49/070', 'GG49/GG70'])
    expect(numberForms('44')).toEqual(['44', '044'])
    expect(numberForms('SM229')).toEqual(['SM229'])
    expect(numberForms('')).toEqual([])
    const q = { name: 'Klinklang', number: '141/86', lang: 'en', company: 'PSA', grade: '9' }
    expect(buildGradedQuery(q)).toBe('"Klinklang" (141/86,141/086) PSA 9')
    expect(buildGradedQuery({ ...q, name: 'Mega Dragonite ex', number: '271/217' })).toBe(
      '"Mega Dragonite ex" 271/217 PSA 9'
    )
  })

  it('matches padded and gallery totals, never a number after a slash', () => {
    const k = { name: 'Klinklang', number: '141/86', lang: 'en', company: 'PSA', grade: '9' }
    expect(gradedTitleMatches('PSA 9 Klinklang 141/086 Illustration Rare Black Bolt', k)).toBe(true)
    const d = { name: 'Drapion V', number: 'GG49/70', lang: 'en', company: 'PSA', grade: '9' }
    expect(gradedTitleMatches('Crown Zenith Drapion V GG49/GG70 PSA 9 Cert', d)).toBe(true)
    expect(gradedTitleMatches('Drapion V #GG49/GG70 PSA 9', d)).toBe(true)
    expect(gradedTitleMatches('Drapion V GG49/GG69 PSA 9', d)).toBe(false)
    const p = { name: 'Surfing Pikachu', number: '28', lang: 'en', company: 'CGC', grade: '8' }
    expect(gradedTitleMatches('CGC 8 Surfing Pikachu V 021/028 Double Rare', p)).toBe(false)
  })

  it("asks a promo's listing to say it's a promo", () => {
    const c = {
      name: 'Charmander',
      number: '44',
      set: 'SVP Black Star Promos',
      lang: 'en',
      company: 'PSA',
      grade: '9'
    }
    expect(
      gradedTitleMatches('2023 Pokemon SVP EN Charmander #044 Obsidian Flames ETB PSA 9', c)
    ).toBe(true)
    expect(gradedTitleMatches('PSA 9 Pokemon 2023 Charmander Black Star Promo #044', c)).toBe(true)
    expect(gradedTitleMatches('Charmander 044 Holo PSA 9', c)).toBe(false)
    // Not a promo set: no such rule.
    expect(gradedTitleMatches('Charmander 044 Holo PSA 9', { ...c, set: 'Obsidian Flames' })).toBe(
      true
    )
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
    expect(decodeURIComponent(search)).toContain(
      'filter=conditionIds:{2750},buyingOptions:{FIXED_PRICE}'
    )
    expect(decodeURIComponent(search).replace(/\+/g, ' ')).toContain('q="Dragonite" (5,005) PSA 7')
    expect(env.PRICES.store.size).toBe(1)
    expect(env.PRICES.put.mock.calls[0][2]).toEqual({ expirationTtl: 604800 })
    // The second ask is answered from KV.
    const again = await worker.fetch(req(url()), env)
    expect((await again.json()).price).toBe(45)
    expect(f.calls.filter((c) => c.includes('item_summary')).length).toBe(1)
  })

  it('keeps a lookup with too few listings for a day only', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch([json({ itemSummaries: [listing('Dragonite #5 PSA 7', 40)] })])
    )
    const res = await worker.fetch(req(url()), env)
    expect((await res.json()).price).toBe(null)
    expect(env.PRICES.put.mock.calls[0][2]).toEqual({ expirationTtl: 86400 })
  })

  it('refuses a bad grade, grader, game or client', async () => {
    vi.stubGlobal('fetch', makeFetch([]))
    for (const u of [url({ grade: '11' }), url({ company: 'XYZ' }), url({ game: 'nope' })])
      expect((await worker.fetch(req(u), env)).status).toBe(400)
    expect((await worker.fetch(req(url(), {}), env)).status).toBe(400)
  })
})
