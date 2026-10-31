import { describe, expect, it } from 'vitest'
import { cleanRarity } from '../../src/main/ygo/rarity'
import { mapApiCard, type ApiCard } from '../../src/main/ygo/mapCard'
import { normalizeRarity, parseSetList } from '../../src/main/yugipedia/parse'
import { variantLabel } from '../../src/main/tcgplayer/catalog'

describe('cleanRarity', () => {
  it.each([
    '2',
    '3',
    'New',
    'Reprint',
    'New artwork',
    'European debut',
    'Oceanian debut',
    'European & Oceanian debut',
    'Cr',
    ''
  ])('drops %j, which is no rarity', (v) => expect(cleanRarity(v)).toBeNull())
  it('fixes spellings and casing, and keeps real rarities', () => {
    expect(cleanRarity('PLatinum Secret Rare')).toBe('Platinum Secret Rare')
    expect(cleanRarity('Extra Secret')).toBe('Extra Secret Rare')
    expect(cleanRarity('Starfoil')).toBe('Starfoil Rare')
    expect(cleanRarity('Ultra Rare (Alternate art)')).toBe('Ultra Rare (Alternate Art)')
    expect(cleanRarity('Promo')).toBe('Promo')
    expect(cleanRarity('Ghost/Gold Rare')).toBe('Ghost/Gold Rare')
    expect(cleanRarity('Secret Rare (Alternate artwork)')).toBe('Secret Rare (Alternate artwork)')
  })
})

describe('YGOPRODeck printings', () => {
  const api = (rarities: string[]): ApiCard =>
    ({
      id: 1,
      name: 'X',
      card_sets: rarities.map((r) => ({
        set_name: 'S',
        set_code: 'LAVD-ENL02',
        set_rarity: r,
        set_rarity_code: ''
      })),
      card_images: [{ id: 1 }]
    }) as unknown as ApiCard
  it('keeps notes and quantities out of the rarities, and fixes the typo', () => {
    const { printings } = mapApiCard(api(['2', 'Ultra Rare', 'New', 'PLatinum Secret Rare']), '')
    expect(printings.map((p) => p.setRarity)).toEqual(['Ultra Rare', 'Platinum Secret Rare'])
  })
  it('keeps a real printing whose only rarity is a note, as it reads', () => {
    expect(mapApiCard(api(['New']), '').printings.map((p) => p.setRarity)).toEqual(['New'])
  })
})

describe('Yugipedia set lists', () => {
  it('normalizes the platinum typo', () => {
    expect(normalizeRarity('PLatinum Secret Rare')).toBe('Platinum Secret Rare')
  })
  it('uses the list default for a slot holding a note, and leaves the row out with no default', () => {
    const r = parseSetList(
      [
        '{{Set list|region=EN|rarities=Common|',
        'A-EN001; Card A; New',
        'A-EN002; Card B; 2',
        'A-EN003; Card C; Rare, Reprint',
        '}}',
        '{{Set list|region=EN|',
        'B-EN001; Card D; New',
        'B-EN002; Card E; Super Rare',
        '}}'
      ].join('\n')
    )
    expect(r?.rows.map((x) => [x.code, x.rarities])).toEqual([
      ['A-EN001', ['Common']],
      ['A-EN002', ['Common']],
      ['A-EN003', ['Rare']],
      ['B-EN002', ['Super Rare']]
    ])
  })
  it('reads a New artwork slot as the print note', () => {
    const r = parseSetList(
      '{{Set list|region=EN|rarities=Ultra Rare|\nA-EN001; Card A; New artwork\n}}'
    )
    expect(r?.rows[0]).toMatchObject({ rarities: ['Ultra Rare'], newArt: true })
  })
  it('spells the Alternate Art note one way', () => {
    const r = parseSetList(
      '{{Set list|region=JP|\nA-JP001; Card A; UR // description::(Alternate art)\n}}'
    )
    expect(r?.rows[0].variant).toBe('Alternate Art')
  })
})

describe('TCGplayer variants', () => {
  it('spells the Alternate Art label one way', () => {
    expect(variantLabel('Card (Alternate art) (Secret Rare)', 'Secret Rare')).toBe('Alternate Art')
  })
})
