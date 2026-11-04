import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BANDAI_JA, parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'
import { openOpCache, type OpCache } from '../../scripts/catalog/onepiece/cache'
import { createOnePieceSources, dedupeEntries, seriesDue, type OnePieceSources } from '../../scripts/catalog/onepiece/sources'

const fx = (n: string): string => readFileSync(join(__dirname, '../fixtures/onepiece', n), 'utf8')
const OP17 = fx('bandai-op17.html')
const OP15 = fx('bandai-op15eb04.html')
const PROMO = fx('bandai-promo.html')
const noBlocks = (h: string): string => h.replace(/<dl class="modalCol"[\s\S]*?<\/dl>/g, '')
const DAY = 24 * 60 * 60 * 1000
const at = (d: string): number => Date.parse(d + 'T12:00:00Z')

const SERIES = parseSeriesList(OP17).series
const published = new Map<string, number>([['569117', at('2026-08-28')], ['569115', at('2026-05-01')]])
const OP17_COUNT = parseCardList(OP17, '569117').entries.length

let dir: string
let cache: OpCache
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'op-src-')); cache = openOpCache(join(dir, 'c.db')) })
afterEach(() => { cache.close(); rmSync(dir, { recursive: true, force: true }) })

function fakeFetch(pages: Record<string, string>, requests: string[] = [], extra?: (url: string, init?: RequestInit) => Response | undefined): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    const x = extra?.(url, init)
    if (x) return x
    const key = Object.keys(pages).find((k) => url.endsWith(k))
    if (!key) return new Response('nope', { status: 404 })
    return new Response(pages[key], { status: 200 })
  }) as typeof fetch
}
const mk = (f: typeof fetch, clock: { t: number }, extra = {}): OnePieceSources =>
  createOnePieceSources({ cache, fetch: f, version: '1.0.0', now: () => clock.t, pageGapMs: 0, retryDelayMs: 1, ...extra })
const PAGES = { '?series=569117': OP17, '?series=569115': OP15, '?series=569901': PROMO, '/cardlist/': OP17 }
const pageReqs = (r: string[]): string[] => r.filter((u) => u.includes('?series=')).map((u) => u.slice(u.indexOf('?')))

describe('One Piece sources', () => {
  it('the schedule fetches new, recent and stale pages only', async () => {
    const two = parseCardList(OP15, '569115').entries.slice(0, 2)
    cache.putSeries(SERIES.find((s) => s.id === '569115')!, at('2026-05-01'))
    cache.replaceEntries('569115', two, at('2026-05-01'))
    cache.markFetched('569115', at('2026-09-12'))
    const reqs: string[] = []
    const clock = { t: at('2026-09-15') }
    const src = mk(fakeFetch(PAGES, reqs), clock)

    const n1 = await src.entries(SERIES, published)
    expect(pageReqs(reqs)).toEqual(['?series=569117', '?series=569901'])
    expect(n1.entries.filter((e) => e.seriesId === '569115')).toEqual(two)

    reqs.length = 0
    clock.t = at('2026-09-16')
    await src.entries(SERIES, published)
    expect(pageReqs(reqs)).toEqual(['?series=569117', '?series=569901'])

    reqs.length = 0
    clock.t = at('2026-09-20')
    await src.entries(SERIES, published)
    expect(pageReqs(reqs)).toEqual(['?series=569117', '?series=569115', '?series=569901'])
  })

  it('seriesDue falls back to first seen for an unmapped series', () => {
    const now = at('2026-09-15')
    const fetched = now - DAY
    expect(seriesDue({ fetched_at: fetched, first_seen_at: now - 10 * DAY }, 'booster', null, now)).toBe(true)
    expect(seriesDue({ fetched_at: fetched, first_seen_at: now - 90 * DAY }, 'booster', null, now)).toBe(false)
    expect(seriesDue({ fetched_at: fetched, first_seen_at: now - DAY }, 'booster', now - 90 * DAY, now)).toBe(false)
  })

  it('pages are one at a time', async () => {
    const spans: { s: number; e: number }[] = []
    const f: typeof fetch = (async (input: RequestInfo | URL) => {
      const s = Date.now()
      await new Promise((r) => setTimeout(r, 15))
      spans.push({ s, e: Date.now() })
      const url = String(input)
      return new Response(url.includes('569115') ? OP15 : url.includes('569901') ? PROMO : OP17)
    }) as typeof fetch
    const src = mk(f, { t: at('2026-09-15') })
    await Promise.all([src.entries(SERIES, published), src.series()])
    expect(spans.length).toBe(4)
    spans.sort((a, b) => a.s - b.s)
    for (let i = 1; i < spans.length; i++) expect(spans[i].s).toBeGreaterThanOrEqual(spans[i - 1].e)
  })

  it('short parse keeps the cached entries', async () => {
    const clock = { t: at('2026-09-15') }
    const n1 = await mk(fakeFetch(PAGES), clock).entries(SERIES, published)
    expect(n1.problems).toEqual([])
    expect(OP17_COUNT).toBe(7)
    clock.t = at('2026-09-16')
    const n2 = await mk(fakeFetch({ ...PAGES, '?series=569117': noBlocks(OP17) }), clock).entries(SERIES, published)
    expect(n2.entries.filter((e) => e.seriesId === '569117')).toHaveLength(OP17_COUNT)
    expect(n2.problems).toEqual([`Bandai OP17 parsed to 0 entries (was ${OP17_COUNT}); kept the last copy`])
  })

  it('a short page is a problem the first night only, then a note until it parses in full', async () => {
    const short = { ...PAGES, '?series=569117': noBlocks(OP17) }
    const line = `Bandai OP17 parsed to 0 entries (was ${OP17_COUNT}); kept the last copy`
    const clock = { t: at('2026-09-15') }
    await mk(fakeFetch(PAGES), clock).entries(SERIES, published)
    clock.t = at('2026-09-16')
    expect((await mk(fakeFetch(short), clock).entries(SERIES, published)).problems).toEqual([line])
    clock.t = at('2026-09-17')
    const n3 = await mk(fakeFetch(short), clock).entries(SERIES, published)
    expect(n3.problems).toEqual([])
    expect(n3.notes).toContain(`${line} (short since 2026-09-16)`)
    expect(n3.entries.filter((e) => e.seriesId === '569117')).toHaveLength(OP17_COUNT)
    // A full parse ends the run; the next short page is news again.
    clock.t = at('2026-09-18')
    const n4 = await mk(fakeFetch(PAGES), clock).entries(SERIES, published)
    expect(n4.problems).toEqual([])
    expect(n4.notes.filter((n) => n.includes('parsed to'))).toEqual([])
    clock.t = at('2026-09-19')
    expect((await mk(fakeFetch(short), clock).entries(SERIES, published)).problems).toEqual([line])
  })

  it('a request that runs over its time limit is retried', async () => {
    let calls = 0
    const f = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (calls++ === 0) {
        // Hangs until the time limit aborts it.
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        )
      }
      return new Response(OP17, { status: 200 })
    }) as typeof fetch
    const r = await mk(f, { t: at('2026-09-15') }, { requestTimeoutMs: 20 }).series()
    expect(calls).toBe(2)
    expect(r.series.length).toBeGreaterThan(0)
  })

  it('a series with no cards yet is a note', async () => {
    const r = await mk(fakeFetch({ ...PAGES, '?series=569901': noBlocks(PROMO) }), { t: at('2026-09-15') }).entries(SERIES, published)
    expect(r.problems).toEqual([])
    expect(r.notes).toEqual(['Bandai P lists no cards yet'])
  })

  it('a duplicate id keeps the series its card sets name', async () => {
    const r = await mk(fakeFetch(PAGES), { t: at('2026-09-15') }).entries(SERIES, published)
    const d = dedupeEntries(SERIES, r.entries, published)
    const dup = d.entries.filter((e) => e.bandaiId === 'EB04-061_p2')
    expect(dup.map((e) => e.seriesId)).toEqual(['569117'])
    expect(d.notes).toEqual(['EB04-061_p2 is listed in OP15-EB04 and OP17; kept in OP17'])

    const unknown = r.entries.map((e) => (e.bandaiId === 'EB04-061_p2' ? { ...e, cardSets: 'UNKNOWN' } : e))
    const u = dedupeEntries(SERIES, unknown, published)
    expect(u.entries.filter((e) => e.bandaiId === 'EB04-061_p2').map((e) => e.seriesId)).toEqual(['569115'])
  })

  it("the Japanese site's pages and images", async () => {
    const reqs: string[] = []
    const ja = fx('bandai-ja-op17.html')
    const src = mk(fakeFetch({ '/cardlist/': ja, '?series=550117': ja }, reqs, (url) =>
      url.endsWith('.png') ? new Response(new Uint8Array([1, 2]), { status: 200 }) : undefined
    ), { t: at('2026-09-15') }, { site: BANDAI_JA })
    const listed = await src.series()
    expect(listed.series.map((s) => s.id)).toContain('550117')
    await src.entries(listed.series.filter((s) => s.id === '550117'), new Map())
    await src.bandaiImage('OP17-001_p1')
    expect(reqs).toEqual([
      'https://www.onepiece-cardgame.com/cardlist/',
      'https://www.onepiece-cardgame.com/cardlist/?series=550117',
      'https://www.onepiece-cardgame.com/images/cardlist/card/OP17-001_p1.png'
    ])
  })

  it('conditional image fetch', async () => {
    const seen: (string | null)[] = []
    const f = fakeFetch({}, [], (_url, init) => {
      seen.push(new Headers(init?.headers).get('If-Modified-Since'))
      return new Response(null, { status: 304 })
    })
    const img = await mk(f, { t: 0 }).bandaiImage('OP17-005', 'Fri, 21 Aug 2026 00:56:18 GMT')
    expect(img).toBeNull()
    expect(seen).toEqual(['Fri, 21 Aug 2026 00:56:18 GMT'])
  })
})
