import type { TcGroup, TcPrice } from '../pokemon/types'
import { createLimiter, MAX_ATTEMPTS, MAX_CONCURRENCY, DEFAULT_RETRY_DELAY_MS, REPO_URL, retryDelay, type GetJsonOpts } from '../pokemon/http'
import { BANDAI_EN, parseCardList, parseSeriesList } from './bandai'
import type { OpCache } from './cache'
import { opGroups, opPrices, opProducts, type OpProduct } from './tcgcsv'
import type { BandaiEntry, BandaiSeries, OpSeriesKind } from './types'

export const PAGE_GAP_MS = 1000
/** One request's limit, body included; a request that runs over is a failed attempt and retried. */
export const REQUEST_TIMEOUT_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_MS = 60 * DAY_MS
const STALE_MS = 7 * DAY_MS

export interface OnePieceSources {
  series(): Promise<{ series: BandaiSeries[]; notes: string[] }>
  /**
   * Tonight's entries of every series, not deduped: fresh pages per the schedule, cached ones
   * otherwise. `published` maps a series id to its mapped group's `publishedOn` (ms).
   */
  entries(series: BandaiSeries[], published: Map<string, number>): Promise<{ entries: BandaiEntry[]; problems: string[]; notes: string[] }>
  groups(): Promise<TcGroup[]>
  products(groupId: number): Promise<OpProduct[]>
  prices(groupId: number): Promise<TcPrice[]>
  /** Raw bytes; `since` makes it conditional (null on 304). */
  bandaiImage(bandaiId: string, since?: string): Promise<{ bytes: Uint8Array; lastModified: string | null } | null>
  tcgImage(url: string): Promise<Uint8Array>
}

export interface OnePieceSourcesOpts {
  cache: OpCache
  fetch?: typeof fetch
  version: string
  log?: (l: string) => void
  now?: () => number
  /** Base retry backoff in ms (tests pass a tiny value). */
  retryDelayMs?: number
  /** The wait between Bandai pages; tests pass 0. */
  pageGapMs?: number
  /** Per-request limit; defaults to REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number
  /** Which Bandai card list: BANDAI_EN (the default) or BANDAI_JA. */
  site?: string
}

/**
 * `fetch` with a time limit that covers the body: a 2xx body is read before the call returns, so a
 * stalled download fails inside the caller's try and counts as one more failed attempt.
 */
export function timedFetch(f: typeof fetch, ms: number): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await f(input, { ...init, signal: AbortSignal.timeout(ms) })
    if (!res.ok || res.status === 204 || res.status === 205) return res
    const body = await res.arrayBuffer()
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  }) as typeof fetch
}

/** True when tonight's run should fetch the series' page again. */
export function seriesDue(
  s: { fetched_at: number | null; first_seen_at: number },
  kind: OpSeriesKind,
  publishedOn: number | null,
  now: number
): boolean {
  if (s.fetched_at === null) return true
  if (kind === 'promo' || kind === 'other') return true
  if (now - (publishedOn ?? s.first_seen_at) < RECENT_MS) return true
  return now - s.fetched_at >= STALE_MS
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function createOnePieceSources(o: OnePieceSourcesOpts): OnePieceSources {
  const { cache } = o
  const site = o.site ?? BANDAI_EN
  const doFetch = timedFetch(o.fetch ?? fetch, o.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
  const now = o.now ?? Date.now
  const userAgent = `DuelBinder/${o.version} (${REPO_URL})`
  const baseDelay = o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const gap = o.pageGapMs ?? PAGE_GAP_MS
  const json: GetJsonOpts = { fetch: doFetch, userAgent, limiter: createLimiter(MAX_CONCURRENCY), retryDelayMs: o.retryDelayMs, log: o.log }

  /** GET with the job's retries: network errors, 429 and 5xx are retried; `accept` statuses return as they are. */
  async function get(url: string, headers: Record<string, string> = {}, accept: number[] = []): Promise<Response> {
    let last: Error | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(retryDelay(baseDelay, attempt))
      let res: Response
      try {
        res = await doFetch(url, { headers: { 'User-Agent': userAgent, ...headers } })
      } catch (e) {
        last = new Error(`GET ${url} failed: ${(e as Error).message}`)
        o.log?.(`retry ${attempt + 1}/${MAX_ATTEMPTS}: ${last.message}`)
        continue
      }
      if (res.ok || accept.includes(res.status)) return res
      last = new Error(`GET ${url} returned ${res.status}`)
      if (res.status !== 429 && res.status < 500) throw last
      o.log?.(`retry ${attempt + 1}/${MAX_ATTEMPTS}: ${last.message}`)
    }
    throw last as Error
  }

  // Bandai pages run one at a time, PAGE_GAP_MS apart.
  let pageChain: Promise<unknown> = Promise.resolve()
  let pagesFetched = 0
  function page(path: string): Promise<string> {
    const run = async (): Promise<string> => {
      if (pagesFetched++ > 0 && gap > 0) await sleep(gap)
      return (await get(`${site}${path}`, { Accept: 'text/html' })).text()
    }
    const p = pageChain.then(run, run)
    pageChain = p.catch(() => undefined)
    return p
  }

  return {
    async series() {
      const html = await page('/cardlist/')
      const parsed = parseSeriesList(html)
      if (parsed.series.length === 0) throw new Error('Bandai card list page lists no series; the page layout may have changed')
      const t = now()
      for (const s of parsed.series) cache.putSeries(s, t)
      return parsed
    },

    async entries(series, published) {
      const out: BandaiEntry[] = []
      const problems: string[] = []
      const notes: string[] = []
      for (const s of series) {
        const t = now()
        if (!cache.getSeries(s.id)) cache.putSeries(s, t)
        const row = cache.getSeries(s.id)!
        const cached = cache.getEntries(s.id)
        const due = seriesDue(
          { fetched_at: row.fetchedAt, first_seen_at: row.firstSeenAt }, s.kind, published.get(s.id) ?? null, t
        )
        if (!due) {
          out.push(...cached)
          continue
        }
        const { entries } = parseCardList(await page(`/cardlist/?series=${s.id}`), s.id)
        const n = entries.length
        const m = cached.length
        if (m > 0 && (n === 0 || (m >= 20 && n < m * 0.98))) {
          // A problem the first night only: a page that stays short (Bandai really removed cards)
          // must not turn every night red. The last full copy stays until a page parses in full.
          const line = `Bandai ${s.setCode} parsed to ${n} entries (was ${m}); kept the last copy`
          if (row.shrinkNotedAt === null) {
            problems.push(line)
            cache.markShrink(s.id, t)
          } else {
            notes.push(`${line} (short since ${new Date(row.shrinkNotedAt).toISOString().slice(0, 10)})`)
          }
          out.push(...cached)
          continue
        }
        if (row.shrinkNotedAt !== null) cache.markShrink(s.id, null)
        if (n === 0) notes.push(`Bandai ${s.setCode} lists no cards yet`)
        cache.replaceEntries(s.id, entries, t)
        cache.markFetched(s.id, t)
        out.push(...entries)
      }
      return { entries: out, problems, notes }
    },

    groups: () => opGroups(json),
    products: (groupId) => opProducts(groupId, json),
    prices: (groupId) => opPrices(groupId, json),

    async bandaiImage(bandaiId, since) {
      const res = await get(
        `${site}/images/cardlist/card/${bandaiId}.png`, since ? { 'If-Modified-Since': since } : {}, [304]
      )
      if (res.status === 304) return null
      return { bytes: new Uint8Array(await res.arrayBuffer()), lastModified: res.headers.get('last-modified') }
    },

    async tcgImage(url) {
      return new Uint8Array(await (await get(url)).arrayBuffer())
    }
  }
}

/**
 * Keeps an entry id listed on several series pages once, under the page its card sets name, else
 * the earliest listing page (`published` ascending, an unmapped page last, then series id).
 */
export function dedupeEntries(
  series: BandaiSeries[],
  entries: BandaiEntry[],
  published: Map<string, number>
): { entries: BandaiEntry[]; notes: string[] } {
  const byId = new Map<string, BandaiEntry[]>()
  for (const e of entries) {
    const l = byId.get(e.bandaiId)
    if (l) l.push(e)
    else byId.set(e.bandaiId, [e])
  }
  const bySeries = new Map(series.map((s) => [s.id, s]))
  const idOrder = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })
  const rank = (a: string, b: string): number => {
    const pa = published.get(a)
    const pb = published.get(b)
    if (pa !== pb) return pa === undefined ? 1 : pb === undefined ? -1 : pa - pb
    return idOrder(a, b)
  }
  const keep = new Map<string, string>()
  const notes: string[] = []
  for (const [id, copies] of byId) {
    const pages = [...new Set(copies.map((c) => c.seriesId))].sort(idOrder)
    if (pages.length < 2) continue
    const named = pages.filter((sid) => {
      const s = bySeries.get(sid)
      return !!s && copies.some((c) => c.cardSets.includes(`[${s.code}]`) || (s.title !== '' && c.cardSets.includes(s.title)))
    })
    const kept = [...(named.length === 1 ? named : named.length > 1 ? named : pages)].sort(rank)[0]
    keep.set(id, kept)
    const codes = pages.map((sid) => bySeries.get(sid)?.setCode ?? sid)
    const keptCode = bySeries.get(kept)?.setCode ?? kept
    const listed = codes.length === 2 ? `${codes[0]} and ${codes[1]}` : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`
    notes.push(`${id} is listed in ${listed}; kept in ${keptCode}`)
  }
  return { entries: entries.filter((e) => !keep.has(e.bandaiId) || keep.get(e.bandaiId) === e.seriesId), notes }
}
