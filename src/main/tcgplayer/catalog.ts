import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import { createLimiter } from '../images/limiter'

/**
 * TCGplayer's Yu-Gi-Oh catalog, read from TCGCSV (a free daily public copy of it). Used only to
 * find the photo of each English printing; the photos themselves load from TCGplayer's image
 * server when shown, and are cached like every other image.
 */
const BASE_URL = 'https://tcgcsv.com/tcgplayer/2'
const REPO_URL = 'https://github.com/darkharasho/duel-binder'
export const TCGPLAYER_IMAGE_PREFIX = 'https://tcgplayer-cdn.tcgplayer.com/product/'
export const TCG_CATALOG_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 60_000

interface Group {
  groupId: number
  modifiedOn: string
}

interface Product {
  productId: number
  name?: string
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
  const headers = { 'User-Agent': `DuelBinder/${opts.version} (${REPO_URL})` }
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
    `INSERT OR REPLACE INTO tcgplayer_products (product_id, group_id, number, rarity, image_url, name)
     VALUES (?, ?, ?, ?, ?, ?)`
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
            const name = typeof p.name === 'string' ? p.name.trim() : ''
            insProduct.run(p.productId, g.groupId, number, ext.get('Rarity')?.trim() ?? '', image, name)
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

  saveTcgVariants(db)
  result.ok = result.failedGroups === 0
  if (result.ok) setMeta(db, 'tcgplayer_synced_at', (opts.now ?? new Date()).toISOString())
  console.info(
    `TCGplayer catalog: ${result.updatedGroups} of ${groups.length} sets updated` +
      (result.failedGroups > 0 ? `, ${result.failedGroups} failed` : '')
  )
  return result
}

const rarityKey = (r: string): string => r.toLowerCase().replace(/[^a-z]/g, '')
const initials = (r: string): string =>
  r
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toLowerCase()

/**
 * What sets a product apart from the plain card: its parenthesised notes, minus the rarity
 * itself ("Starlight Rare", "UR", or a trailing "Secret Rare" as in "Emblazoned Secret Rare").
 * "" for the plain card.
 */
export function variantLabel(name: string, rarity: string): string {
  const want = rarityKey(rarity)
  const notes: string[] = []
  for (const m of name.matchAll(/\(([^()]+)\)/g)) {
    const note = m[1].trim()
    const key = rarityKey(note)
    if (key === want || key === initials(rarity)) continue
    if (want && key.endsWith(want)) {
      const rest = note.slice(0, note.length - rarity.length).trim()
      if (rest && rarityKey(note.slice(rest.length)) === want) {
        notes.push(rest)
        continue
      }
    }
    notes.push(note)
  }
  // TCGplayer's "Extended Art" is the card art running over the frame: an overframe.
  return notes.map((n) => (/^extended art$/i.test(n) ? 'Overframe' : n)).join(', ')
}

/**
 * Notes that describe a card's look. Only these label a YGOPRODeck printing from its single
 * product; other notes there are rarity abbreviations ("UTR"), codes, or where a promo came from.
 */
const ART_NOTE =
  /^(overframe|alternate art|new art|\d+(st|nd|rd|th) art|.*artwork|emblazoned.*|red|blue|green|purple|silver|bronze|gold|yellow|orange|pink|white)$/i

interface ProductRow {
  product_id: number
  rarity: string
  name: string
  image_url: string
}

/** Same-rarity products, the plain one (no variant label) first, then by product id. */
function sameRarity(rows: ProductRow[], rarity: string): ProductRow[] {
  const want = rarityKey(rarity)
  return rows
    .filter((r) => rarityKey(r.rarity) === want)
    .map((r) => ({ r, plain: variantLabel(r.name, r.rarity) === '' }))
    .sort((a, b) => Number(b.plain) - Number(a.plain) || a.r.product_id - b.r.product_id)
    .map((x) => x.r)
}

/**
 * Adds a printing for each art variant TCGplayer lists beside a printing YGOPRODeck has
 * (an overframe Ultra Rare next to the plain one, the colours of a Legendary Duelists foil),
 * named "<rarity> (<variant>)". Variants gone from the catalog are removed, or flagged missing
 * when owned. Misprints are left out. A YGOPRODeck printing whose own product is itself a variant
 * (an overframe-only Starlight Rare) gets that variant in card_printings.variant.
 */
export function saveTcgVariants(db: Database.Database): number {
  const groups = db
    .prepare(
      `SELECT number, rarity FROM tcgplayer_products
       GROUP BY number COLLATE NOCASE, rarity HAVING count(*) > 1`
    )
    .all() as { number: string; rarity: string }[]
  const products = db.prepare(
    'SELECT product_id, rarity, name, image_url FROM tcgplayer_products WHERE number = ? COLLATE NOCASE'
  )
  const printings = db.prepare(
    `SELECT card_id, set_name, set_code, set_rarity, set_rarity_code FROM card_printings
     WHERE language = 'en' AND tcg_product_id IS NULL AND set_code = ? COLLATE NOCASE`
  )
  const upsert = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
       missing_from_api, language, tcg_product_id)
     VALUES (?, ?, ?, ?, ?, NULL, 0, 'en', ?)
     ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en' DO UPDATE SET
       set_name = excluded.set_name, missing_from_api = 0, tcg_product_id = excluded.tcg_product_id
     RETURNING id`
  )
  type Base = { card_id: number; set_name: string; set_code: string; set_rarity: string; set_rarity_code: string }
  const seen = new Set<number>()
  db.transaction(() => {
    for (const g of groups) {
      const bases = (printings.all(g.number) as Base[]).filter(
        (p) => rarityKey(p.set_rarity) === rarityKey(g.rarity)
      )
      // Two cards under one code and rarity: no telling which variant is whose.
      if (bases.length !== 1) continue
      const [base] = bases
      const [, ...variants] = sameRarity(products.all(g.number) as ProductRow[], g.rarity)
      const used = new Set<string>()
      for (const v of variants) {
        const label = variantLabel(v.name, v.rarity)
        if (!label || /misprint/i.test(label)) continue
        const rarity = `${base.set_rarity} (${label})`
        if (used.has(rarity)) continue
        used.add(rarity)
        const row = upsert.get(
          base.card_id,
          base.set_name,
          base.set_code,
          rarity,
          base.set_rarity_code,
          v.product_id
        ) as { id: number }
        seen.add(row.id)
      }
    }
    const labelled = db.prepare('UPDATE card_printings SET variant = ? WHERE id = ?')
    const plain = db.prepare(
      `SELECT id, set_code, set_rarity, variant FROM card_printings
       WHERE language = 'en' AND tcg_product_id IS NULL AND set_code <> ''`
    ).all() as { id: number; set_code: string; set_rarity: string; variant: string | null }[]
    for (const p of plain) {
      const own = sameRarity(products.all(p.set_code) as ProductRow[], p.set_rarity)[0]
      const label = own ? variantLabel(own.name, own.rarity) : ''
      const variant = label && label.split(', ').every((n) => ART_NOTE.test(n)) ? label : null
      if (variant !== p.variant) labelled.run(variant, p.id)
    }
    const stale = (
      db.prepare("SELECT id FROM card_printings WHERE tcg_product_id IS NOT NULL").all() as { id: number }[]
    ).filter((r) => !seen.has(r.id))
    const del = db.prepare(
      `DELETE FROM card_printings WHERE id = ? AND NOT EXISTS
         (SELECT 1 FROM collection_entries WHERE printing_id = card_printings.id)`
    )
    const flag = db.prepare('UPDATE card_printings SET missing_from_api = 1 WHERE id = ?')
    for (const { id } of stale) {
      del.run(id)
      flag.run(id)
    }
  })()
  return seen.size
}

/**
 * The TCGplayer photo of an English printing: its own product for an art variant; otherwise the
 * plain product with the same card number and rarity, or the only product with that number when
 * TCGplayer names the rarity differently.
 */
export function createTcgplayerLookup(
  db: SqlDb
): (printingId: number) => string | null {
  const printing = db.prepare(
    "SELECT set_code, set_rarity, tcg_product_id FROM card_printings WHERE id = ? AND language = 'en'"
  )
  const byId = db.prepare('SELECT image_url FROM tcgplayer_products WHERE product_id = ?')
  const products = db.prepare(
    'SELECT product_id, rarity, name, image_url FROM tcgplayer_products WHERE number = ? COLLATE NOCASE ORDER BY product_id'
  )
  return (printingId) => {
    const p = printing.get(printingId) as
      | { set_code: string; set_rarity: string; tcg_product_id: number | null }
      | undefined
    if (!p || !p.set_code) return null
    if (p.tcg_product_id !== null)
      return (byId.get(p.tcg_product_id) as { image_url: string } | undefined)?.image_url ?? null
    const rows = products.all(p.set_code) as ProductRow[]
    const same = sameRarity(rows, p.set_rarity)[0]
    if (same) return same.image_url
    return rows.length === 1 ? rows[0].image_url : null
  }
}
