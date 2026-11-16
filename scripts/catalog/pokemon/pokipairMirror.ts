/**
 * The catalog job's copy of PokiPair's Simplified Chinese card art (pokipair.ts) into R2, as hand
 * art: `hand/<handId>/high.jpg` and `low.jpg`, through the portal's admin route. Polite by design:
 * one request at a time with a gap before each, a nightly budget, and the run stops at the first
 * rate limit. What it copied is kept in a record the Pokémon stage reads, and is never asked again.
 */
import { existsSync, readFileSync } from 'node:fs'
import { encode as encodeJpeg } from 'jpeg-js'
import { fillCorners } from '../onepiece/art'
import { decodeImage } from '../references'
import { shrink, smallJpeg } from '../thumbs'
import { HttpError, withRetry } from '../upload'
import {
  OFFICIAL_PRODUCTS,
  officialSetOf,
  packCopy,
  packHandId,
  parseOfficialProducts
} from './zhPacks'
import {
  handId,
  matchCards,
  parseHub,
  parseSetPage,
  POKIPAIR_HUB,
  setIdOf,
  type PpCard,
  type ZhCatalogCard
} from './pokipair'
import { galleryHash, isGallery, matchGallery } from './pokipairGallery'

export const CATALOG_USER_AGENT = 'DuelBinder/catalog (https://github.com/darkharasho/duel-binder)'
/** Images copied per night. */
export const ZH_ART_BUDGET = 1500
/** The pause before each request to PokiPair. */
export const ZH_ART_GAP_MS = 1000
/** The kept copy is no wider than this. */
const HIGH_WIDTH = 734
const HIGH_QUALITY = 85

/** What the job has copied: the PokiPair picture each source id's hand art was made from. */
export interface MirrorRecord {
  done: Record<string, string>
  /** Each set's pack copy: the picture it was made from (an official one without its auth key). */
  packs?: Record<string, string>
  /**
   * Gallery pages (pokipairGallery.ts) that would not line up, by page slug (151's four waves are
   * one set): the page as it was
   * (`galleryKey`). Its thumbnails aren't fetched again until the page changes.
   */
  galleries?: Record<string, string>
}

export interface MirrorPortal {
  url: string
  token: string
  fetch?: typeof fetch
}

export interface MirrorOptions {
  /** zh-hans cards by set id. */
  cards: ReadonlyMap<string, ZhCatalogCard[]>
  record: MirrorRecord
  fetch: typeof fetch
  /** Absent on a dry run: nothing is downloaded, uploaded or recorded. */
  portal?: MirrorPortal
  /** Card images per run; packs are few and copied once, outside it. */
  budget: number
  /** zh-hans set names in Chinese by set id, for pokemon.cn's products; no official packs without. */
  zhNames?: ReadonlyMap<string, string>
  gapMs: number
  /** No image is started after this (ms since the epoch by `now`), so the step's time limit never cuts a run short unrecorded. */
  until?: number
  now?: () => number
  sleep: (ms: number) => Promise<void>
  /** Called after each set and after the packs, so a run cut short keeps what it copied. */
  save?: () => void
  log: (line: string) => void
}

export interface MirrorResult {
  /** Cards with a picture to copy tonight (all of them on a dry run). */
  matched: number
  uploaded: number
  failed: number
  /** Pack pictures copied. */
  packs: number
  /** Why the run stopped early (a rate limit), or null. */
  stopped: string | null
}

/** The record's file in the job's work directory (catalog-work), kept in the Actions cache. */
export const ZH_ART_RECORD_FILE = 'pokipair.json'

/** The record at `path`, or an empty one. */
export function readZhArtRecord(path: string): MirrorRecord {
  if (!existsSync(path)) return { done: {} }
  try {
    const r = JSON.parse(readFileSync(path, 'utf8')) as Partial<MirrorRecord>
    return { done: r.done ?? {}, packs: r.packs ?? {}, galleries: r.galleries ?? {} }
  } catch {
    return { done: {} } // a broken file is a lost record: copied again, nothing worse
  }
}

/** A gallery page as it is: a page that gains, loses or swaps a picture is tried again. */
const galleryKey = (page: readonly PpCard[]): string =>
  `${page.length} ${page[0]?.url ?? ''} ${page[page.length - 1]?.url ?? ''}`

/** A picture from pokemon.cn, the official site. */
const isOfficial = (url: string): boolean => url.startsWith('https://image.pokemon.com.cn/')

/** A refusal that means "stop asking for now". */
class Stop extends Error {}

/** The kept pair of copies of a PNG: null when it can't be decoded or a copy is too big. */
export function handCopies(bytes: Uint8Array): { high: Uint8Array; low: Uint8Array } | null {
  const img = decodeImage(bytes)
  if (!img || img.width <= 0 || img.height <= 0) return null
  const opaque = fillCorners(img)
  const big = shrink(opaque, HIGH_WIDTH)
  const high = new Uint8Array(
    encodeJpeg({ ...big, data: Buffer.from(big.data) }, HIGH_QUALITY).data
  )
  const low = smallJpeg(opaque)
  return low ? { high, low } : null
}

async function upload(
  p: MirrorPortal,
  id: string,
  size: 'high' | 'low' | 'pack',
  bytes: Uint8Array
): Promise<void> {
  const path = `/api/admin/hand-art/${id}/${size}`
  await withRetry(path, async () => {
    const res = await (p.fetch ?? fetch)(`${p.url.replace(/\/+$/, '')}${path}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${p.token}`,
        'content-type': size === 'pack' ? 'image/png' : 'image/jpeg'
      },
      body: bytes as Uint8Array<ArrayBuffer>,
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok)
      throw new HttpError(
        res.status,
        `${path} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim()
      )
  })
}

/** Copies tonight's share of PokiPair's art; see the file comment. */
export async function mirrorZhArt(o: MirrorOptions): Promise<MirrorResult> {
  const result: MirrorResult = { matched: 0, uploaded: 0, failed: 0, packs: 0, stopped: null }
  o.record.packs ??= {}
  o.record.galleries ??= {}
  const get = async (url: string): Promise<Response> => {
    await o.sleep(o.gapMs)
    const res = await o.fetch(url, {
      headers: { 'User-Agent': CATALOG_USER_AGENT },
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 429 || res.status === 403)
      throw new Stop(`${new URL(url).host} answered ${res.status} for ${url}`)
    return res
  }
  const text = async (url: string): Promise<string | null> => {
    let res: Response
    try {
      res = await get(url)
    } catch (e) {
      if (e instanceof Stop) throw e
      // No answer (a timeout, a reset): this page waits for another night; the rest goes on.
      o.log(`zh art: ${url} failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
    if (!res.ok) {
      o.log(`zh art: ${url} answered ${res.status}`)
      return null
    }
    return res.text()
  }
  const copy = async (
    what: string,
    url: string,
    keep: (bytes: Uint8Array) => Promise<void>
  ): Promise<boolean> => {
    try {
      const res = await get(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await keep(new Uint8Array(await res.arrayBuffer()))
      return true
    } catch (e) {
      if (e instanceof Stop) throw e
      result.failed++
      o.log(`zh art: ${what} failed: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  let left = o.budget
  let outOfTime = false
  const late = (): boolean => o.until !== undefined && (o.now ?? Date.now)() >= o.until
  /** A gallery's thumbnails' art hashes, in page order; null when one is missing or time is up. */
  const galleryHashes = async (page: readonly PpCard[]): Promise<Uint32Array[] | null> => {
    const out: Uint32Array[] = []
    for (const c of page) {
      if (late()) {
        outOfTime = true
        result.stopped = 'out of time for tonight'
        return null
      }
      let bytes: Uint8Array
      try {
        const res = await get(c.thumb!)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch (e) {
        if (e instanceof Stop) throw e
        o.log(`zh art: ${c.thumb} failed: ${e instanceof Error ? e.message : String(e)}`)
        return null
      }
      const h = galleryHash(bytes)
      if (h === null) {
        o.log(`zh art: ${c.thumb} is not a usable image`)
        return null
      }
      out.push(h)
    }
    return out
  }
  /** Each set's pack picture: the official one where there is one, else PokiPair's. */
  const packs = new Map<string, string>()
  try {
    const hub = await text(POKIPAIR_HUB)
    if (hub === null) return result
    const known = new Set(o.cards.keys())
    for (const set of parseHub(hub)) {
      const id = setIdOf(set.slug, known)
      if (id === null) continue
      if (set.pack && !packs.has(id)) packs.set(id, set.pack)
      const cards = o.cards.get(id) ?? []
      // A set whose cards all have their copy is not asked for again.
      if (cards.length > 0 && cards.every((c) => o.record.done[c.sourceId] !== undefined)) continue
      if ((left <= 0 || outOfTime) && o.portal) continue
      const html = await text(set.url)
      if (html === null) continue
      const page = parseSetPage(html).cards
      let matches: Map<string, string>
      if (isGallery(page, cards)) {
        const key = galleryKey(page)
        if (o.record.galleries[set.slug] === key) continue
        const hashes = await galleryHashes(page)
        if (hashes === null) continue
        matches = matchGallery(page, hashes, cards)
        o.log(
          `zh art: ${id} gallery of ${page.length} pictures${matches.size ? '' : " doesn't line up"}`
        )
        if (matches.size === 0 && o.portal) o.record.galleries[set.slug] = key
      } else {
        matches = matchCards(page, cards)
      }
      const todo = [...matches].filter(([sourceId]) => o.record.done[sourceId] === undefined)
      o.log(`zh art: ${id} ${matches.size}/${cards.length} matched, ${todo.length} to copy`)
      result.matched += todo.length
      if (!o.portal) continue
      const portal = o.portal
      for (const [sourceId, url] of todo) {
        if (left <= 0) break
        if (late()) {
          // Cards wait for tomorrow; the few packs below still go.
          outOfTime = true
          result.stopped = 'out of time for tonight'
          break
        }
        left--
        const ok = await copy(sourceId, url, async (bytes) => {
          const copies = handCopies(bytes)
          if (!copies) throw new Error('not a usable image')
          const hid = handId(sourceId)
          await upload(portal, hid, 'high', copies.high)
          await upload(portal, hid, 'low', copies.low)
        })
        if (ok) {
          o.record.done[sourceId] = url
          result.uploaded++
        }
      }
      o.save?.()
    }

    if (o.zhNames) {
      const list = await text(OFFICIAL_PRODUCTS)
      for (const p of list === null ? [] : parseOfficialProducts(list)) {
        const id = officialSetOf(p.name, o.zhNames)
        if (id !== null && o.cards.has(id)) packs.set(id, p.image)
      }
    }
    if (!o.portal) return result
    const portal = o.portal
    for (const [id, source] of packs) {
      const kept = o.record.packs[id]
      // The official link's auth key changes every night; the picture is the same.
      if (kept === source.split('?')[0]) continue
      // An official pack stays once copied: pokemon.cn only lists its newest products.
      if (kept !== undefined && isOfficial(kept) && !isOfficial(source)) continue
      const ok = await copy(`${id} pack`, source, async (bytes) => {
        const png = packCopy(bytes)
        if (!png) throw new Error('not a usable image')
        await upload(portal, packHandId(id), 'pack', png)
      })
      if (ok) {
        o.record.packs[id] = source.split('?')[0]
        result.packs++
      }
    }
    o.save?.()
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    result.stopped = e.message
    o.log(`zh art: stopped: ${e.message}`)
  }
  return result
}
