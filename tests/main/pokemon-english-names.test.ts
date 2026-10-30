import { describe, expect, it } from 'vitest'
import { englishNamer } from '../../scripts/catalog/pokemon/englishNames'
import type { TdCard } from '../../scripts/catalog/pokemon/types'

let n = 0
const card = (name: string, dexId?: number[], category = 'Pokemon'): TdCard => ({
  id: `x-${++n}`,
  localId: String(n),
  name,
  category,
  dexId,
  set: { id: 'x', name: 'x' }
})

const en = [
  card('Pikachu', [25]),
  card('Pikachu V', [25]),
  card('Pikachu', [25]),
  card('Flareon', [136]),
  card('Flareon ex', [136]),
  card('Darkrai', [491]),
  card('Darkrai GX', [491]),
  card('Solgaleo GX', [791]),
  card('Solgaleo GX', [791]),
  card('Solgaleo', [791]),
  card("Team Rocket's Meowth", [52]),
  card('Meowth', [52]),
  card('Vulpix', [37]),
  card('Alolan Vulpix', [37]),
  card('Zekrom', [644]),
  card('Magcargo', [219])
]
const ja = [
  card('ピカチュウ', [25]),
  card('ピカチュウ', [25]),
  card('ブースター', [136]),
  card('ブースター', [136]),
  card('ダークライ', [491]),
  card('ダークライ', [491]),
  card('ロコン', [37]),
  card('ロコン', [37])
]
const named = [
  { japanese: 'ナンジャモのハラバリーex', english: "Iono's Bellibolt ex - 038/190" },
  { japanese: 'ナンジャモのタイカイデン', english: "Iono's Kilowattrel" },
  { japanese: 'ネストボール', english: 'Nest Ball - 080/078' },
  { japanese: 'ネストボール', english: 'Nest Ball' },
  { japanese: 'ふしぎなアメ', english: 'Rare Candy' },
  { japanese: 'ふしぎなアメ', english: 'Custom Vest' }
]
const namer = englishNamer(en, ja, named)
const nameOf = (c: TdCard): string | null => namer.nameOf(c)?.name ?? null

describe('English names for Japanese cards', () => {
  it('takes the name other cards with the same Japanese name have, when most agree', () => {
    expect(namer.nameOf(card('ネストボール', [], 'Trainer'))).toEqual({
      name: 'Nest Ball',
      by: 'pair'
    })
    expect(nameOf(card('ふしぎなアメ', [], 'Trainer'))).toBeNull()
  })

  it('names a Pokémon by its species, from the plain English name', () => {
    expect(namer.nameOf(card('ピカチュウ', [25]))).toEqual({ name: 'Pikachu', by: 'species' })
    expect(nameOf(card('ソルガレオ', [791]))).toBe('Solgaleo')
    expect(nameOf(card('ピカチュ', [25]))).toBe('Pikachu')
  })

  it('carries known suffixes and prefixes over', () => {
    expect(nameOf(card('ピカチュウVMAX', [25]))).toBe('Pikachu VMAX')
    expect(nameOf(card('ピカチュウ（デルタ種）', [25]))).toBe('Pikachu δ')
    expect(nameOf(card('ロケット団のニャース', [52]))).toBe("Team Rocket's Meowth")
    expect(nameOf(card('アローラロコン', [37]))).toBe('Alolan Vulpix')
    expect(nameOf(card('ピカチュウ&ゼクロムGX', [25, 644]))).toBe('Pikachu & Zekrom GX')
  })

  it("never cuts the species' own Japanese name", () => {
    expect(nameOf(card('ブースター', [136]))).toBe('Flareon')
    expect(nameOf(card('ブースターex', [136]))).toBe('Flareon ex')
    expect(nameOf(card('ダークライ', [491]))).toBe('Darkrai')
    expect(nameOf(card('Magcargo（デルタ種）', [219]))).toBe('Magcargo δ')
  })

  it('names an owner other cards name, and leaves out one they do not', () => {
    expect(nameOf(card('ナンジャモのピカチュウ', [25]))).toBe("Iono's Pikachu")
    expect(nameOf(card('モーティのピカチュウ', [25]))).toBe('Pikachu')
  })

  it('names basic Energy by type', () => {
    expect(nameOf(card('基本水エネルギー', [], 'Energy'))).toBe('Basic Water Energy')
    expect(nameOf(card('金属エネルギー', [], 'Energy'))).toBe('Metal Energy')
  })

  it('leaves English names, unknown species and unknown Trainers alone', () => {
    expect(nameOf(card('Pikachu', [25]))).toBeNull()
    expect(nameOf(card('ミュウ', [151]))).toBeNull()
    expect(nameOf(card('粉末を癒します', [], 'Trainer'))).toBeNull()
  })
})
