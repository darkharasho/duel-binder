import { describe, expect, it } from 'vitest'
import type { Printing } from '@shared/types'
import {
  artGroups,
  artKind,
  defaultLanguageMode,
  englishModeLanguages,
  printingSummary,
  setRows,
  splitRarity
} from '@/features/card/printingGroups'

const printing = (id: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId: 1,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: id,
  missingFromApi: false,
  ...extra
})

const kindOf = (setRarity: string) => artKind(printing(1, { setRarity }), 'ygo')

describe('splitRarity', () => {
  it('splits variants and strips wiki markup', () => {
    expect(splitRarity('Ultra Rare (Chibi artwork)')).toEqual({ rarity: 'Ultra Rare', variant: 'Chibi artwork' })
    expect(splitRarity('Ultra Rare ([[Alternate artwork|alternate artwork]])')).toEqual({
      rarity: 'Ultra Rare',
      variant: 'alternate artwork'
    })
    expect(splitRarity('Common (Yellow "[[Sheep Token]]")')).toEqual({ rarity: 'Common', variant: 'Yellow Sheep Token' })
    expect(splitRarity('Ultra Rare')).toEqual({ rarity: 'Ultra Rare', variant: null })
  })
})

describe('artKind', () => {
  it('recognises distinct arts', () => {
    expect(kindOf('Secret Rare (Chibi artwork)').key).toBe('chibi')
    expect(kindOf('Ultra Rare (Alternate Art)').key).toBe('alternate')
    expect(kindOf('Secret Rare (Alternate artwork)').key).toBe('alternate')
    expect(kindOf('Ultra Rare (Manga-Style, Monochrome)').key).toBe('manga')
    expect(kindOf('Ultra Rare ([[Alternate artwork|alternate artwork]])').key).toBe('alternate')
    expect(kindOf('Secret Rare (3rd artwork)')).toEqual({ key: 'art-3', label: '3rd artwork' })
  })
  it('treats other variants as original', () => {
    for (const r of [
      'Secret Rare (New artwork)',
      'Ultra Rare (Alternate password)',
      'Rare (Stamp artwork)',
      'Ultra Rare (Blue)',
      'Secret Rare (Special Red Version)',
      "Ultra Rare (Pharaoh's Rare)",
      'Common (Yellow "[[Sheep Token]]")',
      'Ultra Rare (10th anniversary artwork)',
      'Ultra Rare'
    ])
      expect(kindOf(r)).toEqual({ key: 'original', label: 'Original' })
  })
})

describe('artGroups', () => {
  it('labels One Piece alternate arts', () => {
    const ps = [printing(1), printing(2, { artImageId: 1 }), printing(3, { artImageId: 2 })]
    expect(artGroups(ps, 'op').map((g) => g.kind.label)).toEqual(['Original', 'Alternate art 1', 'Alternate art 2'])
  })
  it('gives pkm and mtg one group', () => {
    const ps = [printing(1, { artImageId: 1 }), printing(2)]
    expect(artGroups(ps, 'pkm')).toHaveLength(1)
    expect(artGroups(ps, 'mtg')).toHaveLength(1)
    expect(artGroups([], 'ygo')).toEqual([])
  })
  it('picks the newest-dated printing as thumb', () => {
    const ps = [printing(1, { releaseDate: '2020-01-01' }), printing(2), printing(3, { releaseDate: '2022-05-05' })]
    expect(artGroups(ps, 'ygo')[0].thumb.id).toBe(3)
  })
  it('orders Original first then by count', () => {
    const ps = [
      printing(1, { setRarity: 'Ultra Rare (Chibi artwork)' }),
      printing(2, { setRarity: 'Ultra Rare (Anime artwork)' }),
      printing(3, { setRarity: 'Ultra Rare (Anime artwork)' }),
      printing(4)
    ]
    expect(artGroups(ps, 'ygo').map((g) => g.kind.key)).toEqual(['original', 'anime', 'chibi'])
  })
})

describe('setRows', () => {
  it('orders prefer first, newest, then undated', () => {
    const ps = [
      printing(1, { setName: 'Old', setCode: 'OLD-001', releaseDate: '2002-03-04' }),
      printing(2, { setName: 'Undated', setCode: 'UND-001' }),
      printing(3, { setName: 'New', setCode: 'NEW-001', releaseDate: '2024-01-01' })
    ]
    const rows = setRows(ps, 'ygo')
    expect(rows.map((r) => r.setName)).toEqual(['New', 'Old', 'Undated'])
    expect(rows.map((r) => r.year)).toEqual(['2024', '2002', null])
    expect(rows[0].key).toBe('en|New')
    expect(rows[0].codePrefix).toBe('NEW')
    expect(setRows(ps, 'ygo', { setName: 'Undated', language: 'en' })[0].setName).toBe('Undated')
  })
  it('shortens and disambiguates ygo labels', () => {
    const a = setRows([printing(1), printing(2, { setRarity: 'Ultra Rare (1st Edition)' })], 'ygo')[0]
    expect(a.pills.map((p) => p.label)).toEqual(['Ultra', 'Ultra · 1st Edition'])
    const b = setRows(
      [
        printing(1, { setCode: 'RA01-EN001', setRarity: 'Secret Rare' }),
        printing(2, { setCode: 'RA01-EN051', setRarity: 'Secret Rare' })
      ],
      'ygo'
    )[0]
    expect(b.pills.map((p) => p.label)).toEqual(['Secret · EN001', 'Secret · EN051'])
    const c = setRows([printing(1, { setRarity: 'Rare' })], 'ygo')[0]
    expect(c.pills[0].label).toBe('Rare')
  })
  it('labels magic finishes', () => {
    const rows = setRows(
      [printing(1, { setRarity: 'Rare' }), printing(2, { setRarity: 'Rare (Foil)' }), printing(3, { setRarity: 'Rare (Etched Foil)' })],
      'mtg'
    )
    expect(rows[0].pills.map((p) => p.label)).toEqual(['Rare', 'Rare · Foil', 'Rare · Etched'])
  })
  it('splits languages into rows', () => {
    expect(setRows([printing(1), printing(2, { language: 'ja' })], 'ygo')).toHaveLength(2)
  })
})

describe('languages and summary', () => {
  it('defaults and english mode', () => {
    const ja = printing(1, { language: 'ja' })
    expect(defaultLanguageMode([ja])).toBe('all')
    expect(defaultLanguageMode([ja, printing(2)])).toBe('english')
    const s = englishModeLanguages([ja], undefined)
    expect(s.has('en')).toBe(true)
    expect(s.has('ja')).toBe(true)
  })
  it('summarises', () => {
    const ps = [
      printing(1),
      printing(2, { setName: 'Other', setRarity: 'Ultra Rare (Chibi artwork)' }),
      printing(3, { language: 'ja' })
    ]
    expect(printingSummary(ps, 'ygo')).toEqual({ printings: 3, arts: 2, sets: 3, languages: 2 })
    const qs = [printing(1), printing(2, { setName: 'Other', setRarity: 'Ultra Rare (Chibi artwork)', language: 'ja' }), printing(3, { setName: 'Other', setRarity: 'Ultra Rare (Chibi artwork)', language: 'ja' })]
    expect(printingSummary(qs, 'ygo')).toEqual({ printings: 3, arts: 2, sets: 2, languages: 2 })
  })
})
