import { describe, expect, it } from 'vitest'
import {
  printingChip,
  printingSearch,
  printingText,
  printingTitle,
  rarityLabel
} from '../../src/shared/printingLabel'

const coded = { setCode: 'YAC1-JP001', setName: 'Original Art Collection', rarity: 'Super Rare' }
const uncoded = {
  setCode: '',
  setName: 'Original Art Collection',
  rarity: 'Ultra Rare',
  variant: 'Manga-Style, Color'
}

describe('printing labels', () => {
  it('names the art variant unless the rarity already does', () => {
    expect(rarityLabel('Prismatic Secret Rare', 'Overframe')).toBe(
      'Prismatic Secret Rare (Overframe)'
    )
    expect(rarityLabel('Ultra Rare (Overframe)', 'Overframe')).toBe('Ultra Rare (Overframe)')
    expect(rarityLabel('Ultra Rare', ' ')).toBe('Ultra Rare')
    expect(rarityLabel('Ultra Rare', null)).toBe('Ultra Rare')
  })

  it('chips the code, then the set name and rarity', () => {
    expect(printingChip(coded)).toBe('YAC1-JP001')
    expect(printingTitle(coded)).toBe('Original Art Collection - Super Rare')
    expect(printingText(coded)).toBe('YAC1-JP001 Original Art Collection - Super Rare')
    expect(printingText(coded, 'JP')).toBe('YAC1-JP001 Original Art Collection - Super Rare · JP')
  })

  it('has no chip for an uncoded printing; the set name still leads', () => {
    expect(printingChip(uncoded)).toBeNull()
    expect(printingTitle(uncoded)).toBe('Original Art Collection - Ultra Rare (Manga-Style, Color)')
    expect(printingText(uncoded)).toBe('Original Art Collection - Ultra Rare (Manga-Style, Color)')
  })

  it('shows the rarity alone with no set name', () => {
    expect(printingTitle({ setCode: 'X-1', setName: '', rarity: 'Rare' })).toBe('Rare')
  })

  it('searches code, set name, rarity and language', () => {
    expect(printingSearch(coded, 'JP')).toBe('yac1-jp001 original art collection super rare jp')
    expect(printingSearch(uncoded)).toBe('original art collection ultra rare (manga-style, color)')
  })

  it('names a Japanese-named set in English, and searches both names', () => {
    const p = { setCode: 'SM4P 121/114', setName: 'GXバトルブースト', rarity: 'Holo' }
    expect(printingTitle(p)).toBe('GX Battle Boost - Holo')
    expect(printingSearch(p)).toBe('sm4p 121/114 gx battle boost gxバトルブースト holo')
  })

  it('leaves out a set name with no English name when the code is shown', () => {
    const p = { setCode: 'ZZ1 001/010', setName: '未知のセット', rarity: 'Common' }
    expect(printingTitle(p)).toBe('Common')
    expect(printingTitle({ ...p, setCode: '' })).toBe('未知のセット - Common')
  })
})
