import { PassThrough, Readable, pipeline, type Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { createGunzip } from 'node:zlib'
import { createLimiter, getJson, REPO_URL } from '../pokemon/http'
import type { ScryCard, ScryfallSource, ScrySet } from './types'

const API = 'https://api.scryfall.com'
const DEFAULT_GAP_MS = 100

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The first chunk, put back, or undefined for an empty stream. Rejects if the stream errors first. */
function peek(src: Readable): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void): void => {
      src.off('readable', onReadable)
      src.off('end', onEnd)
      src.off('error', onError)
      fn()
    }
    const onReadable = (): void => {
      const chunk = src.read() as Buffer | null
      if (chunk === null) return
      done(() => {
        src.unshift(chunk)
        resolve(chunk)
      })
    }
    const onEnd = (): void => done(() => resolve(undefined))
    const onError = (e: Error): void => done(() => reject(e))
    src.on('readable', onReadable)
    src.on('end', onEnd)
    src.on('error', onError)
  })
}

/** Lines of a byte stream; a stream error rejects the iteration. */
async function* splitLines(input: AsyncIterable<Buffer>): AsyncIterable<string> {
  const dec = new StringDecoder('utf8')
  let rest = ''
  for await (const chunk of input) {
    rest += dec.write(chunk)
    let i: number
    while ((i = rest.indexOf('\n')) >= 0) {
      yield rest.slice(0, i)
      rest = rest.slice(i + 1)
    }
  }
  rest += dec.end()
  if (rest !== '') yield rest
}

/** What the job keeps: English, in paper, not digital-only. Everything else is dropped silently. */
export function isKept(c: ScryCard): boolean {
  return c.lang === 'en' && c.games.includes('paper') && c.digital !== true
}

/**
 * Reads the bulk file line by line. Accepts Scryfall's array layout (`{…},` per line) and plain
 * JSONL; `[`, `]` and blank lines are skipped. A line that is not JSON, or an array that never
 * closes, throws so a cut-off download fails the night.
 */
export async function* parseBulkLines(lines: AsyncIterable<string>): AsyncIterable<ScryCard> {
  let n = 0
  let opened = false
  let closed = false
  for await (const raw of lines) {
    n++
    const line = raw.trim()
    if (line === '') continue
    if (line === '[') {
      opened = true
      continue
    }
    if (line === ']') {
      closed = true
      continue
    }
    const text = line.endsWith(',') ? line.slice(0, -1) : line
    let card: ScryCard
    try {
      card = JSON.parse(text) as ScryCard
    } catch {
      throw new Error(`Scryfall bulk line ${n} is not JSON`)
    }
    yield card
  }
  if (opened && !closed) throw new Error('Scryfall bulk file ended early')
}

export function createScryfall(o: {
  version: string
  fetch?: typeof fetch
  gapMs?: number
}): ScryfallSource {
  const f = o.fetch ?? fetch
  const gap = o.gapMs ?? DEFAULT_GAP_MS
  const userAgent = `DuelBinder/${o.version} (${REPO_URL})`
  const limiter = createLimiter(1)
  let lastStart = 0
  // api.scryfall.com requests start at least `gap` ms apart; the one-slot limiter keeps them in order.
  const paced = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const wait = lastStart + gap - Date.now()
    if (wait > 0) await sleep(wait)
    lastStart = Date.now()
    return f(input, init)
  }) as typeof fetch
  const api = <T>(url: string): Promise<T> => getJson<T>(url, { fetch: paced, userAgent, limiter })

  return {
    async bulkInfo() {
      const list = await api<{
        data: {
          type: string
          download_uri?: string
          jsonl_download_uri?: string
          updated_at: string
        }[]
      }>(`${API}/bulk-data`)
      const e = list.data.find((d) => d.type === 'default_cards')
      if (!e) throw new Error('Scryfall bulk-data has no default_cards entry')
      // Scryfall's live entry carries only `jsonl_download_uri` (one object per line, gzipped) now;
      // parseBulkLines reads both layouts.
      const downloadUri = e.download_uri ?? e.jsonl_download_uri
      if (!downloadUri) throw new Error('Scryfall default_cards entry has no download link')
      return { downloadUri, updatedAt: e.updated_at }
    },
    async *cards(downloadUri) {
      const res = await f(downloadUri, { headers: { 'User-Agent': userAgent, Accept: '*/*' } })
      if (!res.ok || !res.body) throw new Error(`GET ${downloadUri} returned ${res.status}`)
      const src = Readable.fromWeb(res.body as never)
      const head = await peek(src)
      const body: Transform =
        head && head[0] === 0x1f && head[1] === 0x8b ? createGunzip() : new PassThrough()
      // pipeline destroys `body` with the source's error, so a dropped download rejects the iteration.
      pipeline(src, body, () => {})
      yield* parseBulkLines(splitLines(body))
    },
    async sets() {
      const out: ScrySet[] = []
      let url: string | null = `${API}/sets`
      while (url) {
        const page: { data: ScrySet[]; has_more?: boolean; next_page?: string } = await api(url)
        out.push(...page.data)
        url = page.has_more && page.next_page ? page.next_page : null
      }
      return out
    }
  }
}
