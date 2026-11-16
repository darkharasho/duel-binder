/**
 * The catalog job's copy of PokiPair's Simplified Chinese card art (pokipair.ts) into R2, as hand
 * art: `hand/<handId>/high.jpg` and `low.jpg`, through the portal's admin route. Polite by design:
 * one request at a time with a gap before each, a nightly budget, and the run stops at the first
 * rate limit. What it copied is kept in a record the Pokémon stage reads, and is never asked again.
 */
import { encode as encodeJpeg } from 'jpeg-js'
import { fillCorners } from '../onepiece/art'
import { decodeImage } from '../references'
import { shrink, smallJpeg } from '../thumbs'
import { HttpError, withRetry } from '../upload'
import {
  handId,
  matchCards,
  parseHub,
  parseSetPage,
  POKIPAIR_HUB,
  setIdOf,
  type ZhCatalogCard
} from './pokipair'

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
  budget: number
  gapMs: number
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
}

export interface MirrorResult {
  /** Cards with a picture to copy tonight (all of them on a dry run). */
  matched: number
  uploaded: number
  failed: number
  /** Why the run stopped early (a rate limit), or null. */
  stopped: string | null
}

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
  size: 'high' | 'low',
  bytes: Uint8Array
): Promise<void> {
  const path = `/api/admin/hand-art/${id}/${size}`
  await withRetry(path, async () => {
    const res = await (p.fetch ?? fetch)(`${p.url.replace(/\/+$/, '')}${path}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${p.token}`, 'content-type': 'image/jpeg' },
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
  const result: MirrorResult = { matched: 0, uploaded: 0, failed: 0, stopped: null }
  const get = async (url: string): Promise<Response> => {
    await o.sleep(o.gapMs)
    const res = await o.fetch(url, {
      headers: { 'User-Agent': CATALOG_USER_AGENT },
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 429 || res.status === 403)
      throw new Stop(`PokiPair answered ${res.status} for ${url}`)
    return res
  }
  const text = async (url: string): Promise<string | null> => {
    const res = await get(url)
    if (!res.ok) {
      o.log(`zh art: ${url} answered ${res.status}`)
      return null
    }
    return res.text()
  }

  let left = o.budget
  try {
    const hub = await text(POKIPAIR_HUB)
    if (hub === null) return result
    const known = new Set(o.cards.keys())
    for (const set of parseHub(hub)) {
      const id = setIdOf(set.slug, known)
      if (id === null) continue
      const cards = o.cards.get(id) ?? []
      // A set whose cards all have their copy is not asked for again.
      if (cards.length > 0 && cards.every((c) => o.record.done[c.sourceId] !== undefined)) continue
      const html = await text(set.url)
      if (html === null) continue
      const matches = matchCards(parseSetPage(html).cards, cards)
      const todo = [...matches].filter(([sourceId]) => o.record.done[sourceId] === undefined)
      o.log(`zh art: ${id} ${matches.size}/${cards.length} matched, ${todo.length} to copy`)
      result.matched += todo.length
      if (!o.portal) continue
      for (const [sourceId, url] of todo) {
        if (left <= 0) return result
        left--
        try {
          const res = await get(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const copies = handCopies(new Uint8Array(await res.arrayBuffer()))
          if (!copies) throw new Error('not a usable image')
          const hid = handId(sourceId)
          await upload(o.portal, hid, 'high', copies.high)
          await upload(o.portal, hid, 'low', copies.low)
          o.record.done[sourceId] = url
          result.uploaded++
        } catch (e) {
          if (e instanceof Stop) throw e
          result.failed++
          o.log(`zh art: ${sourceId} failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    result.stopped = e.message
    o.log(`zh art: stopped: ${e.message}`)
  }
  return result
}
