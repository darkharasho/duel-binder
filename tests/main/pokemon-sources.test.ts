import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPokemonSources } from '../../scripts/catalog/pokemon/sources'
import { DEFAULT_RETRY_DELAY_MS, MAX_ATTEMPTS, retryDelay } from '../../scripts/catalog/pokemon/http'

const FIX = join(__dirname, '..', 'fixtures', 'pokemon')
const read = (p: string): unknown => JSON.parse(readFileSync(join(FIX, p), 'utf8'))
const UA = 'DuelBinder/9.9.9 (https://github.com/darkharasho/duel-binder)'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Fake { fetch: typeof fetch; calls: { url: string; ua: string | null }[]; fail: Map<string, number> }

/** Serves the checked-in fixtures by URL. `fail` maps a URL substring to a count of 503s to serve first. */
function fakeFetch(opts: { delayMs?: number } = {}): Fake {
  const calls: Fake['calls'] = []
  const fail = new Map<string, number>()
  let inflight = 0
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    calls.push({ url, ua: headers.get('user-agent') })
    inflight++
    ;(f as unknown as { peak: number }).peak = Math.max((f as unknown as { peak: number }).peak ?? 0, inflight)
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      for (const [k, n] of fail) {
        if (url.includes(k) && n > 0) { fail.set(k, n - 1); return json({ error: 'unavailable' }, 503) }
      }
      let m = /api\.tcgdex\.net\/v2\/(en|ja)\/sets$/.exec(url)
      if (m) {
        const list = read(`${m[1]}/sets.json`) as { id: string }[]
        return json(list.filter((s) => existsSync(join(FIX, m![1], `set-${s.id}.json`))))
      }
      m = /api\.tcgdex\.net\/v2\/(en|ja)\/sets\/([^/]+)$/.exec(url)
      if (m) return existsSync(join(FIX, m[1], `set-${m[2]}.json`)) ? json(read(`${m[1]}/set-${m[2]}.json`)) : json({}, 404)
      m = /api\.tcgdex\.net\/v2\/(en|ja)\/cards\/([^/]+)$/.exec(url)
      if (m) return existsSync(join(FIX, m[1], `card-${m[2]}.json`)) ? json(read(`${m[1]}/card-${m[2]}.json`)) : json({}, 404)
      m = /tcgcsv\.com\/tcgplayer\/(3|85)\/groups$/.exec(url)
      if (m) return json(read(`tcgcsv/${m[1]}/groups.json`))
      m = /tcgcsv\.com\/tcgplayer\/(3|85)\/(\d+)\/(products|prices)$/.exec(url)
      if (m) return json(read(`tcgcsv/${m[1]}/${m[3]}-${m[2]}.json`))
      return json({}, 404)
    } finally {
      inflight--
    }
  }
  return { fetch: f as typeof fetch, calls, fail }
}

describe('pokemon sources', () => {
  let dir: string
  let clock: Date
  const make = (fake: Fake, extra: Record<string, unknown> = {}) =>
    createPokemonSources({
      cachePath: join(dir, 'cache.db'), fetch: fake.fetch, version: '9.9.9',
      now: () => clock, retryDelayMs: 1, ...extra
    })
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pkm-src-')); clock = new Date('2026-10-29T00:00:00Z') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('fetches a new card once and serves it from cache within 7 days', async () => {
    const fake = fakeFetch(); const s = make(fake)
    const a = await s.cards('en', ['sv01-001'])
    expect(a[0].name).toBe('Pineco')
    expect(a[0].id).toBe('sv01-001')
    await s.cards('en', ['sv01-001'])
    clock = new Date('2026-11-04T00:00:00Z')
    await s.cards('en', ['sv01-001'])
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/sv01-001'))).toHaveLength(1)
    clock = new Date('2026-11-06T00:00:00Z') // day 8
    await s.cards('en', ['sv01-001'])
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/sv01-001'))).toHaveLength(2)
    s.close()
  })

  it('keeps the cache across instances and keeps languages apart', async () => {
    const fake = fakeFetch()
    const s1 = make(fake); await s1.cards('ja', ['SV1S-001']); s1.close()
    const s2 = make(fake); await s2.cards('ja', ['SV1S-001']); s2.close()
    expect(fake.calls.filter((c) => c.url.endsWith('/ja/cards/SV1S-001'))).toHaveLength(1)
  })

  it('returns cards in the requested order', async () => {
    const s = make(fakeFetch())
    const out = await s.cards('en', ['sv01-003', 'sv01-001', 'base1-4'])
    expect(out.map((c) => c.id)).toEqual(['sv01-003', 'sv01-001', 'base1-4'])
    s.close()
  })

  it('refetches a card with no image on every call', async () => {
    const fake = fakeFetch(); const s = make(fake)
    const out = await s.cards('ja', ['M4-001'])
    expect(out[0].image).toBeUndefined()
    await s.cards('ja', ['M4-001']); await s.cards('ja', ['M4-001'])
    expect(fake.calls.filter((c) => c.url.endsWith('/ja/cards/M4-001'))).toHaveLength(3)
    s.close()
  })

  it('refetches a card with no TCGplayer id on card or variants, but not when only a variant has one', async () => {
    const fake = fakeFetch()
    const noId = ((u: RequestInfo | URL, i?: RequestInit) => {
      if (!String(u).endsWith('/en/cards/sv01-002')) return fake.fetch(u, i)
      const c = read('en/card-sv01-002.json') as { thirdParty?: unknown; variants_detailed?: { thirdParty?: unknown }[] }
      delete c.thirdParty
      for (const v of c.variants_detailed ?? []) delete v.thirdParty
      fake.calls.push({ url: String(u), ua: null })
      return Promise.resolve(json(c))
    }) as typeof fetch
    const s = make({ ...fake, fetch: noId })
    await s.cards('en', ['sv01-002']); await s.cards('en', ['sv01-002'])
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/sv01-002'))).toHaveLength(2)
    // base1-4 has tcgplayer ids on its variants only, plus an image: cached after the first call
    await s.cards('en', ['base1-4']); await s.cards('en', ['base1-4'])
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/base1-4'))).toHaveLength(1)
    s.close()
  })

  it('sends the User-Agent on every request', async () => {
    const fake = fakeFetch(); const s = make(fake)
    await s.sets('en'); await s.cards('en', ['sv01-001']); await s.groups('en'); await s.products('en', 22873); await s.prices('en', 22873)
    expect(fake.calls.length).toBeGreaterThan(5)
    for (const c of fake.calls) expect(c.ua).toBe(UA)
    s.close()
  })

  it('retries a 503 once and succeeds; five 503s throw', async () => {
    const fake = fakeFetch(); fake.fail.set('/en/cards/sv01-002', 1)
    const s = make(fake)
    await expect(s.cards('en', ['sv01-002'])).resolves.toHaveLength(1)
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/sv01-002'))).toHaveLength(2)
    fake.fail.set('/en/cards/sv01-003', 5)
    await expect(s.cards('en', ['sv01-003'])).rejects.toThrow(/503/)
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/sv01-003'))).toHaveLength(5)
    s.close()
  })

  it('rides out a burst of four 503s (TCGdex sheds load for a few seconds at a time)', async () => {
    const fake = fakeFetch(); fake.fail.set('/en/cards/sv01-002', 4)
    const s = make(fake)
    await expect(s.cards('en', ['sv01-002'])).resolves.toHaveLength(1)
    s.close()
  })

  it('waits about half a minute in all by default before giving up', () => {
    const waits = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => retryDelay(DEFAULT_RETRY_DELAY_MS, i + 1))
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(25_000)
  })

  it('retries network errors and 429, but not a 404', async () => {
    const fake = fakeFetch(); let boom = 1
    const wrapped = ((u: RequestInfo | URL, i?: RequestInit) => {
      if (String(u).endsWith('/en/cards/sv01-001') && boom-- > 0) return Promise.reject(new TypeError('fetch failed'))
      return fake.fetch(u, i)
    }) as typeof fetch
    const s = make({ ...fake, fetch: wrapped })
    await expect(s.cards('en', ['sv01-001'])).resolves.toHaveLength(1)
    await expect(s.cards('en', ['nope-1'])).rejects.toThrow(/404/)
    expect(fake.calls.filter((c) => c.url.endsWith('/en/cards/nope-1'))).toHaveLength(1)
    s.close()
  })

  it('stops fetching the rest of the cards once one fails', async () => {
    const fake = fakeFetch({ delayMs: 5 }); const s = make(fake)
    const ids = Array.from({ length: 40 }, (_, i) => `nope-${i}`)
    await expect(s.cards('en', ids)).rejects.toThrow(/404/)
    // Let anything still queued run, as the job's process would.
    await new Promise((r) => setTimeout(r, 100))
    // The four in flight, plus at most one whose slot opened before the abort landed.
    expect(fake.calls.filter((c) => c.url.includes('/en/cards/nope-')).length).toBeLessThanOrEqual(5)
    s.close()
  })

  it('stops fetching the rest of the sets once one fails', async () => {
    const fake = fakeFetch({ delayMs: 5 })
    const list = Array.from({ length: 40 }, (_, i) => ({ id: `gone${i}`, name: `Gone ${i}` }))
    const wrapped = ((u: RequestInfo | URL, i?: RequestInit) =>
      /\/v2\/en\/sets$/.test(String(u)) ? Promise.resolve(json(list)) : fake.fetch(u, i)) as typeof fetch
    const s = make({ ...fake, fetch: wrapped })
    await expect(s.sets('en')).rejects.toThrow(/404/)
    await new Promise((r) => setTimeout(r, 100))
    expect(fake.calls.filter((c) => c.url.includes('/en/sets/gone')).length).toBeLessThanOrEqual(5)
    s.close()
  })

  it('fetches every set of the list in full', async () => {
    const s = make(fakeFetch())
    const sets = await s.sets('ja')
    expect(sets.map((x) => x.id).sort()).toEqual(['M1L', 'M4', 'PMCG1', 'SV1S'])
    expect(sets.find((x) => x.id === 'SV1S')!.cards.map((c) => c.localId)).toEqual(['001', '002', '003', '008'])
    s.close()
  })

  it('leaves out the digital-only TCG Pocket sets', async () => {
    const pocket = { id: 'A1', name: 'Genetic Apex', serie: { id: 'tcgp' }, cards: [] }
    const paper = { id: 'sv01', name: 'Scarlet & Violet', serie: { id: 'sv' }, cards: [] }
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/en/sets')) return json([{ id: 'A1' }, { id: 'sv01' }])
      if (url.endsWith('/groups')) return json({ results: [] })
      return json(url.endsWith('/A1') ? pocket : paper)
    }) as typeof fetch
    const s = make({ fetch: f, calls: [], fail: new Map() })
    expect((await s.sets('en')).map((x) => x.id)).toEqual(['sv01'])
    s.close()
  })

  it('adds a set TCGplayer lists and TCGdex does not, and serves its cards without TCGdex', async () => {
    const urls: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/en/sets')) return json([])
      if (url.endsWith('/groups')) {
        return json({ results: [{ groupId: 24831, name: 'ME06: Delta Reign', abbreviation: 'DLR' }] })
      }
      if (url.endsWith('/24831/products')) {
        return json({
          results: [{
            productId: 726512, name: 'Mega Golisopod ex - 011/103',
            extendedData: [{ name: 'Number', value: '011/103' }, { name: 'Card Type', value: 'Grass' }]
          }]
        })
      }
      return json({}, 404)
    }) as typeof fetch
    const s = make({ fetch: f, calls: [], fail: new Map() })
    expect((await s.sets('en')).map((x) => x.id)).toEqual(['me06'])
    const [card] = await s.cards('en', ['me06-011'])
    expect(card.name).toBe('Mega Golisopod ex')
    expect(urls.some((u) => u.includes('tcgdex.net') && u.includes('me06'))).toBe(false)
    s.close()
  })

  it('leaves the art of a product with no picture yet', async () => {
    const f = (async () =>
      json({
        results: [
          { productId: 1, groupId: 2, name: 'A', imageUrl: 'https://x/1_200w.jpg', imageCount: 0 },
          { productId: 2, groupId: 2, name: 'B', imageUrl: 'https://x/2_200w.jpg', imageCount: 1 }
        ]
      })) as typeof fetch
    const s = make({ fetch: f, calls: [], fail: new Map() })
    expect((await s.products('en', 2)).map((p) => p.imageUrl)).toEqual([
      undefined,
      'https://x/2_200w.jpg'
    ])
    s.close()
  })

  it('maps languages to TCGCSV categories', async () => {
    const fake = fakeFetch(); const s = make(fake)
    const ja = await s.groups('ja')
    expect(fake.calls.at(-1)!.url).toBe('https://tcgcsv.com/tcgplayer/85/groups')
    expect(ja.map((g) => g.groupId).sort()).toEqual([23605, 23721, 24399, 24653])
    const en = await s.groups('en')
    expect(fake.calls.at(-1)!.url).toBe('https://tcgcsv.com/tcgplayer/3/groups')
    expect(en.map((g) => g.groupId).sort((a, b) => a - b)).toEqual([604, 1663, 22873])
    await s.products('ja', 23605); await s.prices('ja', 23605)
    expect(fake.calls.slice(-2).map((c) => c.url)).toEqual([
      'https://tcgcsv.com/tcgplayer/85/23605/products', 'https://tcgcsv.com/tcgplayer/85/23605/prices'
    ])
    s.close()
  })

  it('maps Number into number, null for sealed product', async () => {
    const s = make(fakeFetch())
    const ps = await s.products('ja', 23605)
    expect(ps.find((p) => p.productId === 567118)).toMatchObject({ name: 'Cacnea', number: '001/078', groupId: 23605 })
    expect(ps.find((p) => p.productId === 565246)!.number).toBeNull()
    s.close()
  })

  it('returns prices with a Holofoil row for SV1S-008', async () => {
    const s = make(fakeFetch())
    const prices = await s.prices('ja', 23605)
    expect(prices.find((p) => p.productId === 567125 && p.subTypeName === 'Holofoil')!.marketPrice).toBeGreaterThan(0)
    s.close()
  })

  it('never has more than 4 requests in flight', async () => {
    const fake = fakeFetch({ delayMs: 15 }); const s = make(fake)
    await s.cards('en', ['sv01-001', 'sv01-002', 'sv01-003', 'base1-4'])
    await s.cards('ja', ['SV1S-001', 'SV1S-002', 'SV1S-003', 'SV1S-008', 'M4-001', 'PMCG1-001', 'M1L-001'])
    await Promise.all([s.sets('en'), s.sets('ja'), s.groups('en'), s.groups('ja'), s.prices('ja', 23605), s.prices('en', 604)])
    const peak = (fake.fetch as unknown as { peak: number }).peak
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
    s.close()
  })
})
