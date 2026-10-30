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

const rowOf = (options: ScanPrinting[], over: Partial<ScanRow> = {}): ScanRow => ({
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
  via: 'art',
  ...over
})

describe('choicesFor', () => {
  it("names a printing's art variant unless its rarity already does", () => {
    const options = [
      printing(1, 'Ultra Rare', null),
      printing(2, 'Ultra Rare (Overframe)', null),
      printing(3, 'Prismatic Secret Rare', 'Overframe'),
      printing(4, 'Ultra Rare', 'Manga-Style')
    ]
    expect(choicesFor(rowOf(options), 'ja').map((c) => c.title)).toEqual([
      'Original Artwork Collection - Ultra Rare',
      'Original Artwork Collection - Ultra Rare (Overframe)',
      'Original Artwork Collection - Prismatic Secret Rare (Overframe)',
      'Original Artwork Collection - Ultra Rare (Manga-Style)'
    ])
  })

  it('shows the code as a badge, then the set name and rarity', () => {
    const [coded] = choicesFor(rowOf([printing(1, 'Super Rare', null)]), 'ja')
    expect(coded).toEqual({
      key: '1',
      label: 'YAC1-JP006 Original Artwork Collection - Super Rare',
      search: 'yac1-jp006 original artwork collection super rare jp',
      badge: 'YAC1-JP006',
      title: 'Original Artwork Collection - Super Rare',
      note: undefined
    })
  })

  it("shows no badge for an uncoded printing, as YAC1's Manga-Style ones", () => {
    const options = [
      printing(1, 'Ultra Rare', null),
      { ...printing(2, 'Ultra Rare', 'Manga-Style, Color'), setCode: '' }
    ]
    const row = rowOf(options, { printingId: 2, setCode: '', flag: 'pick-printing' })
    const [, uncoded] = choicesFor(row, 'ja')
    expect(uncoded).toMatchObject({
      label: 'Original Artwork Collection - Ultra Rare (Manga-Style, Color)',
      badge: undefined,
      title: 'Original Artwork Collection - Ultra Rare (Manga-Style, Color)'
    })
    expect(uncoded.search).toContain('original artwork collection')
  })

  it('tags each with its language when they span several', () => {
    const options = [
      printing(1, 'Ultra Rare', null),
      { ...printing(2, 'Ultra Rare', null), setCode: 'YAC1-EN006', language: 'en' as const }
    ]
    const choices = choicesFor(rowOf(options), null)
    expect(choices.map((c) => [c.label, c.note])).toEqual([
      ['YAC1-JP006 Original Artwork Collection - Ultra Rare · JP', 'JP'],
      ['YAC1-EN006 Original Artwork Collection - Ultra Rare · EN', 'EN']
    ])
    expect(choices[1].search).toContain('en')
  })
})
