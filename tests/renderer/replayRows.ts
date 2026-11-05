import type { ScanRow } from '@/features/scan/session'

let id = 0
/** A scan row priced at `price` for its own printing. */
export const replayRow = (price: number | null, over: Partial<ScanRow> = {}): ScanRow => {
  id++
  return {
    key: `k${id}`,
    cardId: id,
    name: `Card ${id}`,
    imageId: id,
    printingId: id,
    setCode: 'X',
    rarity: 'R',
    flag: null,
    via: 'code',
    quantity: 1,
    addedAt: id,
    options: [{ printingId: id, cardId: id, price, imageIds: [id] } as ScanRow['options'][number]],
    ...over
  } as ScanRow
}
