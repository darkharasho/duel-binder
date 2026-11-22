import { describe, expect, it } from 'vitest'
import { checkDeck, verdictChange, verdictMark } from '../../../src/shared/decks/check'
import type { DeckVerdict } from '../../../src/shared/decks/check'
import type { PackState } from '../../../src/shared/decks/pack'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const ASH = 14558127
const POT = 55144522
const BORRELOAD = 31833038
const MAXX = 23434538
const PENDX = 41000001
const FUTURE = 77777777
const FILLER = 10000000

function card(id: number, name: string, frameType: string): DeckCard {
  return { id, name, type: '', frameType, imageId: null, owned: 0, price: null, regionPrice: null }
}
const cards: Record<number, DeckCard> = {
  [ASH]: card(ASH, 'Ash Blossom & Joyous Spring', 'effect'),
  [POT]: card(POT, 'Pot of Greed', 'spell'),
  [BORRELOAD]: card(BORRELOAD, 'Borreload Dragon', 'link'),
  [MAXX]: card(MAXX, 'Maxx "C"', 'effect'),
  [PENDX]: card(PENDX, 'Odd-Eyes Xyz', 'xyz_pendulum'),
  [FUTURE]: card(FUTURE, 'Future Card', 'effect'),
  [FILLER]: card(FILLER, 'Filler', 'normal')
}
const pack: PackState = {
  state: 'ready',
  pack: {
    schema: 1,
    game: 'ygo',
    version: '2026-11-22',
    builtAt: '2026-11-22T03:00:00Z',
    sources: [],
    formats: {
      advanced: { limits: { [POT]: 0, [MAXX]: 0 }, notReleased: { [FUTURE]: '2026-12-05' } },
      ocg: { limits: { [MAXX]: 1 }, notReleased: { [FUTURE]: null } }
    }
  }
}
const today = '2026-11-22'
const e = (section: DeckEntry['section'], card: number, qty = 1): DeckEntry => ({
  section,
  card,
  qty
})
// 40 distinct-ish filler: 3 + 3 + ... use qty 3 of filler ids is not possible (same id) so spread ids
function mainOf(n: number): DeckEntry[] {
  const out: DeckEntry[] = []
  for (let i = 0; i < n; i++) out.push(e('main', 20000000 + Math.floor(i / 3), 1))
  return out
}
function run(format: string, entries: DeckEntry[], p: PackState = pack, c = cards, t = today) {
  return checkDeck({ game: 'ygo', format, cards: entries }, c, p, t)
}
const legalCards = (): DeckEntry[] => [
  ...mainOf(40),
  ...Array.from({ length: 15 }, (_, i) => e('extra', 30000000 + i))
]
const msgs = (v: DeckVerdict) => v.problems.map((p) => p.message)

describe('checkDeck ygo', () => {
  it('main under 40', () => {
    const v = run('advanced', mainOf(38))
    expect(v.problems[0]).toMatchObject({
      key: 'count:main',
      severity: 'error',
      message: 'Main Deck has 38 cards; it needs at least 40'
    })
    expect(v.status).toBe('illegal')
    expect(v.badge).toBe('Not legal')
  })
  it('main over 60', () => {
    expect(msgs(run('advanced', mainOf(62)))).toContain('Main Deck has 62 cards; the limit is 60')
  })
  it('extra and side over 15', () => {
    const v = run('advanced', [
      ...mainOf(40),
      ...Array.from({ length: 16 }, (_, i) => e('extra', 30000000 + i)),
      ...Array.from({ length: 16 }, (_, i) => e('side', 40000000 + i))
    ])
    expect(msgs(v)).toContain('Extra Deck has 16 cards; the limit is 15')
    expect(msgs(v)).toContain('Side Deck has 16 cards; the limit is 15')
  })
  it('four copies across sections', () => {
    const v = run('advanced', [...mainOf(40), e('main', ASH, 2), e('side', ASH, 2)])
    expect(v.problems.find((p) => p.key === `copies:${ASH}`)?.message).toBe(
      '4 × Ash Blossom & Joyous Spring: at most 3 copies across Main, Extra and Side'
    )
  })
  it('forbidden', () => {
    const v = run('advanced', [...mainOf(40), e('main', POT, 3)])
    expect(v.problems.find((p) => p.key === `limit:${POT}`)?.message).toBe(
      '3 × Pot of Greed: Forbidden in Advanced'
    )
  })
  it('limited by format', () => {
    const d = [...mainOf(40), e('main', MAXX, 2)]
    expect(run('ocg', d).problems.find((p) => p.key === `limit:${MAXX}`)?.message).toBe(
      '2 × Maxx "C": Limited to 1 in OCG'
    )
    expect(run('advanced', d).problems.find((p) => p.key === `limit:${MAXX}`)?.message).toBe(
      '2 × Maxx "C": Forbidden in Advanced'
    )
  })
  it('semi-limited', () => {
    const p: PackState = {
      state: 'ready',
      pack: {
        ...(pack as { pack: never }).pack,
        formats: {
          advanced: { limits: { [ASH]: 2 }, notReleased: {} },
          ocg: { limits: {}, notReleased: {} }
        }
      }
    }
    const v = run('advanced', [...mainOf(40), e('main', ASH, 3)], p)
    expect(v.problems.find((q) => q.key === `limit:${ASH}`)?.message).toBe(
      '3 × Ash Blossom & Joyous Spring: Semi-Limited to 2 in Advanced'
    )
  })
  it('extra monster in main', () => {
    const v = run('advanced', [...mainOf(40), e('main', BORRELOAD)])
    expect(v.problems.find((p) => p.key === `place:${BORRELOAD}:main`)?.message).toBe(
      'Borreload Dragon is a Link Monster and belongs in the Extra Deck'
    )
    const px = run('advanced', [...mainOf(40), e('main', PENDX)])
    expect(msgs(px)).toContain(
      'Odd-Eyes Xyz is a Pendulum Xyz Monster and belongs in the Extra Deck'
    )
  })
  it('main-deck card in extra', () => {
    const v = run('advanced', [...mainOf(40), e('extra', ASH)])
    expect(v.problems.find((p) => p.key === `place:${ASH}:extra`)?.message).toBe(
      "Ash Blossom & Joyous Spring can't go in the Extra Deck"
    )
  })
  it('extra monster in side is fine', () => {
    const v = run('advanced', [...mainOf(40), e('side', BORRELOAD)])
    expect(v.problems.filter((p) => p.key.startsWith('place:'))).toEqual([])
  })
  it('not out yet is a warning', () => {
    const d = [...legalCards(), e('side', FUTURE)]
    const v = run('advanced', d)
    expect(v.problems).toEqual([
      {
        key: `region:${FUTURE}`,
        severity: 'warning',
        cardId: FUTURE,
        message: 'Future Card comes out in the TCG on 2026-12-05'
      }
    ])
    expect(v.status).toBe('warnings')
    expect(v.badge).toBe('Legal · 1 warning')
    expect(msgs(run('ocg', d))).toEqual(["Future Card isn't out in the OCG yet"])
  })
  it('stale pack is a warning', () => {
    const v = run('advanced', legalCards(), pack, cards, '2026-12-07')
    expect(v.problems).toEqual([
      {
        key: 'stale',
        severity: 'warning',
        message: 'The ban list here is from 2026-11-22 and may be out of date'
      }
    ])
    const stale = run('advanced', legalCards(), pack, cards, '2026-12-07')
    expect(stale.badge).toBe('Legal · 1 warning')
  })
  it('stale message uses a date 15 days back', () => {
    const v = run('advanced', legalCards(), pack, cards, '2026-12-07')
    expect(v.problems[0].message).toContain('2026-11-22')
    expect(run('advanced', legalCards(), pack, cards, '2026-12-06').problems).toEqual([])
  })
  it('two warnings pluralise', () => {
    const v = run('ocg', [...legalCards(), e('side', FUTURE)], pack, cards, '2026-12-07')
    expect(v.badge).toBe('Legal · 2 warnings')
  })
  it('legal deck', () => {
    const v = run('advanced', legalCards())
    expect(v).toMatchObject({
      status: 'legal',
      badge: 'Legal',
      problems: [],
      packVersion: '2026-11-22'
    })
  })
  it('no pack never reads Legal', () => {
    const v = run('advanced', legalCards(), { state: 'missing' })
    expect(v).toMatchObject({ status: 'unknown', badge: 'Legality unknown', packVersion: null })
    const bad = run('advanced', mainOf(30), { state: 'missing' })
    expect(bad.status).toBe('illegal')
    expect(bad.packVersion).toBeNull()
  })
  it('newer pack schema', () => {
    expect(run('advanced', legalCards(), { state: 'tooNew' })).toMatchObject({
      status: 'update',
      badge: 'Update to check legality'
    })
  })
  it('unknown card counts but has no placement problem', () => {
    const v = run('advanced', [...mainOf(39), e('main', 99999999)])
    expect(v.problems).toEqual([])
    const extra = run('advanced', [...mainOf(40), e('extra', 99999999, 4)])
    expect(extra.problems.map((p) => p.key)).toEqual(['copies:99999999'])
    expect(extra.problems[0].message).toBe(
      '4 × Card #99999999: at most 3 copies across Main, Extra and Side'
    )
  })
  it('orders errors before warnings, counts before copies before limits', () => {
    const v = run('advanced', [...mainOf(30), e('main', POT, 4), e('side', FUTURE)])
    expect(v.problems.map((p) => p.key)).toEqual([
      'count:main',
      `copies:${POT}`,
      `limit:${POT}`,
      `region:${FUTURE}`
    ])
  })
})

describe('verdictMark / verdictChange', () => {
  it('marks null without a pack version', () => {
    expect(verdictMark(run('advanced', legalCards(), { state: 'missing' }))).toBeNull()
    const v = run('advanced', [...mainOf(40), e('main', POT, 1)])
    expect(verdictMark(v)).toEqual({
      status: 'illegal',
      problems: [`limit:${POT}`],
      packVersion: '2026-11-22'
    })
  })
  it('names what flipped', () => {
    const seen = { status: 'legal' as const, problems: [], packVersion: '2026-11-01' }
    const problem = { key: `limit:${MAXX}`, severity: 'error' as const, message: 'x', cardId: MAXX }
    const v: DeckVerdict = {
      status: 'illegal',
      badge: 'Not legal',
      problems: [problem],
      packVersion: '2026-12-01'
    }
    expect(verdictChange(seen, v)).toEqual({ version: '2026-12-01', added: [problem], cleared: [] })
    expect(verdictChange(seen, { ...v, packVersion: '2026-11-01' })).toBeNull()
    expect(verdictChange(null, v)).toBeNull()
    expect(verdictChange(seen, { ...v, status: 'warnings' })).toBeNull()
  })
})
