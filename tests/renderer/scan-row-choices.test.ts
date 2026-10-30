import { describe, expect, it } from 'vitest'
import { choicesFor } from '../../src/renderer/src/features/scan/ScanRowItem'
import type { ScanRow } from '../../src/renderer/src/features/scan/session'
import type { ScanPrinting } from '../../src/shared/scan/types'

const printing = (printingId: number, rarity: string, variant: string | null): ScanPrinting => ({
  printingId,
  cardId: 1,
  name: 'Relinquished the Wicked Eye of Illusion',
  frameType: 'fusion',
  setName: 'Original Artwork Collection',
  setCode: 'YAC1-JP006',
  rarity,
  variant,
  language: 'ja',
  price: null,
  imageIds: [10]
})

describe('choicesFor', () => {
  it("names a printing's art variant unless its rarity already does", () => {
    const options = [
      printing(1, 'Ultra Rare', null),
      printing(2, 'Ultra Rare (Overframe)', null),
      printing(3, 'Prismatic Secret Rare', 'Overframe'),
      printing(4, 'Ultra Rare', 'Manga-Style')
    ]
    const row: ScanRow = {
      key: 'k',
      quantity: 1,
      addedAt: 0,
      cardId: 1,
      name: options[0].name,
      imageId: 10,
      printingId: 1,
      setCode: 'YAC1-JP006',
      rarity: 'Ultra Rare',
      options,
      flag: null,
      via: 'art'
    }
    expect(choicesFor(row, 'ja').map((c) => c.label)).toEqual([
      'YAC1-JP006 · Ultra Rare',
      'YAC1-JP006 · Ultra Rare (Overframe)',
      'YAC1-JP006 · Prismatic Secret Rare (Overframe)',
      'YAC1-JP006 · Ultra Rare (Manga-Style)'
    ])
  })
})
