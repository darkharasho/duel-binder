import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../db/meta'
import { createLimiter } from '../images/limiter'

/**
 * TCGplayer's Yu-Gi-Oh catalog, read from TCGCSV (a free daily public copy of it). Used only to
 * find the photo of each English printing; the photos themselves load from TCGplayer's image
 * server when shown, and are cached like every other image.
 */
const BASE_URL = 'https://tcgcsv.com/tcgplayer/2'
const REPO_URL = 'https://github.com/darkharasho/yugioh-collection-tracker'
export const TCGPLAYER_IMAGE_PREFIX = 'https://tcgplayer-cdn.tcgplayer.com/product/'
export const TCG_CATALOG_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 60_000

interface Group {
  groupId: number
  modifiedOn: string
}

interface Product {
  productId: number
  imageUrl?: string
  imageCount?: number
  extendedData?: { name: string; value: string }[]
}

export interface TcgCatalogResult {
  groups: number
  updatedGroups: number
  failedGroups: number
  ok: boolean
}

export function shouldRefreshTcgCatalog(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'tcgplayer_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= TCG_CATALOG_INTERVAL_MS
}

/** The 1000px photo for a catalog image URL (which points at the 200px one). */
export function largeImageUrl(imageUrl: string): string | null {
  const m = /^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_[^/]*\.jpg$/.exec(imageUrl)
  return m ? `${TCGPLAYER_IMAGE_PREFIX}${m[1]}_in_1000x1000.jpg` : null
}

/** Never rejects. Refetches only groups TCGCSV marks as changed since the last run. */
export async function refreshTcgCatalog(
  db: Database.Database,
  opts: { version: string; fetchFn?: typeof fetch; now?: Date }
): Promise<TcgCatalogResult> {
  const result: TcgCatalogResult = { groups: 0, updatedGroups: 0, failedGroups: 0, ok: false }
  const fetchFn = opts.fetchFn ?? fetch
  const headers = { 'User-Agent': `YugiohCollectionTracker/${opts.version} (${REPO_URL})` }
  const getJson = async <T>(url: string): Promise<T[]> => {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { success?: boolean; results?: T[] }
    if (!Array.isArray(body.results)) throw new Error('invalid response')
    return body.results
  }

  let groups: Group[]
  try {
    groups = (await getJson<Group>(`${BASE_URL}/groups`)).filter(
      (g) => Number.isSafeInteger(g.groupId) && typeof g.modifiedOn === 'string'
    )
  } catch (e) {
    console.warn('TCGplayer catalog listing failed:', e instanceof Error ? e.message : String(e))
    return result
  }
  if (groups.length === 0) return result
  result.groups = groups.length

  const stored = new Map(
    (
      db.prepare('SELECT group_id, modified_on FROM tcgplayer_groups').all() as {
        group_id: number
        modified_on: string
      }[]
    ).map((r) => [r.group_id, r.modified_on])
  )
  const changed = groups.filter((g) => stored.get(g.groupId) !== g.modifiedOn)

  const delProducts = db.prepare('DELETE FROM tcgplayer_products WHERE group_id = ?')
  const insProduct = db.prepare(
    `INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, number, rarity, image_url)
     VALUES (?, ?, ?, ?, ?)`
  )
  const saveGroup = db.prepare(
    `INSERT INTO tcgplayer_groups (group_id, modified_on) VALUES (?, ?)
     ON CONFLICT(group_id) DO UPDATE SET modified_on = excluded.modified_on`
  )

  const limit = createLimiter({ concurrency: 4, minIntervalMs: 50 })
  await Promise.all(
    changed.map((g) =>
      limit(async () => {
        let products: Product[]
        try {
          products = await getJson<Product>(`${BASE_URL}/${g.groupId}/products`)
        } catch {
          result.failedGroups++
          return
        }
        db.transaction(() => {
          delProducts.run(g.groupId)
          for (const p of products) {
            const ext = new Map((p.extendedData ?? []).map((d) => [d.name, d.value]))
            const number = ext.get('Number')?.trim()
            const image = p.imageCount !== 0 && p.imageUrl ? largeImageUrl(p.imageUrl) : null
            if (!Number.isSafeInteger(p.productId) || !number || !image) continue
            insProduct.run(p.productId, g.groupId, number, ext.get('Rarity')?.trim() ?? '', image)
          }
          saveGroup.run(g.groupId, g.modifiedOn)
        })()
        result.updatedGroups++
      })
    )
  )

  const listed = new Set(groups.map((g) => g.groupId))
  db.transaction(() => {
    for (const id of stored.keys()) {
      if (listed.has(id)) continue
      delProducts.run(id)
      db.prepare('DELETE FROM tcgplayer_groups WHERE group_id = ?').run(id)
    }
  })()

  result.ok = result.failedGroups === 0
  if (result.ok) setMeta(db, 'tcgplayer_synced_at', (opts.now ?? new Date()).toISOString())
  console.info(
    `TCGplayer catalog: ${result.updatedGroups} of ${groups.length} sets updated` +
      (result.failedGroups > 0 ? `, ${result.failedGroups} failed` : '')
  )
  return result
}

const rarityKey = (r: string): string => r.toLowerCase().replace(/[^a-z]/g, '')

/**
 * The TCGplayer photo of an English printing: the product with the same card number and rarity,
 * or the only product with that number when TCGplayer names the rarity differently.
 */
export function createTcgplayerLookup(
  db: Database.Database
): (printingId: number) => string | null {
  const printing = db.prepare(
    "SELECT set_code, set_rarity FROM card_printings WHERE id = ? AND language = 'en'"
  )
  const products = db.prepare(
    'SELECT number, rarity, image_url FROM tcgplayer_products WHERE number = ? COLLATE NOCASE ORDER BY product_id'
  )
  return (printingId) => {
    const p = printing.get(printingId) as { set_code: string; set_rarity: string } | undefined
    if (!p || !p.set_code) return null
    const rows = products.all(p.set_code) as { rarity: string; image_url: string }[]
    const want = rarityKey(p.set_rarity)
    const same = rows.find((r) => rarityKey(r.rarity) === want)
    if (same) return same.image_url
    return rows.length === 1 ? rows[0].image_url : null
  }
}
