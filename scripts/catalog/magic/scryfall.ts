import { PassThrough, Readable, pipeline, type Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { createGunzip } from 'node:zlib'
import { mtgLanguageOf } from '../../../src/shared/games/magic'
import { createLimiter, getJson, REPO_URL } from '../pokemon/http'
import type { ScryCard, ScryFace, ScryfallSource, ScrySet } from './types'

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

const FACE_FIELDS = [
  'name',
  'printed_name',
  'oracle_id',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'colors',
  'power',
  'toughness',
  'loyalty',
  'defense',
  'illustration_id',
  'artist'
] as const satisfies readonly (keyof ScryFace)[]

const CARD_FIELDS = [
  'id',
  'oracle_id',
  'name',
  'printed_name',
  'image_status',
  'lang',
  'layout',
  'set',
  'set_name',
  'collector_number',
  'rarity',
  'released_at',
  'games',
  'digital',
  'finishes',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'colors',
  'color_identity',
  'power',
  'toughness',
  'loyalty',
  'defense',
  'keywords',
  'illustration_id',
  'artist',
  'frame',
  'border_color',
  'full_art',
  'promo_types'
] as const satisfies readonly (keyof ScryCard)[]

function pick(from: object, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const src = from as Record<string, unknown>
  for (const k of fields) if (src[k] !== undefined) out[k] = src[k]
  return out
}

/**
 * The fields rows.ts reads, nothing more. Of `image_uris` only whether it exists survives (`{}`),
 * and of `prices` only the USD finishes. Keeps the all_cards stream from holding full objects.
 */
export function slimCard(c: ScryCard): ScryCard {
  const out = pick(c, CARD_FIELDS)
  if (c.prices) {
    out.prices = { usd: c.prices.usd, usd_foil: c.prices.usd_foil, usd_etched: c.prices.usd_etched }
  }
  if (c.image_uris) out.image_uris = {}
  if (c.card_faces) {
    out.card_faces = c.card_faces.map((f) => {
      const face = pick(f, FACE_FIELDS)
      if (f.image_uris) face.image_uris = {}
      return face
    })
  }
  return out as unknown as ScryCard
}

/**
 * A function that returns a copy of a slimmed object with every repeated value shared with the
 * objects before it: strings (a non-English object's game text is its English card's oracle text,
 * and set names, artists, frames repeat across languages), string lists, prices. The values are
 * the same, only stored once, and every copy is built from one object literal, so V8 gives them all
 * one compact shape (an object filled key by key past a dozen keys turns into a hash table several
 * times the size). Absent fields are `undefined`. That is how ~540k kept objects fit in memory.
 * The objects and what they share are read-only from here on.
 */
export function createCompactor(): (c: ScryCard) => ScryCard {
  const strings = new Map<string, string>()
  const lists = new Map<string, string[]>()
  const priceSets = new Map<string, ScryCard['prices']>()
  const EMPTY_URIS: Record<string, string> = Object.freeze({}) as Record<string, string>
  const str = <T extends string | undefined>(v: T): T => {
    if (v === undefined) return v
    const have = strings.get(v)
    if (have !== undefined) return have as T
    strings.set(v, v)
    return v
  }
  const list = <T extends string[] | undefined>(a: T): T => {
    if (a === undefined) return a
    const key = `${a.length}\u0001${a.join('\u0000')}`
    const have = lists.get(key)
    if (have !== undefined) return have as T
    const shared = a.map((x) => str(x))
    lists.set(key, shared)
    return shared as T
  }
  const prices = (p: ScryCard['prices'] | undefined): ScryCard['prices'] | undefined => {
    if (!p) return undefined
    const key = `${p.usd}\u0000${p.usd_foil}\u0000${p.usd_etched}`
    let shared = priceSets.get(key)
    if (shared === undefined) {
      shared = { usd: p.usd, usd_foil: p.usd_foil, usd_etched: p.usd_etched }
      priceSets.set(key, shared)
    }
    return shared
  }
  const face = (f: ScryFace): ScryFace => ({
    name: str(f.name),
    printed_name: str(f.printed_name),
    oracle_id: str(f.oracle_id),
    mana_cost: str(f.mana_cost),
    cmc: f.cmc,
    type_line: str(f.type_line),
    oracle_text: str(f.oracle_text),
    colors: list(f.colors),
    power: str(f.power),
    toughness: str(f.toughness),
    loyalty: str(f.loyalty),
    defense: str(f.defense),
    illustration_id: str(f.illustration_id),
    artist: str(f.artist),
    image_uris: f.image_uris ? EMPTY_URIS : undefined
  })
  return (c) => ({
    // The id is the one value no other object has: kept as is, never in the map.
    id: c.id,
    oracle_id: str(c.oracle_id),
    name: str(c.name),
    printed_name: str(c.printed_name),
    image_status: str(c.image_status),
    lang: str(c.lang),
    layout: str(c.layout),
    set: str(c.set),
    set_name: str(c.set_name),
    collector_number: str(c.collector_number),
    rarity: str(c.rarity),
    released_at: str(c.released_at),
    games: list(c.games),
    digital: c.digital,
    finishes: list(c.finishes),
    prices: prices(c.prices)!,
    mana_cost: str(c.mana_cost),
    cmc: c.cmc,
    type_line: str(c.type_line),
    oracle_text: str(c.oracle_text),
    colors: list(c.colors),
    color_identity: list(c.color_identity),
    power: str(c.power),
    toughness: str(c.toughness),
    loyalty: str(c.loyalty),
    defense: str(c.defense),
    keywords: list(c.keywords),
    card_faces: c.card_faces?.map(face),
    illustration_id: str(c.illustration_id),
    artist: str(c.artist),
    frame: str(c.frame),
    border_color: str(c.border_color),
    full_art: c.full_art,
    promo_types: list(c.promo_types),
    image_uris: c.image_uris ? EMPTY_URIS : undefined
  })
}

/** What the job keeps: a supported language, in paper, not digital-only. Everything else is dropped silently. */
export function isKept(c: ScryCard): boolean {
  return mtgLanguageOf(c.lang) !== null && c.games.includes('paper') && c.digital !== true
}

/**
 * Reads the bulk file line by line. Accepts Scryfall's array layout (`{…},` per line) and plain
 * JSONL; `[`, `]` and blank lines are skipped. A line that is not JSON, or an array that never
 * closes, throws. A cut-off JSONL file has no `[` to check, so it is caught elsewhere: by gunzip
 * (a truncated gzip stream errors), by a truncated last line failing to parse, or by the fetch
 * body's length.
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
      const e = list.data.find((d) => d.type === 'all_cards')
      if (!e) throw new Error('Scryfall bulk-data has no all_cards entry')
      // Scryfall's live entry carries only `jsonl_download_uri` (one object per line, gzipped) now;
      // parseBulkLines reads both layouts.
      const downloadUri = e.download_uri ?? e.jsonl_download_uri
      if (!downloadUri) throw new Error('Scryfall all_cards entry has no download link')
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
      for await (const c of parseBulkLines(splitLines(body))) yield slimCard(c)
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
