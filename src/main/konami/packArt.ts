import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../db/meta'
import { PACK_ART_PREFIX } from '../../shared/imageSources'

/**
 * Official pack renders from the English Yu-Gi-Oh! TCG site's product listings, matched to
 * English sets by the product page's code (/en/products/betb/) or by name. The site lists products
 * from about 2018 on; older sets keep their other art.
 */
const SITE = 'https://www.yugioh-card.com'
const CATEGORIES = [
  'booster-pack',
  'structure-deck',
  'starter-deck',
  'speed-duel',
  'tournament-packs',
  'others'
]
const REPO_URL = 'https://github.com/darkharasho/duel-binder'
export const PACK_ART_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 30_000

export interface ListedProduct {
  code: string | null
  name: string
  imageUrl: string
}

const decode = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/** Letters and digits only, so "Legendary 5D’s Decks" meets "Legendary 5D's Decks". */
export const nameKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The products on one listing page: each <li> with an image and a "Learn more" link. */
export function parseProductListing(html: string): ListedProduct[] {
  const out: ListedProduct[] = []
  for (const item of html.split(/<li[\s>]/i).slice(1)) {
    const img =
      /<img\s+src="(\/en\/wp-content\/uploads\/[^"]+\.(?:png|jpe?g|webp))"\s+alt="([^"]*)"/i.exec(
        item
      )
    if (!img) continue
    const name = decode(img[2])
    if (!name) continue
    const code = /href="(?:https:\/\/www\.yugioh-card\.com)?\/en\/products\/([a-z0-9]+)\/"/i.exec(
      item
    )?.[1]
    out.push({ code: code ? code.toUpperCase() : null, name, imageUrl: `${SITE}${img[1]}` })
  }
  return out
}

/** 'yc-' + first 20 hex chars of sha1(url); null for anything outside the site's uploads. */
export function packArtKey(url: string | null): string | null {
  if (url === null || !url.startsWith(PACK_ART_PREFIX)) return null
  return `yc-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`
}

export function shouldRefreshPackArt(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'pack_art_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= PACK_ART_INTERVAL_MS
}

/** Never rejects. Returns how many English sets have official art afterwards. */
export async function refreshPackArt(
  db: Database.Database,
  opts: { version: string; fetchFn?: typeof fetch; now?: Date }
): Promise<number> {
  const fetchFn = opts.fetchFn ?? fetch
  const headers = { 'User-Agent': `DuelBinder/${opts.version} (${REPO_URL})` }
  const listed: ListedProduct[] = []
  for (const category of CATEGORIES) {
    try {
      const res = await fetchFn(`${SITE}/en/products/${category}/`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      listed.push(...parseProductListing(await res.text()))
    } catch (e) {
      console.warn(
        `Pack art listing ${category} failed:`,
        e instanceof Error ? e.message : String(e)
      )
      return 0 // keep what's stored; try again next start
    }
  }

  const sets = db.prepare("SELECT set_name, set_code FROM sets WHERE language = 'en'").all() as {
    set_name: string
    set_code: string
  }[]
  const byCode = new Map(sets.map((s) => [s.set_code.toUpperCase(), s.set_name]))
  const byName = new Map(sets.map((s) => [nameKey(s.set_name), s.set_name]))
  const art = new Map<string, string>()
  for (const p of listed) {
    const set = (p.code && byCode.get(p.code)) || byName.get(nameKey(p.name))
    if (set && !art.has(set)) art.set(set, p.imageUrl)
  }

  const insert = db.prepare(
    'INSERT INTO pack_art (set_name, image_url, image_key) VALUES (?, ?, ?)'
  )
  db.transaction(() => {
    db.exec('DELETE FROM pack_art')
    for (const [set, url] of art) {
      const key = packArtKey(url)
      if (key) insert.run(set, url, key)
    }
  })()
  setMeta(db, 'pack_art_synced_at', (opts.now ?? new Date()).toISOString())
  console.info(`Pack art: ${art.size} sets from ${listed.length} official listings`)
  return art.size
}
