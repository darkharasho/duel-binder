import type Database from 'better-sqlite3'
import { TOKEN_ID_MIN } from '../../shared/games/ids'
import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import { canonRarity } from '../ygo/rarity'
import { createLimiter } from '../images/limiter'

/**
 * TCGplayer's Yu-Gi-Oh catalog, read from TCGCSV (a free daily public copy of it). Used only to
 * find the photo of each English printing; the photos themselves load from TCGplayer's image
 * server when shown, and are cached like every other image.
 */
export const TCGCSV_URL = 'https://tcgcsv.com/tcgplayer/2'
const REPO_URL = 'https://github.com/darkharasho/duel-binder'
export const TCGPLAYER_IMAGE_PREFIX = 'https://tcgplayer-cdn.tcgplayer.com/product/'
export const TCG_CATALOG_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 60_000

interface Group {
  groupId: number
  modifiedOn: string
  name?: string
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
  /** English printings added because YGOPRODeck leaves them out (see saveMissingPrintings). */
  addedPrintings: number
  ok: boolean
}

/** Reads a TCGCSV listing's `results`; throws on HTTP errors and malformed bodies. */
export function tcgcsvReader(
  version: string,
  fetchFn: typeof fetch = fetch
): <T>(url: string) => Promise<T[]> {
  const headers = { 'User-Agent': `DuelBinder/${version} (${REPO_URL})` }
  return async <T>(url: string): Promise<T[]> => {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { success?: boolean; results?: T[] }
    if (!Array.isArray(body.results)) throw new Error('invalid response')
    return body.results
  }
}

export function shouldRefreshTcgCatalog(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'tcgplayer_synced_at')
  if (!last) return true
  // Stored before set names were kept: one refresh lists them (unchanged sets aren't refetched).
  if (db.prepare('SELECT 1 FROM tcgplayer_groups WHERE name IS NULL LIMIT 1').get()) return true
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
  const result: TcgCatalogResult = {
    groups: 0,
    updatedGroups: 0,
    failedGroups: 0,
    addedPrintings: 0,
    ok: false
  }
  const getJson = tcgcsvReader(opts.version, opts.fetchFn)

  let groups: Group[]
  try {
    groups = (await getJson<Group>(`${TCGCSV_URL}/groups`)).filter(
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
    `INSERT INTO tcgplayer_groups (group_id, modified_on, name) VALUES (?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET modified_on = excluded.modified_on, name = excluded.name`
  )
  const groupName = (g: Group): string => (typeof g.name === 'string' ? g.name.trim() : '')
  const rename = db.prepare(
    'UPDATE tcgplayer_groups SET name = ? WHERE group_id = ? AND name IS NOT ?'
  )
  db.transaction(() => {
    for (const g of groups) rename.run(groupName(g), g.groupId, groupName(g))
  })()

  const limit = createLimiter({ concurrency: 4, minIntervalMs: 50 })
  await Promise.all(
    changed.map((g) =>
      limit(async () => {
        let products: Product[]
        try {
          products = await getJson<Product>(`${TCGCSV_URL}/${g.groupId}/products`)
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
            insProduct.run(
              p.productId,
              g.groupId,
              number,
              ext.get('Rarity')?.trim() ?? '',
              image,
              name
            )
          }
          saveGroup.run(g.groupId, g.modifiedOn, groupName(g))
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
      db.prepare('DELETE FROM tcgplayer_prices WHERE group_id = ?').run(id)
      db.prepare('DELETE FROM tcgplayer_price_groups WHERE group_id = ?').run(id)
      db.prepare('DELETE FROM tcgplayer_groups WHERE group_id = ?').run(id)
    }
  })()

  result.addedPrintings = saveTcgVariants(db).added
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
  return notes.map((n) => (/^extended art$/i.test(n) ? 'Overframe' : canonRarity(n))).join(', ')
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
function sameRarity<T extends ProductRow>(rows: T[], rarity: string): T[] {
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
 * (an overframe-only Starlight Rare) gets that variant in card_printings.variant. Also adds the
 * English printings YGOPRODeck leaves out (see saveMissingPrintings). `added` counts new rows from
 * the latter.
 */
export function saveTcgVariants(db: Database.Database): { saved: number; added: number } {
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
     WHERE game = 'ygo' AND language = 'en' AND tcg_product_id IS NULL AND set_code = ? COLLATE NOCASE`
  )
  const upsert = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
       missing_from_api, language, tcg_product_id)
     VALUES (?, ?, ?, ?, ?, NULL, 0, 'en', ?)
     ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en' DO UPDATE SET
       set_name = excluded.set_name, missing_from_api = 0, tcg_product_id = excluded.tcg_product_id
     RETURNING id`
  )
  type Base = {
    card_id: number
    set_name: string
    set_code: string
    set_rarity: string
    set_rarity_code: string
  }
  const seen = new Set<number>()
  let added = 0
  db.transaction(() => {
    added = saveMissingPrintings(db, seen)
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
        const rarity = canonRarity(`${base.set_rarity} (${label})`)
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
    const plain = db
      .prepare(
        `SELECT id, set_code, set_rarity, variant FROM card_printings
       WHERE game = 'ygo' AND language = 'en' AND tcg_product_id IS NULL AND set_code <> ''
         AND card_id < ${TOKEN_ID_MIN}` // the token sync names these from their scans
      )
      .all() as { id: number; set_code: string; set_rarity: string; variant: string | null }[]
    for (const p of plain) {
      const own = sameRarity(products.all(p.set_code) as ProductRow[], p.set_rarity)[0]
      const label = own ? variantLabel(own.name, own.rarity) : ''
      const variant = label && label.split(', ').every((n) => ART_NOTE.test(n)) ? label : null
      if (variant !== p.variant) labelled.run(variant, p.id)
    }
    const stale = (
      db
        .prepare("SELECT id FROM card_printings WHERE game = 'ygo' AND tcg_product_id IS NOT NULL")
        .all() as {
        id: number
      }[]
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
  return { saved: seen.size, added }
}

/** Language letters of the same printing in other countries ("SR14-DE023" for "SR14-EN023"). */
const OTHER_LANGUAGES = ['DE', 'FR', 'IT', 'PT', 'SP', 'JP', 'KR', 'AE']
const ENGLISH_CODE = /^([A-Z0-9]+)-EN([A-Z]?\d+)$/

/**
 * Adds the English printings TCGplayer sells under a card number no YGOPRODeck printing has
 * (YGOPRODeck files a few, like Droll & Lock Bird's SR14-EN023, under an alternate-art id and leaves
 * them off the card). The card is the one TCGplayer's name (minus its notes) or the same number in
 * another language points to; numbers that point to no card or to two are skipped. The set is the
 * one the other cards of that set code are in, else TCGplayer's set name. Each rarity's plain
 * product becomes the printing and its other products art variants, as in saveTcgVariants.
 * Adds every printing's id to `seen`; returns how many rows are new.
 */
function saveMissingPrintings(db: Database.Database, seen: Set<number>): number {
  const known = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT upper(set_code) AS code FROM card_printings WHERE game = 'ygo' AND language = 'en' AND tcg_product_id IS NULL"
        )
        .all() as { code: string }[]
    ).map((r) => r.code)
  )
  const rows = db
    .prepare(
      `SELECT p.product_id, p.number, p.rarity, p.name, p.image_url, g.name AS group_name
       FROM tcgplayer_products p JOIN tcgplayer_groups g ON g.group_id = p.group_id
       ORDER BY p.product_id`
    )
    .all() as (ProductRow & { number: string; group_name: string | null })[]
  const byCode = new Map<string, typeof rows>()
  for (const r of rows) {
    const code = r.number.toUpperCase()
    if (!ENGLISH_CODE.test(code) || known.has(code) || !r.rarity) continue
    byCode.set(code, [...(byCode.get(code) ?? []), r])
  }
  if (byCode.size === 0) return 0

  const named = db.prepare("SELECT id FROM cards WHERE game = 'ygo' AND name = ? COLLATE NOCASE")
  const abroad = db.prepare(
    `SELECT DISTINCT card_id FROM card_printings
     WHERE game = 'ygo' AND language <> 'en' AND set_code IN (${OTHER_LANGUAGES.map(() => '?').join(', ')}) COLLATE NOCASE`
  )
  const setNames = db.prepare(
    "SELECT DISTINCT set_name FROM card_printings WHERE game = 'ygo' AND language = 'en' AND set_code LIKE ? AND set_name <> ''"
  )
  const rarityCodes = new Map(
    (
      db
        .prepare(
          `SELECT set_rarity, set_rarity_code FROM card_printings
           WHERE game = 'ygo' AND language = 'en' AND set_rarity_code <> ''
           GROUP BY set_rarity, set_rarity_code ORDER BY count(*)`
        )
        .all() as { set_rarity: string; set_rarity_code: string }[]
    ).map((r) => [r.set_rarity, r.set_rarity_code])
  )
  const existing = db.prepare(
    "SELECT 1 FROM card_printings WHERE game = 'ygo' AND language = 'en' AND card_id = ? AND set_code = ? AND set_rarity = ?"
  )
  const upsert = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
       missing_from_api, language, tcg_product_id, variant)
     VALUES (?, ?, ?, ?, ?, NULL, 0, 'en', ?, ?)
     ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en' DO UPDATE SET
       set_name = excluded.set_name, missing_from_api = 0, tcg_product_id = excluded.tcg_product_id,
       variant = excluded.variant
     RETURNING id`
  )

  let added = 0
  for (const [code, products] of byCode) {
    const [, prefix, number] = ENGLISH_CODE.exec(code) as RegExpExecArray
    const cards = new Set<number>()
    const name = products[0].name.replace(/\s*\([^()]*\)/g, '').trim()
    for (const c of named.all(name) as { id: number }[]) cards.add(c.id)
    const others = OTHER_LANGUAGES.map((l) => `${prefix}-${l}${number}`)
    for (const c of abroad.all(...others) as { card_id: number }[]) cards.add(c.card_id)
    if (cards.size !== 1) continue
    const [cardId] = cards

    const sets = (setNames.all(`${prefix}-EN%`) as { set_name: string }[]).map((r) => r.set_name)
    const setName = sets.length === 1 ? sets[0] : products[0].group_name
    if (!setName) continue

    for (const rarity of new Set(products.map((p) => p.rarity))) {
      const [plain, ...variants] = sameRarity(products, rarity)
      const own = variantLabel(plain.name, plain.rarity)
      // The plain product sorts first, so a misprint here means every product is one.
      if (/misprint/i.test(own)) continue
      const save = (rawRarity: string, productId: number, variant: string | null): void => {
        const setRarity = canonRarity(rawRarity)
        if (!existing.get(cardId, code, setRarity)) added++
        const row = upsert.get(
          cardId,
          setName,
          code,
          setRarity,
          rarityCodes.get(rarity) ?? '',
          productId,
          variant
        ) as { id: number }
        seen.add(row.id)
      }
      save(
        rarity,
        plain.product_id,
        own && own.split(', ').every((n) => ART_NOTE.test(n)) ? own : null
      )
      const used = new Set([rarity])
      for (const v of variants) {
        const label = variantLabel(v.name, v.rarity)
        if (!label || /misprint/i.test(label)) continue
        const setRarity = `${rarity} (${label})`
        if (used.has(setRarity)) continue
        used.add(setRarity)
        save(setRarity, v.product_id, null)
      }
    }
  }
  return added
}

/** A name's letters and digits, as a product's name holds a card's name with other words around it. */
const foldName = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export interface TcgProductMatch {
  product_id: number
  group_id: number
  image_url: string
  exact: boolean
}

/**
 * The TCGplayer product of an English printing: its own product for an art variant; otherwise the
 * plain product with the same card number and rarity. Failing those (`exact: false`), the only
 * product with that number when TCGplayer names the rarity differently, or the plain product of
 * the "Prismatic" form of this printing's rarity ("Prismatic Collector's Rare" for "Collector's Rare").
 * A code listed under two cards is one card's and a mistake on the other, so there the number isn't
 * enough: only a product named for the card is its own, and without one it has no product.
 */
export function createTcgProductResolver(
  db: SqlDb
): (printingId: number) => TcgProductMatch | null {
  const printing = db.prepare(
    `SELECT p.set_code, p.set_rarity, p.tcg_product_id, c.name FROM card_printings p
     JOIN cards c ON c.id = p.card_id WHERE p.id = ? AND p.language = 'en'`
  )
  const sharedCode = db.prepare(
    `SELECT 1 FROM card_printings p WHERE p.set_code = ? COLLATE NOCASE AND p.language = 'en' AND p.card_id <> (
       SELECT card_id FROM card_printings WHERE id = ?
     ) LIMIT 1`
  )
  const byId = db.prepare(
    'SELECT product_id, group_id, image_url FROM tcgplayer_products WHERE product_id = ?'
  )
  const products = db.prepare(
    `SELECT product_id, group_id, rarity, name, image_url FROM tcgplayer_products
     WHERE number = ? COLLATE NOCASE ORDER BY product_id`
  )
  return (printingId) => {
    const p = printing.get(printingId) as
      | { set_code: string; set_rarity: string; tcg_product_id: number | null; name: string }
      | undefined
    if (!p || !p.set_code) return null
    if (p.tcg_product_id !== null) {
      const own = byId.get(p.tcg_product_id) as Omit<TcgProductMatch, 'exact'> | undefined
      return own ? { ...own, exact: true } : null
    }
    const listed = products.all(p.set_code) as (ProductRow & { group_id: number })[]
    const rows = sharedCode.get(p.set_code, printingId)
      ? listed.filter((r) => foldName(r.name).includes(foldName(p.name)))
      : listed
    const pick = (r: ProductRow & { group_id: number }, exact: boolean): TcgProductMatch => ({
      product_id: r.product_id,
      group_id: r.group_id,
      image_url: r.image_url,
      exact
    })
    const same = sameRarity(rows, p.set_rarity)[0]
    if (same) return pick(same, true)
    if (rows.length === 1) return pick(rows[0], false)
    // A rarity of two words or more ("Collector's Rare"), sold as its Prismatic form.
    if (/\s/.test(p.set_rarity.trim())) {
      const prismatic = sameRarity(rows, `Prismatic ${p.set_rarity}`)[0]
      if (prismatic) return pick(prismatic, false)
    }
    return null
  }
}

/** The TCGplayer photo of an English printing (see createTcgProductResolver). */
export function createTcgplayerLookup(db: SqlDb): (printingId: number) => string | null {
  const resolve = createTcgProductResolver(db)
  return (printingId) => resolve(printingId)?.image_url ?? null
}
