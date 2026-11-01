import type { SqlDb } from '../db/sql'
import {
  dexMissing,
  matchDexRows,
  type DexCatalogPrinting,
  type DexPreview
} from '../../shared/dex/match'
import type { DexRow } from '../../shared/dex/parse'
import { addEntry } from './collection'
import { localScope } from './scope'

/** Imports write the Pokémon collection whichever game is showing. */
const PKM = localScope("'pkm'")

/** Every live Pokémon printing. A version the catalog dropped (`missing_from_api`) can't catch a row. */
function pokemonCatalog(db: SqlDb): DexCatalogPrinting[] {
  return db
    .prepare(
      `SELECT p.id, p.card_id AS cardId, pc.source_id AS sourceId, p.set_name AS setName,
         p.set_rarity AS version, c.name AS cardName, p.language, pc.category
       FROM card_printings p
       JOIN cards c ON c.id = p.card_id AND +c.game = 'pkm'
       JOIN pokemon_cards pc ON pc.card_id = p.card_id
       WHERE +p.game = 'pkm' AND p.missing_from_api = 0`
    )
    .all() as DexCatalogPrinting[]
}

const heldCopies = (db: SqlDb, printingId: number): number =>
  (
    db
      .prepare(
        `SELECT COALESCE(SUM(e.quantity), 0) AS n FROM collection_entries e WHERE e.printing_id = ? AND ${PKM.where('e')}`
      )
      .get(printingId) as { n: number }
  ).n

/** The art of a new entry: what the printing already shows, else the card's first image, as an add does. */
const entryImage = (db: SqlDb, printingId: number, cardId: number): number | undefined =>
  (
    db
      .prepare(
        `SELECT image_id FROM (
           SELECT e.image_id, 0 AS rank, 0 AS sort_order FROM collection_entries e WHERE e.printing_id = ? AND ${PKM.where('e')}
           UNION ALL
           SELECT image_id, 1, sort_order FROM card_images WHERE card_id = ? AND +game = 'pkm'
         ) ORDER BY rank, sort_order, image_id LIMIT 1`
      )
      .get(printingId, cardId) as { image_id: number } | undefined
  )?.image_id

interface Plan {
  preview: DexPreview
  adds: { printingId: number; imageId: number; quantity: number }[]
}

/**
 * A printing's count only goes up to the file's: the import adds the difference and never lowers
 * anything, so importing a file twice adds nothing the second time.
 */
function plan(db: SqlDb, rows: DexRow[]): Plan {
  const match = matchDexRows(rows, pokemonCatalog(db))
  const adds: Plan['adds'] = []
  let alreadyOwned = 0
  for (const [printingId, { cardId, quantity, row }] of match.wanted) {
    const add = quantity - heldCopies(db, printingId)
    if (add <= 0) {
      alreadyOwned++
      continue
    }
    const imageId = entryImage(db, printingId, cardId)
    if (imageId === undefined) match.missing.push(dexMissing(row, 'image'))
    else adds.push({ printingId, imageId, quantity: add })
  }
  return {
    adds,
    preview: {
      copies: adds.reduce((n, a) => n + a.quantity, 0),
      printings: adds.length,
      alreadyOwned,
      zeroRows: match.zeroRows,
      repeatRows: match.repeatRows,
      notImported: match.missing
    }
  }
}

export const previewDexImport = (db: SqlDb, rows: DexRow[]): DexPreview => plan(db, rows).preview

/** Adds through the normal add, so entries sync like any other; all of it or none. */
export function applyDexImport(db: SqlDb, rows: DexRow[], now = new Date()): { copies: number } {
  return db.transaction(() => {
    const { adds, preview } = plan(db, rows)
    for (const add of adds) addEntry(db, add, now, PKM)
    return { copies: preview.copies }
  })()
}
