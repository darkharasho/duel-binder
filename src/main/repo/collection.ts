import type { SqlDb } from '../db/sql'
import { RARITY_LABEL } from '../db/schema'
import { MAX_NOTES } from '../../shared/cloud'
import { LANGUAGES } from '../../shared/languages'
import { priceFor } from '../../shared/pricing'
import type {
  AddEntryInput,
  CardRow,
  CollectionFilters,
  EntryView,
  Facets,
  Printing,
  UpdateEntryInput
} from '../../shared/types'
import { getMeta } from '../db/meta'
import { LOCAL, scopeGame, type Scope } from './scope'
import { pokemonFacets, pokemonSearch, pokemonWhere } from './pkmFilters'
import { enTwinPrice } from './enTwin'
import { marketOnlyGame, setPrice, sweptLanguage } from './priceRule'
import { buildFtsQuery, POKEMON_COLS, rowToCard, rowToPrinting, type CardDbRow, type PrintingDbRow } from './cards'

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
  e_release_date: string | null
  [col: string]: unknown
}

/** The card, printing and price columns `entryPrice` and rowToCard read; `c`, `p`, `ip` and `pc` joined as below. */
export const cardPriceColumns = (scope: Scope): string => `
         c.id AS id, c.name, c.type, c.frame_type, c.race, c.attribute, c.level, c.linkval, c.atk, c.def,
         c.archetype, c.desc, c.tcgplayer_price, ${POKEMON_COLS},
         p.id AS p_id, p.card_id, p.set_name, p.set_code, ${RARITY_LABEL} AS set_rarity, p.set_rarity_code, ${setPrice(scope.ebayPrices)} AS set_price,
         p.market_price, ${enTwinPrice(scope.game)} AS en_twin_price, p.game AS p_game,
         p.missing_from_api, p.language,
         ip.printing_id AS ip_id, ip.price AS ip_price, ip.checked_at AS ip_checked_at,
         ip.listing_count AS ip_listing_count`

const select = (scope: Scope): string => `
  SELECT e.id AS e_id, e.quantity AS e_quantity, e.notes AS e_notes, e.created_at AS e_created_at,
         e.updated_at AS e_updated_at, e.image_id AS e_image_id,
         COALESCE(rs.tcg_date, res.tcg_date) AS e_release_date,
         ${cardPriceColumns(scope)}
  FROM collection_entries e
  JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
  JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
  LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
  LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}
  LEFT JOIN sets rs ON rs.game = p.game AND rs.language = p.language AND rs.set_name = p.set_name
  LEFT JOIN sets res ON res.game = p.game AND res.language = 'en' AND res.set_name = p.set_name`

type EntryPrice = Pick<
  EntryView,
  | 'unitPrice'
  | 'priceApproximate'
  | 'priceSource'
  | 'priceCheckedAt'
  | 'priceListingCount'
  | 'noPriceReason'
>

/** A printing's price from a row of `cardPriceColumns`, by the rules of the row's game. */
export function entryPrice(
  r: Record<string, unknown>,
  card: CardRow,
  printing: Printing,
  priceStatus: string | null
): EntryPrice {
  const english = printing.language === 'en'
  const hasRow = r.ip_id !== null && r.ip_id !== undefined
  const ebayPrice = hasRow ? (r.ip_price as number | null) : null
  // English uses the printing's TCGplayer market price, then its eBay asking price, then YGOPRODeck.
  // intl_prices holds eBay prices for every language; European printings with no eBay price fall back to the English twin as an estimate.
  // eBay and YGOPRODeck prices are Yu-Gi-Oh! only for now: another game's unpriced copy has no price
  // and no source, never a YGOPRODeck label or an eBay "checking" that never comes.
  const ygo = r.p_game === 'ygo'
  const marketOnly = marketOnlyGame(r.p_game)
  const market = english || marketOnly ? ((r.market_price as number | null) ?? null) : null
  const twin = !english && !marketOnly && ebayPrice === null ? ((r.en_twin_price as number | null) ?? null) : null
  // A market-only game takes eBay only where the set sweep prices it (Chinese Pokémon), and only when there is a price.
  const swept = marketOnly && market === null && ebayPrice !== null && sweptLanguage(printing.language)
  const ebay = swept || (!marketOnly && market === null && twin === null && (english || !ygo ? ebayPrice !== null : true))
  let unitPrice: number | null
  let approximate: boolean
  let noPriceReason: EntryView['noPriceReason'] = null
  if (market !== null) {
    unitPrice = market
    approximate = false
  } else if (twin !== null) {
    unitPrice = twin
    approximate = true
  } else if (ebay) {
    unitPrice = ebayPrice
    approximate = false
    if (unitPrice === null)
      noPriceReason = hasRow ? 'no-listings' : priceStatus === 'ok' ? 'pending' : 'unavailable'
  } else if (ygo) {
    ;({ unitPrice, approximate } = priceFor(r.set_price as number | null, card.tcgplayerPrice))
  } else {
    unitPrice = null
    approximate = false
  }
  return {
    unitPrice,
    priceApproximate: approximate,
    priceSource: market !== null || twin !== null ? 'tcgplayer' : ebay ? 'ebay' : ygo ? 'ygoprodeck' : null,
    priceCheckedAt: ebay ? ((r.ip_checked_at as string | null) ?? null) : null,
    priceListingCount: ebay ? ((r.ip_listing_count as number | null) ?? null) : null,
    noPriceReason
  }
}

function toView(r: EntryDbRow, priceStatus: string | null): EntryView {
  const card = rowToCard(r as unknown as CardDbRow)
  const printing = rowToPrinting({ ...(r as unknown as PrintingDbRow), id: r.p_id as number })
  const price = entryPrice(r, card, printing, priceStatus)
  return {
    id: r.e_id,
    quantity: r.e_quantity,
    notes: r.e_notes,
    createdAt: r.e_created_at,
    updatedAt: r.e_updated_at,
    releaseDate: r.e_release_date,
    card,
    printing,
    imageId: r.e_image_id,
    printingScan: true,
    ...price,
    totalValue: (price.unitPrice ?? 0) * r.e_quantity
  }
}

export function getEntry(db: SqlDb, id: number, scope: Scope = LOCAL): EntryView | null {
  const row = db.prepare(`${select(scope)} WHERE e.id = ? AND ${scope.where('e')}`).get(id) as EntryDbRow | undefined
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

function assertLink(db: SqlDb, printingId: number, imageId: number, scope: Scope): void {
  const p = db.prepare(`SELECT card_id FROM card_printings WHERE id = ? AND +game = ${scope.game}`).get(printingId) as
    | { card_id: number }
    | undefined
  if (!p) throw new CollectionError(`Printing ${printingId} not found`)
  const img = db.prepare(`SELECT card_id FROM card_images WHERE image_id = ? AND +game = ${scope.game}`).get(imageId) as
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
  assertLink(db, input.printingId, input.imageId, scope)
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
    assertLink(db, printingId, imageId, scope)

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
  const pkm = scopeGame(db, scope) === 'pkm'
  const text = f.q?.trim()
  if (text) {
    const own = pkm ? pokemonSearch(text, { game: scope.game, printingCol: 'p.set_code' }) : null
    const parts: string[] = own ? [...own.parts] : []
    if (own) params.push(...own.params)
    if (!own?.numeric) {
      const fts = buildFtsQuery(text)
      parts.push(`p.set_code LIKE ? ESCAPE '\\'`)
      params.push(`${escapeLike(text)}%`)
      if (fts) {
        parts.push('c.id IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)')
        params.push(fts)
      }
    }
    where.push(`(${parts.join(' OR ')})`)
  }
  // Each game has its own card filters; the other game's are ignored.
  if (pkm) {
    const pkm = pokemonWhere(f)
    where.push(...pkm.where)
    params.push(...pkm.params)
  } else {
    inList('c.type', f.cardTypes)
    inList('c.attribute', f.attributes)
    inList('c.archetype', f.archetypes)
    if (f.levelMin !== undefined) {
      where.push('COALESCE(c.level, c.linkval) >= ?')
      params.push(f.levelMin)
    }
    if (f.levelMax !== undefined) {
      where.push('COALESCE(c.level, c.linkval) <= ?')
      params.push(f.levelMax)
    }
  }
  inList('p.set_name', f.setNames)
  inList('p.set_rarity', f.rarities)
  if (f.language) {
    where.push('p.language = ?')
    params.push(f.language)
  }
  const status = getMeta(db, 'price_service_status')
  const sql = `${select(scope)} WHERE ${where.join(' AND ')}`
  const entries = (db.prepare(sql).all(...params) as EntryDbRow[]).map((r) => toView(r, status))

  const dir = f.dir === 'desc' ? -1 : 1
  const key = (e: EntryView): number | string => {
    switch (f.sort) {
      case 'value':
        return e.totalValue
      case 'unitPrice':
        return e.unitPrice ?? 0
      case 'quantity':
        return e.quantity
      case 'added':
        return e.createdAt
      default:
        return e.card.name.toLowerCase()
    }
  }
  if (f.sort === 'released') {
    // Undated sets go last whichever way it runs; one set stays in its own order.
    return entries.sort((a, b) => {
      const [ra, rb] = [a.releaseDate ?? '', b.releaseDate ?? '']
      if (ra !== rb) return !ra ? 1 : !rb ? -1 : ra < rb ? -dir : dir
      return (
        a.printing.setCode.localeCompare(b.printing.setCode) ||
        a.card.name.localeCompare(b.card.name) ||
        a.id - b.id
      )
    })
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
    db.prepare(`${select(scope)} WHERE c.id = ? AND ${scope.where('e')} ORDER BY p.set_code, e.id`).all(cardId) as EntryDbRow[]
  ).map((r) => toView(r, status))
}

export function getFacets(db: SqlDb, scope: Scope = LOCAL): Facets {
  const distinct = (col: string): string[] =>
    (
      db
        .prepare(
          `SELECT DISTINCT ${col} AS v FROM collection_entries e
           JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
           JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
           WHERE ${scope.where('e')} AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`
        )
        .all() as { v: string }[]
    ).map((r) => r.v)
  const owned = new Set(distinct('p.language'))
  const pkm = scopeGame(db, scope) === 'pkm'
  return {
    cardTypes: pkm ? [] : distinct('c.type'),
    attributes: pkm ? [] : distinct('c.attribute'),
    archetypes: pkm ? [] : distinct('c.archetype'),
    setNames: distinct('p.set_name'),
    rarities: distinct('p.set_rarity'),
    languages: LANGUAGES.map((l) => l.code).filter((code) => owned.has(code)),
    ...(pkm
      ? pokemonFacets(
          db,
          scope,
          `SELECT p.card_id FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game} WHERE ${scope.where('e')}`
        )
      : {})
  }
}
