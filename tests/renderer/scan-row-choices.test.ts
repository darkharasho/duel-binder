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

  it("names an uncoded printing by its set, as YAC1's Manga-Style ones", () => {
    const options = [
      printing(1, 'Ultra Rare', null),
      { ...printing(2, 'Ultra Rare', 'Manga-Style'), setCode: '' }
    ]
    const row: ScanRow = {
      key: 'k',
      quantity: 1,
      addedAt: 0,
      cardId: 1,
      name: options[0].name,
      imageId: 10,
      printingId: 2,
      setCode: '',
      rarity: 'Ultra Rare',
      options,
      flag: 'pick-printing',
      via: 'art'
    }
    const [coded, uncoded] = choicesFor(row, 'ja')
    expect(coded).toMatchObject({ label: 'YAC1-JP006 · Ultra Rare', badge: 'YAC1-JP006' })
    expect(uncoded).toMatchObject({
      label: 'Original Artwork Collection · Ultra Rare (Manga-Style)',
      badge: undefined,
      title: 'Original Artwork Collection · Ultra Rare (Manga-Style)'
    })
  })
})
