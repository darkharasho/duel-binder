import { describe, it, expect } from 'vitest'
import { dexColumns, resolveDexIds, type DexInput } from '../../scripts/catalog/pokemon/dexIds'

let next = 1
const card = (o: Partial<DexInput> & { name: string }): DexInput => ({
  cardId: next++,
  lang: 'en',
  category: 'Pokemon',
  dexId: undefined,
  twinIds: [],
  ...o
})

describe('resolveDexIds', () => {
  it('takes an English card\'s dexId', () => {
    const c = card({ name: 'Charizard', dexId: [6] })
    expect(resolveDexIds([c]).get(c.cardId)).toEqual([6])
  })

  it('keeps both species of a Tag Team and splits them into columns', () => {
    const c = card({ name: 'Pikachu & Zekrom-GX', dexId: [644, 25] })
    expect(resolveDexIds([c]).get(c.cardId)).toEqual([25, 644])
    expect(dexColumns([25, 644])).toEqual({ dexNo: 25, dexExtra: '644' })
    expect(dexColumns([6])).toEqual({ dexNo: 6, dexExtra: null })
    expect(dexColumns([])).toEqual({ dexNo: null, dexExtra: null })
  })

  it('gives a Trainer nothing', () => {
    const c = card({ name: "Professor's Research", category: 'Trainer', dexId: [6] })
    expect(resolveDexIds([c]).has(c.cardId)).toBe(false)
  })

  it.each([[[0]], [[1026]]])('drops %j as out of range', (dexId) => {
    const c = card({ name: 'Nothing', dexId })
    expect(resolveDexIds([c]).has(c.cardId)).toBe(false)
  })

  it('corrects a Japanese dexId from the English name', () => {
    const en = card({ name: 'Trubbish', dexId: [568] })
    const ja = card({ lang: 'ja', name: 'Trubbish', dexId: [659] })
    expect(resolveDexIds([en, ja]).get(ja.cardId)).toEqual([568])
  })

  it('leaves a Japanese dexId alone when the name says nothing', () => {
    const ja = card({ lang: 'ja', name: 'Trubbish', dexId: [659] })
    expect(resolveDexIds([ja]).get(ja.cardId)).toEqual([659])
  })

  it('gives a card with no dexId its twin\'s species', () => {
    const en = card({ name: 'Charizard', dexId: [6] })
    const zh = card({ lang: 'zh-hans', name: 'Whatever', twinIds: [en.cardId] })
    expect(resolveDexIds([zh, en]).get(zh.cardId)).toEqual([6])
  })

  it('falls back to the English name when there is no twin', () => {
    const en = card({ name: 'Pikachu', dexId: [25] })
    const zh = card({ lang: 'zh-hans', name: 'Pikachu ex' })
    expect(resolveDexIds([zh, en]).get(zh.cardId)).toEqual([25])
  })

  it('ignores a name two species share', () => {
    const a = card({ name: 'Shared', dexId: [1] })
    const b = card({ name: 'Shared', dexId: [2] })
    const zh = card({ lang: 'zh-hans', name: 'Shared' })
    const out = resolveDexIds([a, b, zh])
    expect(out.has(zh.cardId)).toBe(false)
    expect(out.get(a.cardId)).toEqual([1])
  })
})
