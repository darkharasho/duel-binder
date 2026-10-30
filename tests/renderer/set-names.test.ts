import { describe, expect, it } from 'vitest'
import {
  englishSetName,
  hasNativeScript,
  nativeSetName,
  setNameTooltip
} from '../../src/shared/setNames'
import { setLabel } from '../../src/renderer/src/lib/setLabels'

describe('set names in English', () => {
  it('leaves English names as they are, macrons and stars included', () => {
    for (const n of [
      'Magnificent Mayhem',
      'Saikyō Battle Pack',
      'Evil★Twin Duel Set',
      'Pokémon GO'
    ]) {
      expect(englishSetName(n, 'X')).toBe(n)
      expect(nativeSetName(n)).toBeNull()
      expect(hasNativeScript(n)).toBe(false)
    }
  })

  it('names a Japanese set in English', () => {
    expect(englishSetName('GXバトルブースト')).toBe('GX Battle Boost')
    expect(englishSetName('金、銀、新世界へ...')).toBe('Gold, Silver, to a New World...')
    expect(nativeSetName('ひかる伝説')).toBe('ひかる伝説')
    expect(setNameTooltip('ひかる伝説')).toBe('Shining Legends (ひかる伝説)')
    expect(setNameTooltip('Shining Legends')).toBe('Shining Legends')
  })

  it('keeps the " (code)" the catalog adds to a taken name', () => {
    expect(englishSetName('トリプレットビート (CS1A)')).toBe('Triplet Beat (CS1A)')
    expect(englishSetName('サン＆ムーン (SM1P)')).toBe('Sun & Moon (SM1P)')
  })

  it('falls back to the code for a name in another script with no English name', () => {
    expect(englishSetName('未知のセット', 'ZZ1 001/010')).toBe('ZZ1')
    expect(englishSetName('미지의 세트', 'KR1')).toBe('KR1')
    expect(englishSetName('未知のセット')).toBe('未知のセット')
  })

  it('labels a set with its code and English name', () => {
    expect(setLabel('GXバトルブースト', 'SM4P')).toBe('SM4P - GX Battle Boost')
    expect(setLabel('未知のセット', 'ZZ1')).toBe('ZZ1')
    expect(setLabel('Magnificent Mayhem', 'MAMA-EN001')).toBe('MAMA - Magnificent Mayhem')
  })
})
