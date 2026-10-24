import type Database from 'better-sqlite3'
import { priceFor } from '../../shared/pricing'
import type { AddEntryInput, CollectionFilters, EntryView, Facets, UpdateEntryInput } from '../../shared/types'
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
         c.id AS id, c.name, c.type, c.frame_type, c.race, c.attribute, c.level, c.linkval, c.atk, c.def,
         c.archetype, c.desc, c.tcgplayer_price,
         p.id AS p_id, p.card_id, p.set_name, p.set_code, p.set_rarity, p.set_rarity_code, p.set_price,
         p.missing_from_api, p.language
  FROM collection_entries e
  JOIN card_printings p ON p.id = e.printing_id
  JOIN cards c ON c.id = p.card_id`

function toView(r: EntryDbRow): EntryView {
  const card = rowToCard(r as unknown as CardDbRow)
  const printing = rowToPrinting({ ...(r as unknown as PrintingDbRow), id: r.p_id as number })
  const { unitPrice, approximate } = priceFor(printing.setPrice, card.tcgplayerPrice)
  return {
    id: r.e_id,
    quantity: r.e_quantity,
    notes: r.e_notes,
    createdAt: r.e_created_at,
    updatedAt: r.e_updated_at,
    card,
    printing,
    imageId: r.e_image_id,
    unitPrice,
    priceApproximate: approximate,
    totalValue: (unitPrice ?? 0) * r.e_quantity
  }
}

export function getEntry(db: Database.Database, id: number): EntryView | null {
  const row = db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as EntryDbRow | undefined
  return row ? toView(row) : null
}

function requireEntry(db: Database.Database, id: number): EntryView {
  const e = getEntry(db, id)
  if (!e) throw new CollectionError(`Entry ${id} not found`)
  return e
}

function assertQuantity(q: number): void {
  if (!Number.isInteger(q) || q < 1) throw new CollectionError('Quantity must be a whole number of at least 1')
}

function assertLink(db: Database.Database, printingId: number, imageId: number): void {
  const p = db.prepare('SELECT card_id FROM card_printings WHERE id = ?').get(printingId) as
    | { card_id: number }
    | undefined
  if (!p) throw new CollectionError(`Printing ${printingId} not found`)
  const img = db.prepare('SELECT card_id FROM card_images WHERE image_id = ?').get(imageId) as
    | { card_id: number }
    | undefined
  if (!img || img.card_id !== p.card_id) throw new CollectionError('Image does not belong to the printing’s card')
}

const findExisting = (db: Database.Database, printingId: number, imageId: number): number | undefined =>
  (
    db.prepare('SELECT id FROM collection_entries WHERE printing_id = ? AND image_id = ?').get(printingId, imageId) as
      | { id: number }
      | undefined
  )?.id

export function addEntry(db: Database.Database, input: AddEntryInput, now = new Date()): EntryView {
  assertQuantity(input.quantity)
  assertLink(db, input.printingId, input.imageId)
  const ts = now.toISOString()
  return db.transaction(() => {
    const existing = findExisting(db, input.printingId, input.imageId)
    if (existing !== undefined) {
      db.prepare('UPDATE collection_entries SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(
        input.quantity,
        ts,
        existing
      )
      return requireEntry(db, existing)
    }
    const info = db
      .prepare(
        'INSERT INTO collection_entries (printing_id, image_id, quantity, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(input.printingId, input.imageId, input.quantity, '', ts, ts)
    return requireEntry(db, Number(info.lastInsertRowid))
  })()
}

export function updateEntry(db: Database.Database, id: number, patch: UpdateEntryInput, now = new Date()): EntryView {
  const ts = now.toISOString()
  return db.transaction(() => {
    const cur = requireEntry(db, id)
    const quantity = patch.quantity ?? cur.quantity
    const notes = patch.notes ?? cur.notes
    const printingId = patch.printingId ?? cur.printing.id
    const imageId = patch.imageId ?? cur.imageId
    assertQuantity(quantity)
    assertLink(db, printingId, imageId)

    const target = findExisting(db, printingId, imageId)
    if (target !== undefined && target !== id) {
      const t = requireEntry(db, target)
      const joined = [t.notes, notes].filter((n) => n !== '').join('\n')
      db.prepare('DELETE FROM collection_entries WHERE id = ?').run(id)
      db.prepare('UPDATE collection_entries SET quantity = ?, notes = ?, updated_at = ? WHERE id = ?').run(
        t.quantity + quantity,
        joined,
        ts,
        target
      )
      return requireEntry(db, target)
    }
    db.prepare(
      'UPDATE collection_entries SET printing_id = ?, image_id = ?, quantity = ?, notes = ?, updated_at = ? WHERE id = ?'
    ).run(printingId, imageId, quantity, notes, ts, id)
    return requireEntry(db, id)
  })()
}

export function removeEntry(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM collection_entries WHERE id = ?').run(id)
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function listEntries(db: Database.Database, f: CollectionFilters): EntryView[] {
  const where: string[] = []
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
  if (f.levelMin !== undefined) {
    where.push('COALESCE(c.level, c.linkval) >= ?')
    params.push(f.levelMin)
  }
  if (f.levelMax !== undefined) {
    where.push('COALESCE(c.level, c.linkval) <= ?')
    params.push(f.levelMax)
  }
  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
  const entries = (db.prepare(sql).all(...params) as EntryDbRow[]).map(toView)

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

export function entriesForCard(db: Database.Database, cardId: number): EntryView[] {
  return (
    db.prepare(`${SELECT} WHERE c.id = ? ORDER BY p.set_code, e.id`).all(cardId) as EntryDbRow[]
  ).map(toView)
}

export function getFacets(db: Database.Database): Facets {
  const distinct = (col: string): string[] =>
    (
      db
        .prepare(
          `SELECT DISTINCT ${col} AS v FROM collection_entries e
           JOIN card_printings p ON p.id = e.printing_id JOIN cards c ON c.id = p.card_id
           WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`
        )
        .all() as { v: string }[]
    ).map((r) => r.v)
  return {
    cardTypes: distinct('c.type'),
    attributes: distinct('c.attribute'),
    archetypes: distinct('c.archetype'),
    setNames: distinct('p.set_name'),
    rarities: distinct('p.set_rarity')
  }
}
