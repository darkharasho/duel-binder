import { describe, expect, it } from 'vitest'
import { findCandidates, leftoverWords, type HarvestedPrinting } from '../../scripts/terms/mine'

function printing(over: Partial<HarvestedPrinting>, titles: [string, string][]): HarvestedPrinting {
  return {
    game: 'pkm',
    pkey: 'PAF 232',
    cardId: 1,
    name: 'Mew ex',
    setName: 'Paldean Fates',
    setCode: 'PAF',
    number: '232/091',
    rarity: 'Special Illustration Rare',
    language: 'en',
    ...over,
    titles: titles.map(([title, seller]) => ({ title, seller })),
  }
}

const mew = printing({}, [
  ['Mew ex 232/091 Bubble Mew SIR Paldean Fates PSA 10', 's1'],
  ['Mew ex 232/091 Bubble Mew Paldean Fates NM', 's2'],
  ['Bubble Mew ex 232/091 Paldean Fates PSA 9', 's3'],
  ['Mew ex 232/091 Bubble Mew Paldean Fates', 's4'],
  ['Mew ex 232/091 Bubble Mew Paldean Fates free shipping', 's1'],
  ['Mew ex 232/091 Bubble Mew Paldean Fates holo', 's2'],
  ['Mew ex 232/091 Paldean Fates Pokemon', 's5'],
])

describe('leftoverWords', () => {
  it('drops known words and splits runs where a word was removed', () => {
    const runs = leftoverWords(mew, 'Mew ex 232/091 Bubble Mew SIR Paldean Fates PSA 10', new Set())
    expect(runs).toEqual([['bubble'], ['sir']])
  })
  it('drops known term words', () => {
    const runs = leftoverWords(mew, 'Mew ex Bubble Mew SIR', new Set(['bubble']))
    expect(runs).toEqual([['sir']])
  })
})

describe('findCandidates', () => {
  it('finds a printing nickname and skips grading, set, name and number words', () => {
    const out = findCandidates([mew], new Set())
    const bubble = out.find((c) => c.phrase === 'bubble')!
    expect(bubble.scope).toBe('printing')
    expect(bubble.pkeys).toEqual(['PAF 232'])
    expect(bubble.id).toBe('pkm:bubble')
    expect(bubble.count).toBe(6)
    expect(bubble.sellers).toBe(4)
    const phrases = out.map((c) => c.phrase)
    for (const p of ['psa', '10', 'paldean fates', 'mew', '232']) expect(phrases).not.toContain(p)
  })

  it('finds a set-scope phrase across several printings of one set', () => {
    const ps = [1, 2, 3, 4].map((i) =>
      printing({ pkey: `CRZ GG0${i}`, cardId: i, name: `Card ${i}`, setName: 'Crown Zenith', setCode: 'CRZ', number: `GG0${i}/GG70` }, [
        [`Card ${i} GG0${i}/GG70 TG Crown Zenith`, `a${i}`],
      ]),
    )
    const out = findCandidates(ps, new Set(), { minCount: 4, minSellers: 3 })
    const tg = out.find((c) => c.phrase === 'tg')!
    expect(tg.scope).toBe('set')
    expect(tg.sets).toEqual([{ language: 'en', setName: 'Crown Zenith' }])
    expect(tg.pkeys).toHaveLength(4)
  })

  it('drops phrases sold by too few sellers', () => {
    const p = printing({}, [1, 2, 3, 4, 5].map((i) => [`Mew ex 232/091 Bubble ${i}`, 'only'] as [string, string]))
    expect(findCandidates([p], new Set()).map((c) => c.phrase)).not.toContain('bubble')
  })

  it('drops known phrases', () => {
    expect(findCandidates([mew], new Set(['bubble'])).map((c) => c.phrase)).not.toContain('bubble')
  })

  it('drops a phrase covered by a longer one', () => {
    const p = printing({}, ['a', 'b', 'c', 'd'].map((s) => [`Mew ex Bubble Wrap ${s}`, s] as [string, string]))
    const phrases = findCandidates([p], new Set()).map((c) => c.phrase)
    expect(phrases).toContain('bubble wrap')
    expect(phrases).not.toContain('bubble')
    expect(phrases).not.toContain('wrap')
  })
})
