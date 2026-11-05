import type { ScanSessionCard } from '@shared/scanSessions'
import { rarityOf } from './replay/pulls'
import { photoFor, printingOf, priceOf } from './scanLook'
import type { ScanRow } from './session'

/** A row as one card of a session: what was added, at the price it showed. Null with no printing yet. */
export function sessionCardOf(row: ScanRow, quantity: number): ScanSessionCard | null {
  const printingId = printingOf(row)
  if (printingId === null) return null
  return {
    cardId: row.cardId,
    printingId,
    imageId: row.imageId,
    photoId: photoFor(row),
    name: row.name,
    setCode: row.setCode,
    rarity: rarityOf(row),
    quantity,
    price: priceOf(row) ?? null,
    guess: !!row.guess,
    addedAt: Date.now()
  }
}
