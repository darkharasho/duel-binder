import { describe, expect, it } from 'vitest'
import { classify, type ClassifyClient } from '../../scripts/terms/classify'
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

function fake(results: unknown[], stop = 'end_turn'): ClassifyClient {
  return {
    beta: {
      messages: {
        parse: async () => ({
          stop_reason: stop,
          parsed_output: { results },
          usage: { input_tokens: 100, output_tokens: 10 }
        })
      }
    }
  } as unknown as ClassifyClient
}

describe('classify', () => {
  it('drops junk and targets outside the candidate options', async () => {
    const client = fake([
      result({ target: { pkeys: ['en|9|ZZZ|R'], cardIds: [], sets: [], rarities: [] } }),
      result({ verdict: 'junk' }),
      result({ phrase: 'one two three four five' }),
      result({ phrase: 'x'.repeat(81) }),
      result({ phrase: '   ' }),
      result({ target: { pkeys: [], cardIds: [], sets: [], rarities: [] } })
    ])
    const out = await classify(client, 'pkm', [cand])
    expect(out).toEqual([])
  })

  it('turns a valid result into a proposal with evidence cut to 5 titles', async () => {
    const usage = { input: 0, output: 0 }
    const out = await classify(fake([result({})]), 'pkm', [cand], usage)
    expect(out).toEqual([
      {
        game: 'pkm',
        phrase: 'Bubble Mew',
        kind: 'nickname',
        targetKind: 'printing',
        target: { pkeys: ['en|1|PAF 232|SIR'], cardIds: [], sets: [], rarities: [] },
        evidence: { titles: ['a', 'b', 'c', 'd', 'e'], count: 7, sellers: 5, reason: 'Collectors call it that.' }
      }
    ])
    expect(usage).toEqual({ input: 100, output: 10 })
  })

  it('skips a refused batch and one the model left unparsed', async () => {
    expect(await classify(fake([result({})], 'refusal'), 'pkm', [cand])).toEqual([])
    const nulled = {
      beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } }) } }
    } as unknown as ClassifyClient
    expect(await classify(nulled, 'pkm', [cand])).toEqual([])
  })
})
