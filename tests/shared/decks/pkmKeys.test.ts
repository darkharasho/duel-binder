import { describe, expect, it } from 'vitest'
import { keyIndex, keyOfCard, pkmKind } from '../../../src/shared/decks/pokemon/keys'
import type { PkmRulesPack } from '../../../src/shared/decks/pack'
import type { DeckCard } from '../../../src/shared/decks/types'

const pack = {
  schema: 1,
  game: 'pkm',
  version: 'v',
  builtAt: '',
  sources: [],
  keys: [
    { n: 'Ultra Ball', k: 'T', f: 0, l: 3 },
    { n: 'Pikachu', k: 'P', f: 1, l: 3 },
    { n: 'Pikachu', k: 'P', f: 1, l: 3 },
    { n: 'Boss’s Orders', k: 'T', f: 0, l: 3 }
  ],
  ids: { sv01: { '196': 0 } },
  formats: { standard: { banned: [] }, expanded: { banned: [] } }
} as PkmRulesPack
const card = (name: string, sourceId: string | null): DeckCard => ({
  id: 1,
  name,
  type: 'Trainer',
  frameType: '',
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null,
  sourceId,
  code: null
})

describe('pokemon keys', () => {
  const index = keyIndex(pack)
  it('hits through ids', () => {
    expect(keyOfCard(card('Balle Ultra', 'fr/sv01-196'), pack, index)).toEqual({ key: 0 })
  })
  it('falls back to a single name key', () => {
    expect(keyOfCard(card('Ultra Ball', 'ja/SV1a-001'), pack, index)).toEqual({ key: 0 })
    expect(keyOfCard(card("Boss's Orders", null), pack, index)).toEqual({ key: 3 })
  })
  it('several name keys are unsure', () => {
    expect(keyOfCard(card('Pikachu', 'ja/SV1a-002'), pack, index)).toEqual({ unsure: [1, 2] })
  })
  it('an unknown name is none', () => {
    expect(keyOfCard(card('Nope', null), pack, index)).toEqual({ none: true })
  })
  it('pkmKind', () => {
    expect(pkmKind('Énergie')).toBe('E')
    expect(pkmKind('トレーナーズ')).toBe('T')
    expect(pkmKind('Spell Card')).toBeNull()
    expect(pkmKind('Entrenador')).toBe('T')
  })
})
