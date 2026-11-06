import { describe, expect, it } from 'vitest'
import { choicesFor } from '../../src/renderer/src/features/scan/ScanRowItem'
import {
  activeGroup,
  filterGroups,
  groupKeyOf,
  groupPrintings
} from '../../src/renderer/src/features/scan/printingGroups'
import type { PickerOption } from '../../src/renderer/src/features/scan/SearchPicker'
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
    expect(choicesFor(rowOf(options), 'ja').map((c) => c.rarity)).toEqual([
      'Ultra Rare',
      'Ultra Rare (Overframe)',
      'Prismatic Secret Rare (Overframe)',
      'Ultra Rare (Manga-Style)'
    ])
  })

  it('shows the code as a badge, then the set name and rarity', () => {
    const [coded] = choicesFor(rowOf([printing(1, 'Super Rare', null)]), 'ja')
    expect(coded).toEqual({
      key: '1',
      label: 'YAC1-JP006 Original Artwork Collection - Super Rare',
      search: 'yac1-jp006 original artwork collection super rare jp',
      badge: 'YAC1-JP006',
      title: 'Original Artwork Collection',
      rarity: 'Super Rare',
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
      title: 'Original Artwork Collection',
      rarity: 'Ultra Rare (Manga-Style, Color)'
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

  it("lists a Pokémon card's reprints in other sets by code and set, its own versions plainly", () => {
    const pkm = (
      printingId: number,
      cardId: number,
      setName: string,
      setCode: string
    ): ScanPrinting => ({
      ...printing(printingId, 'Holofoil', null),
      cardId,
      name: 'Pikachu',
      frameType: 'pokemon',
      setName,
      setCode,
      language: 'en',
      price: 3
    })
    const own = [pkm(11, 1, '151', 'SV3 045/193')]
    const plain = choicesFor(rowOf(own, { game: 'pkm', printingId: 11 }), 'en')
    expect(plain.map((c) => [c.label, c.badge])).toEqual([['Holofoil · $3.00', undefined]])
    const both = [...own, pkm(31, 3, 'Paradox Rift', 'SV4 201/182')]
    const choices = choicesFor(rowOf(both, { game: 'pkm', printingId: 11 }), 'en')
    expect(choices.map((c) => [c.badge, c.title, c.rarity, c.note])).toEqual([
      ['SV3 045/193', '151', 'Holofoil', '$3.00'],
      ['SV4 201/182', 'Paradox Rift', 'Holofoil', '$3.00']
    ])
    expect(choices[1].search).toContain('paradox rift')
  })
})

describe('groupPrintings', () => {
  const opt = (
    key: string,
    badge: string | undefined,
    title: string,
    rarity?: string
  ): PickerOption => ({
    key,
    label: [badge, rarity ? `${title} - ${rarity}` : title].filter(Boolean).join(' '),
    search: [badge, title, rarity].filter(Boolean).join(' ').toLowerCase(),
    badge,
    title,
    rarity
  })

  it('makes one set per code and set name, in order, with its rarities as versions', () => {
    const groups = groupPrintings([
      opt('1', 'LOB-EN005', 'Legend of Blue Eyes', 'Common'),
      opt('2', 'SDY-006', 'Starter Deck: Yugi', 'Common'),
      opt('3', 'LOB-EN005', 'Legend of Blue Eyes', 'Rare'),
      // A native-script set's name isn't shown: its title is the rarity, so it groups by code.
      opt('4', 'LOB-JP005', 'Rare'),
      opt('5', 'LOB-JP005', 'Secret Rare')
    ])
    expect(groups.map((g) => [g.badge, g.title, g.versions.map((v) => v.text)])).toEqual([
      ['LOB-EN005', 'Legend of Blue Eyes', ['Common', 'Rare']],
      ['SDY-006', 'Starter Deck: Yugi', ['Common']],
      ['LOB-JP005', '', ['Rare', 'Secret Rare']]
    ])
    expect(groupKeyOf(groups, '3')).toBe(groups[0].key)
    expect(groupKeyOf(groups, '9')).toBeNull()
  })

  it('puts options with no set in one group, showing their labels', () => {
    const [only, ...rest] = groupPrintings([
      { key: '1', label: 'Normal · $1.00' },
      { key: '2', label: 'Reverse Holofoil · $3.50' }
    ])
    expect(rest).toEqual([])
    expect(only.versions.map((v) => v.text)).toEqual(['Normal · $1.00', 'Reverse Holofoil · $3.50'])
  })

  it('filters sets by code or name, or by holding a matching version', () => {
    const groups = groupPrintings([
      opt('1', 'LOB-EN005', 'Legend of Blue Eyes', 'Common'),
      opt('2', 'LOB-EN005', 'Legend of Blue Eyes', 'Rare'),
      opt('3', 'SDY-006', 'Starter Deck: Yugi', 'Common')
    ])
    const by = (q: string): string[][] =>
      filterGroups(groups, q).map((g) => [g.badge!, ...g.versions.map((v) => v.text)])
    expect(by('')).toEqual([
      ['LOB-EN005', 'Common', 'Rare'],
      ['SDY-006', 'Common']
    ])
    expect(by('legend')).toEqual([['LOB-EN005', 'Common', 'Rare']])
    expect(by('common')).toEqual([
      ['LOB-EN005', 'Common'],
      ['SDY-006', 'Common']
    ])
    expect(by('lob rare')).toEqual([['LOB-EN005', 'Rare']])
    expect(by('zzz')).toEqual([])
    // The chosen set stays while listed; else the first listed shows.
    expect(activeGroup(filterGroups(groups, 'common'), groups[1].key)?.badge).toBe('SDY-006')
    expect(activeGroup(filterGroups(groups, 'rare'), groups[1].key)?.badge).toBe('LOB-EN005')
  })
})
