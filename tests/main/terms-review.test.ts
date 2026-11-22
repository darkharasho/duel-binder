import { describe, expect, it } from 'vitest'
import { ReviewSchema, ReviewsSchema, toProposals, type Review } from '../../scripts/terms/review'
import type { Candidate } from '../../scripts/terms/mine'

const cand: Candidate = {
  id: 'pkm:bubble mew',
  game: 'pkm',
  phrase: 'bubble mew',
  scope: 'printing',
  count: 7,
  sellers: 5,
  pkeys: ['en|1|PAF 232|SIR'],
  sets: [{ language: 'en', setName: 'Paldean Fates' }],
  cardIds: [1],
  rarities: ['Special Illustration Rare'],
  sampleTitles: ['a', 'b', 'c', 'd', 'e', 'f', 'g']
}

const result = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: cand.id,
  verdict: 'term',
  phrase: 'Bubble Mew',
  kind: 'nickname',
  targetKind: 'printing',
  target: { pkeys: ['en|1|PAF 232|SIR'], cardIds: [], sets: [], rarities: [] },
  reason: 'Collectors call it that.',
  ...over
})

const review = (over: Record<string, unknown>): Review => ReviewSchema.parse(result(over))

describe('toProposals', () => {
  it('drops junk, unknown ids, bad phrases and targets outside the candidate options', () => {
    const lines: string[] = []
    const out = toProposals(
      [cand],
      [
        review({ target: { pkeys: ['en|9|ZZZ|R'] } }),
        review({ verdict: 'junk' }),
        review({ id: 'pkm:nope' }),
        review({ phrase: 'one two three four five' }),
        review({ phrase: 'x'.repeat(81) }),
        review({ phrase: '   ' }),
        review({ target: {} })
      ],
      (l) => lines.push(l)
    )
    expect(out).toEqual([])
    expect(lines).toHaveLength(6)
  })

  it('turns a valid review into a proposal with evidence cut to 5 titles', () => {
    expect(toProposals([cand], [review({})])).toEqual([
      {
        game: 'pkm',
        phrase: 'Bubble Mew',
        kind: 'nickname',
        targetKind: 'printing',
        target: { pkeys: ['en|1|PAF 232|SIR'] },
        evidence: { titles: ['a', 'b', 'c', 'd', 'e'], count: 7, sellers: 5, reason: 'Collectors call it that.' }
      }
    ])
  })

  it("keeps only the target kind's list and drops a review whose list is empty", () => {
    const stray = { pkeys: ['en|1|PAF 232|SIR'], cardIds: [1], sets: [], rarities: ['Special Illustration Rare'] }
    const out = toProposals(
      [cand],
      [
        review({ targetKind: 'card', target: stray }),
        review({ phrase: 'mew sets', targetKind: 'set', target: stray }),
        // The kind's own list outside the options still drops it; a stray one outside them doesn't matter.
        review({ phrase: 'mew rar', targetKind: 'rarity', target: { ...stray, rarities: ['Holofoil'] } }),
        review({ phrase: 'mew card', targetKind: 'card', target: { ...stray, pkeys: ['en|9|ZZZ|R'] } })
      ],
      () => {}
    )
    expect(out.map((p) => [p.phrase, p.targetKind, p.target])).toEqual([
      ['Bubble Mew', 'card', { cardIds: [1] }],
      ['mew card', 'card', { cardIds: [1] }]
    ])
  })
})

describe('ReviewsSchema', () => {
  it('fills a missing verdict and target lists, and refuses an unknown kind', () => {
    const [r] = ReviewsSchema.parse([
      { id: 'x', phrase: 'p', kind: 'nickname', targetKind: 'card', target: { cardIds: [1] }, reason: 'r' }
    ])
    expect(r.verdict).toBe('term')
    expect(r.target).toEqual({ pkeys: [], cardIds: [1], sets: [], rarities: [] })
    expect(() => ReviewsSchema.parse([{ ...r, kind: 'slang' }])).toThrow()
  })
})
