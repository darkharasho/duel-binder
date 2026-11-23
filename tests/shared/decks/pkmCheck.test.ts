import { describe, expect, it } from 'vitest'
import { checkDeck } from '../../../src/shared/decks/check'
import { buildPkmPack, type PkmPackCard } from '../../../src/shared/decks/pokemon/buildPack'
import { sortEntries } from '../../../src/shared/decks/sort'
import type { PackState, PkmRulesPack } from '../../../src/shared/decks/pack'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const L = { standard: true, expanded: true }
const cards: PkmPackCard[] = [
  { id: 'a-1', name: 'Pikachu', category: 'Pokemon', stage: 'Basic', legal: L },
  { id: 'a-2', name: 'Raichu', category: 'Pokemon', stage: 'Stage 1', legal: L },
  { id: 'b-1', name: 'Ultra Ball', category: 'Trainer', legal: L },
  { id: 'b-2', name: 'Ultra Ball', category: 'Trainer', legal: L, attacks: [] },
  { id: 'e-1', name: 'Fire Energy', category: 'Energy', energyType: 'Normal', legal: L },
  { id: 'e-2', name: 'Double Turbo Energy', category: 'Energy', energyType: 'Special', legal: L },
  { id: 'ace-1', name: 'Maximum Belt', category: 'Trainer', rarity: 'ACE SPEC Rare', legal: L },
  { id: 'ace-2', name: 'Prime Catcher', category: 'Trainer', rarity: 'ACE SPEC Rare', legal: L },
  { id: 'r-1', name: 'Radiant Charizard', category: 'Pokemon', stage: 'Basic', legal: L },
  { id: 'r-2', name: 'Radiant Greninja', category: 'Pokemon', stage: 'Basic', legal: L },
  { id: 'old-1', name: 'Old Card', category: 'Trainer', legal: { expanded: true } },
  { id: 'ban-1', name: 'Lysandre Labs', category: 'Trainer', legal: L },
  { id: 'j-1', name: 'Mew', category: 'Pokemon', stage: 'Basic', legal: L },
  {
    id: 'j-2',
    name: 'Mew',
    category: 'Pokemon',
    stage: 'Basic',
    legal: { expanded: true },
    attacks: [{ name: 'Psy' }]
  }
]
const raw: PkmRulesPack = buildPkmPack(
  cards,
  { banned: { standard: [], expanded: ['ban-1'] }, override: {} },
  new Date('2026-11-22T03:00:00Z'),
  0
)
const pack: PackState = { state: 'ready', pack: raw }
const today = '2026-11-22'

let nextId = 1
const reg: Record<number, DeckCard> = {}
function mk(name: string, type: string, sourceId: string | null): number {
  const id = nextId++
  reg[id] = {
    id,
    name,
    type,
    frameType: '',
    imageId: null,
    owned: 0,
    price: null,
    regionPrice: null,
    sourceId,
    code: null
  }
  return id
}
const PIKA = mk('Pikachu', 'Pokémon', 'en/a-1')
const RAICHU = mk('Raichu', 'Pokémon', 'en/a-2')
const BALL1 = mk('Ultra Ball', 'Trainer', 'en/b-1')
const BALL2 = mk('Ultra Ball', 'Trainer', 'en/b-2')
const FIRE = mk('Fire Energy', 'Energy', 'en/e-1')
const TURBO = mk('Double Turbo Energy', 'Energy', 'en/e-2')
const ACE1 = mk('Maximum Belt', 'Trainer', 'en/ace-1')
const ACE2 = mk('Prime Catcher', 'Trainer', 'en/ace-2')
const RAD1 = mk('Radiant Charizard', 'Pokémon', 'en/r-1')
const RAD2 = mk('Radiant Greninja', 'Pokémon', 'en/r-2')
const OLD = mk('Old Card', 'Trainer', 'en/old-1')
const BAN = mk('Lysandre Labs', 'Trainer', 'en/ban-1')
const JMEW = mk('Mew', 'Pokémon', 'ja/SV1-001')

const e = (card: number, qty = 1): DeckEntry => ({ section: 'main', card, qty })
/** Pikachu x4 plus filler Energy to reach n cards. */
const deck = (n: number, extra: DeckEntry[] = [], format = 'standard') => {
  const have = 4 + extra.reduce((s, x) => s + x.qty, 0)
  return {
    game: 'pkm' as const,
    format,
    cards: [e(PIKA, 4), ...extra, e(FIRE, n - have)]
  }
}
const keys = (d: ReturnType<typeof deck>, p: PackState = pack) =>
  checkDeck(d, reg, p, today).problems.map((x) => x.key)

describe('pkm checkDeck', () => {
  it('a legal 60', () => {
    const v = checkDeck(deck(60), reg, pack, today)
    expect(v.problems).toEqual([])
    expect(v.status).toBe('legal')
  })
  it('59 and 61 are count errors', () => {
    for (const n of [59, 61]) {
      const p = checkDeck(deck(n), reg, pack, today).problems[0]
      expect(p).toMatchObject({ key: 'count:main', severity: 'error' })
      expect(p.message).toBe(`Deck has ${n} cards; it needs exactly 60`)
    }
  })
  it('copies by name across printings; basic Energy exempt', () => {
    const v = checkDeck(deck(60, [e(BALL1, 3), e(BALL2, 2)]), reg, pack, today)
    expect(v.problems).toHaveLength(1)
    expect(v.problems[0]).toMatchObject({ key: 'copies:ultra ball', severity: 'error' })
    expect(v.problems[0].message).toBe(
      '5 × Ultra Ball: at most 4 copies of cards with the same name'
    )
    expect(keys(deck(60, [e(FIRE, 16)]))).toEqual([])
    expect(keys(deck(60, [e(TURBO, 5)]))).toEqual(['copies:double turbo energy'])
  })
  it('two ACE SPECs, two Radiants', () => {
    const a = checkDeck(deck(60, [e(ACE1), e(ACE2)]), reg, pack, today).problems
    expect(a).toHaveLength(1)
    expect(a[0].key).toBe('ace')
    expect(a[0].message).toBe('2 ACE SPEC cards: at most 1 in a deck')
    const r = checkDeck(deck(60, [e(RAD1), e(RAD2)]), reg, pack, today).problems
    expect(r.map((p) => p.key)).toEqual(['radiant'])
    expect(r[0].message).toBe('2 Radiant Pokémon: at most 1 in a deck')
  })
  it('no Basic Pokémon', () => {
    const d = { game: 'pkm' as const, format: 'standard', cards: [e(RAICHU, 4), e(FIRE, 56)] }
    const p = checkDeck(d, reg, pack, today).problems
    expect(p.map((x) => x.key)).toEqual(['basic'])
    expect(p[0].message).toBe('The deck needs at least one Basic Pokémon')
  })
  it('a card with no legal key is a legal error in standard only', () => {
    const std = checkDeck(deck(60, [e(OLD)]), reg, pack, today).problems
    expect(std.map((x) => x.key)).toEqual([`legal:${OLD}`])
    expect(std[0].message).toBe("Old Card isn't legal in Standard")
    expect(keys(deck(60, [e(OLD)], 'expanded'))).toEqual([])
  })
  it('a banned key is a banned error in expanded only', () => {
    expect(keys(deck(60, [e(BAN)]))).toEqual([])
    const x = checkDeck(deck(60, [e(BAN)], 'expanded'), reg, pack, today).problems
    expect(x.map((p) => p.key)).toEqual([`banned:${BAN}`])
    expect(x[0].message).toBe('Lysandre Labs is banned in Expanded')
  })
  it('a Japanese Pikachu-like card with two keys is an unsure warning', () => {
    const v = checkDeck(deck(60, [e(JMEW)]), reg, pack, today)
    expect(v.problems.map((p) => p.key)).toEqual([`unsure:${JMEW}`])
    expect(v.problems[0].severity).toBe('warning')
    expect(v.problems[0].message).toBe(
      'Mew: several English cards share this name; pin an English printing to check exactly'
    )
    expect(v.badge).toBe('Legal · 1 warning')
  })
  it('no pack: count and copies run, status unknown', () => {
    const missing: PackState = { state: 'missing' }
    const v = checkDeck(deck(60, [e(BALL1, 5)]), reg, missing, today)
    expect(v.problems.map((p) => p.key)).toEqual(['copies:ultra ball'])
    const ok = checkDeck(deck(60), reg, missing, today)
    expect(ok.status).toBe('unknown')
    expect(keys(deck(59), missing)).toEqual(['count:main'])
  })
  it('a stale pack warns', () => {
    const old: PackState = { state: 'ready', pack: { ...raw, builtAt: '2026-10-01T00:00:00Z' } }
    const v = checkDeck(deck(60), reg, old, today)
    expect(v.problems.map((p) => p.key)).toEqual(['stale'])
    expect(v.problems[0].message).toBe('The rules here are from 2026-10-01 and may be out of date')
  })
})

describe('pkm sort', () => {
  it('Pokémon, Trainer, Energy, unknown', () => {
    const odd = mk('Aaa', 'Weird', null)
    const sorted = sortEntries('pkm', [e(FIRE), e(odd), e(BALL1), e(RAICHU), e(PIKA)], reg)
    expect(sorted.map((x) => x.card)).toEqual([PIKA, RAICHU, BALL1, FIRE, odd])
  })
})
