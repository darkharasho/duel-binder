import type { SqlDb } from '../db/sql'
import { RARITY_LABEL } from '../db/schema'
import { MAX_NOTES } from '../../shared/cloud'
import { LANGUAGES } from '../../shared/languages'
import { priceFor } from '../../shared/pricing'
import type { AddEntryInput, CollectionFilters, EntryView, Facets, UpdateEntryInput } from '../../shared/types'
import { getMeta } from '../db/meta'
import { LOCAL, type Scope } from './scope'
import { buildFtsQuery, rowToCard, rowToPrinting, type CardDbRow, type PrintingDbRow } from './cards'

export class CollectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CollectionError'
  }
}

interface EntryDbRow {
  e_id: number
  e_quantity: number
  e_notes: string
  e_created_at: string
  e_updated_at: string
  e_image_id: number
  [col: string]: unknown
}

const SELECT = `
  SELECT e.id AS e_id, e.quantity AS e_quantity, e.notes AS e_notes, e.created_at AS e_created_at,
         e.updated_at AS e_updated_at, e.image_id AS e_image_id,
         e.image_id IS (SELECT ci.image_id FROM card_images ci WHERE ci.card_id = c.id
                        ORDER BY ci.sort_order, ci.image_id LIMIT 1) AS e_original_art,
         c.id AS id, c.name, c.type, c.frame_type, c.race, c.attribute, c.level, c.linkval, c.atk, c.def,
         c.archetype, c.desc, c.tcgplayer_price,
         p.id AS p_id, p.card_id, p.set_name, p.set_code, ${RARITY_LABEL} AS set_rarity, p.set_rarity_code, p.set_price,
         p.market_price,
         p.missing_from_api, p.language,
         ip.printing_id AS ip_id, ip.price AS ip_price, ip.checked_at AS ip_checked_at,
         ip.listing_count AS ip_listing_count
  FROM collection_entries e
  JOIN card_printings p ON p.id = e.printing_id
  JOIN cards c ON c.id = p.card_id
  LEFT JOIN intl_prices ip ON ip.printing_id = p.id`

function toView(r: EntryDbRow, priceStatus: string | null): EntryView {
  const card = rowToCard(r as unknown as CardDbRow)
  const printing = rowToPrinting({ ...(r as unknown as PrintingDbRow), id: r.p_id as number })
  const english = printing.language === 'en'
  const hasRow = r.ip_id !== null && r.ip_id !== undefined
  const ebayPrice = hasRow ? (r.ip_price as number | null) : null
  // English uses the printing's TCGplayer market price, then its eBay asking price, then YGOPRODeck.
  // intl_prices holds eBay prices for every language; non-English never falls back to an English price.
  const market = english ? ((r.market_price as number | null) ?? null) : null
  const ebay = market === null && (english ? ebayPrice !== null : true)
  let unitPrice: number | null
  let approximate: boolean
  let noPriceReason: EntryView['noPriceReason'] = null
  if (market !== null) {
    unitPrice = market
    approximate = false
  } else if (ebay) {
    unitPrice = ebayPrice
    approximate = false
    if (unitPrice === null)
      noPriceReason = hasRow ? 'no-listings' : priceStatus === 'ok' ? 'pending' : 'unavailable'
  } else {
    ;({ unitPrice, approximate } = priceFor(r.set_price as number | null, card.tcgplayerPrice))
  }
  return {
    id: r.e_id,
    quantity: r.e_quantity,
    notes: r.e_notes,
    createdAt: r.e_created_at,
    updatedAt: r.e_updated_at,
    card,
    printing,
    imageId: r.e_image_id,
    originalArt: r.e_original_art === 1,
    unitPrice,
    priceApproximate: approximate,
    priceSource: market !== null ? 'tcgplayer' : ebay ? 'ebay' : 'ygoprodeck',
    priceCheckedAt: ebay ? ((r.ip_checked_at as string | null) ?? null) : null,
    priceListingCount: ebay ? ((r.ip_listing_count as number | null) ?? null) : null,
    noPriceReason,
    totalValue: (unitPrice ?? 0) * r.e_quantity
  }
}

export function getEntry(db: SqlDb, id: number, scope: Scope = LOCAL): EntryView | null {
  const row = db.prepare(`${SELECT} WHERE e.id = ? AND ${scope.where('e')}`).get(id) as EntryDbRow | undefined
  return row ? toView(row, getMeta(db, 'price_service_status')) : null
}

function requireEntry(db: SqlDb, id: number, scope: Scope): EntryView {
  const e = getEntry(db, id, scope)
  if (!e) throw new CollectionError(`Entry ${id} not found`)
  return e
}

function assertQuantity(q: number): void {
  if (!Number.isInteger(q) || q < 1) throw new CollectionError('Quantity must be a whole number of at least 1')
}

function assertLink(db: SqlDb, printingId: number, imageId: number): void {
  const p = db.prepare('SELECT card_id FROM card_printings WHERE id = ?').get(printingId) as
    | { card_id: number }
    | undefined
  if (!p) throw new CollectionError(`Printing ${printingId} not found`)
  const img = db.prepare('SELECT card_id FROM card_images WHERE image_id = ?').get(imageId) as
    | { card_id: number }
    | undefined
  if (!img || img.card_id !== p.card_id) throw new CollectionError('Image does not belong to the printing’s card')
}

const findExisting = (db: SqlDb, printingId: number, imageId: number, scope: Scope): number | undefined =>
  (
    db
      .prepare(
        `SELECT e.id FROM collection_entries e WHERE e.printing_id = ? AND e.image_id = ? AND ${scope.where('e')}`
      )
      .get(printingId, imageId) as { id: number } | undefined
  )?.id

export function addEntry(db: SqlDb, input: AddEntryInput, now = new Date(), scope: Scope = LOCAL): EntryView {
  assertQuantity(input.quantity)
  assertLink(db, input.printingId, input.imageId)
  const ts = now.toISOString()
  return db.transaction(() => {
    const existing = findExisting(db, input.printingId, input.imageId, scope)
    if (existing !== undefined) {
      db.prepare(`UPDATE collection_entries SET quantity = quantity + ?, updated_at = ?, ${scope.touch} WHERE id = ?`).run(
        input.quantity,
        ts,
        existing
      )
      return requireEntry(db, existing, scope)
    }
    const id = scope.insertEntry(db, {
      printingId: input.printingId,
      imageId: input.imageId,
      quantity: input.quantity,
      notes: '',
      ts
    })
    return requireEntry(db, id, scope)
  })()
}

export function updateEntry(
  db: SqlDb,
  id: number,
  patch: UpdateEntryInput,
  now = new Date(),
  scope: Scope = LOCAL
): EntryView {
  const ts = now.toISOString()
  return db.transaction(() => {
    const cur = requireEntry(db, id, scope)
    const quantity = patch.quantity ?? cur.quantity
    const notes = patch.notes ?? cur.notes
    const printingId = patch.printingId ?? cur.printing.id
    const imageId = patch.imageId ?? cur.imageId
    assertQuantity(quantity)
    assertLink(db, printingId, imageId)

    const target = findExisting(db, printingId, imageId, scope)
    if (target !== undefined && target !== id) {
      const t = requireEntry(db, target, scope)
      // Capped so the merge never exceeds what a write may store (and sync would otherwise truncate).
      const joined = [t.notes, notes].filter((n) => n !== '').join('\n').slice(0, MAX_NOTES)
      scope.deleteEntry(db, id, ts)
      db.prepare(`UPDATE collection_entries SET quantity = ?, notes = ?, updated_at = ?, ${scope.touch} WHERE id = ?`).run(
        t.quantity + quantity,
        joined,
        ts,
        target
      )
      return requireEntry(db, target, scope)
    }
    db.prepare(
      `UPDATE collection_entries SET printing_id = ?, image_id = ?, quantity = ?, notes = ?, updated_at = ?, ${scope.touch}
       WHERE id = ?`
    ).run(printingId, imageId, quantity, notes, ts, id)
    return requireEntry(db, id, scope)
  })()
}

export function removeEntry(db: SqlDb, id: number, now = new Date(), scope: Scope = LOCAL): void {
  scope.deleteEntry(db, id, now.toISOString())
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function listEntries(db: SqlDb, f: CollectionFilters, scope: Scope = LOCAL): EntryView[] {
  const where: string[] = [scope.where('e')]
  const params: unknown[] = []
  const inList = (col: string, values?: string[]): void => {
    if (values?.length) {
      where.push(`${col} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
  }
  const text = f.q?.trim()
  if (text) {
    const fts = buildFtsQuery(text)
    const parts = [`p.set_code LIKE ? ESCAPE '\\'`]
    params.push(`${escapeLike(text)}%`)
    if (fts) {
      parts.push('c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)')
      params.push(fts)
    }
    where.push(`(${parts.join(' OR ')})`)
  }
  inList('c.type', f.cardTypes)
  inList('c.attribute', f.attributes)
  inList('c.archetype', f.archetypes)
  inList('p.set_name', f.setNames)
  inList('p.set_rarity', f.rarities)
  if (f.language) {
    where.push('p.language = ?')
    params.push(f.language)
  }
  if (f.levelMin !== undefined) {
    where.push('COALESCE(c.level, c.linkval) >= ?')
    params.push(f.levelMin)
  }
  if (f.levelMax !== undefined) {
    where.push('COALESCE(c.level, c.linkval) <= ?')
    params.push(f.levelMax)
  }
  const status = getMeta(db, 'price_service_status')
  const sql = `${SELECT} WHERE ${where.join(' AND ')}`
  const entries = (db.prepare(sql).all(...params) as EntryDbRow[]).map((r) => toView(r, status))

  const dir = f.dir === 'desc' ? -1 : 1
  const key = (e: EntryView): number | string => {
    switch (f.sort) {
      case 'value':
        return e.totalValue
      case 'quantity':
        return e.quantity
      case 'added':
        return e.createdAt
      default:
        return e.card.name.toLowerCase()
    }
  }
  return entries.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    const primary = ka < kb ? -1 : ka > kb ? 1 : 0
    if (primary !== 0) return primary * dir
    return a.card.name.localeCompare(b.card.name) || a.id - b.id
  })
}

export function entriesForCard(db: SqlDb, cardId: number, scope: Scope = LOCAL): EntryView[] {
  const status = getMeta(db, 'price_service_status')
  return (
    db.prepare(`${SELECT} WHERE c.id = ? AND ${scope.where('e')} ORDER BY p.set_code, e.id`).all(cardId) as EntryDbRow[]
  ).map((r) => toView(r, status))
}

export function getFacets(db: SqlDb, scope: Scope = LOCAL): Facets {
  const distinct = (col: string): string[] =>
    (
      db
        .prepare(
          `SELECT DISTINCT ${col} AS v FROM collection_entries e
           JOIN card_printings p ON p.id = e.printing_id JOIN cards c ON c.id = p.card_id
           WHERE ${scope.where('e')} AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`
        )
        .all() as { v: string }[]
    ).map((r) => r.v)
  const owned = new Set(distinct('p.language'))
  return {
    cardTypes: distinct('c.type'),
    attributes: distinct('c.attribute'),
    archetypes: distinct('c.archetype'),
    setNames: distinct('p.set_name'),
    rarities: distinct('p.set_rarity'),
    languages: LANGUAGES.map((l) => l.code).filter((code) => owned.has(code))
  }
}
