import { describe, expect, it } from 'vitest'
import { checkDeck } from '../../../src/shared/decks/check'
import { buildOpPack, type OpRulesFile } from '../../../src/shared/decks/onepiece/buildPack'
import type { PackState } from '../../../src/shared/decks/pack'
import type { DeckCard, DeckEntry, DeckSection } from '../../../src/shared/decks/types'

const rules = {
  banned: [{ card: 'OP03-040' }, { card: 'OP14-020', from: '2026-12-01' }],
  restricted: { 'OP05-002': 1 },
  bannedPairs: [
    { leader: 'OP13-001', cards: ['EB05-001'], from: '2026-11-27' },
    { leader: 'OP07-115', cards: ['EB04-058'] },
    { leader: 'OP09-001', cards: ['OP14-020'], from: '2026-12-01' }
  ]
}
const file: OpRulesFile = {
  asOf: '2026-11-22',
  source: 'https://en.onepiece-cardgame.com/rules/',
  formats: { standard: { ...rules, rotatedBlocks: [1], exempt: ['OP01-016'] }, extra: rules },
  setBlocks: { OP02: 1, OP10: 3 },
  unlimited: ['OP01-075']
}
const raw = buildOpPack(file, new Date('2026-11-22T03:00:00Z'))
const pack: PackState = { state: 'ready', pack: raw }
const today = '2026-11-22'

let nextId = 1
const reg: Record<number, DeckCard> = {}
function mk(
  name: string,
  num: string | null,
  type: string,
  colors: string[],
  block: number | null
): number {
  const id = nextId++
  reg[id] = {
    id,
    name,
    type: '',
    frameType: '',
    imageId: null,
    owned: 0,
    price: null,
    regionPrice: null,
    sourceId: null,
    code: null,
    opNumber: num,
    opCardType: type,
    opColors: colors,
    opCost: null,
    opBlock: block,
    mtgName: null,
    mtgTypeLine: null,
    mtgColorIdentity: [],
    mtgManaValue: null,
    mtgLayout: null
  }
  return id
}
const LUFFY = mk('Monkey.D.Luffy', 'OP13-001', 'Leader', ['Red', 'Green'], 4)
const SHANKS = mk('Shanks', 'OP09-001', 'Leader', ['Red'], 3)
const KIZARU_L = mk('Borsalino', 'OP07-115', 'Leader', ['Red'], 2)
const FILLER = mk('Red Filler', 'OP10-010', 'Character', ['Red'], 3)
/** 13 more Red Characters, so filler never breaks the 4-copy rule */
const FILLERS = Array.from({ length: 13 }, (_, i) =>
  mk(`Red Filler ${i}`, `OP10-${100 + i}`, 'Character', ['Red'], 3)
)
const BLUE = mk('Blue Card', 'OP10-050', 'Character', ['Blue'], 3)
const REDBLUE = mk('Red Blue Card', 'OP10-051', 'Character', ['Red', 'Blue'], 3)
const ZORO_EN = mk('Zoro', 'OP01-016', 'Character', ['Red'], 1)
const ZORO_JA = mk('ゾロ', 'OP01-016', 'Character', ['Red'], 1)
const OLD = mk('Old Card', 'OP01-020', 'Character', ['Red'], 1)
const BANNED = mk('Banned Card', 'OP03-040', 'Character', ['Red'], 2)
const SOON = mk('Soon Card', 'OP14-020', 'Character', ['Red'], 4)
const BONNEY = mk('Jewelry Bonney', 'EB05-001', 'Character', ['Green'], 4)
const RESTRICTED = mk('Restricted', 'OP05-002', 'Character', ['Red'], 2)
const NOBLOCK = mk('Set Block Card', 'OP02-030', 'Character', ['Red'], null)
const UNKNOWN = mk('Unknown Block', 'PRB09-001', 'Character', ['Red'], null)
const QUASAR = mk('I Re-Quasar', 'EB04-061', 'Event', ['Red'], 3)
const BORSALINO = mk('Borsalino', 'EB04-058', 'Character', ['Red'], 3)
const UTA = mk('Uta', 'OP02-001', 'Leader', ['Green'], 3)
const DON = mk('DON!!', 'DON!!', 'DON!!', [], null)
const PACIFISTA = mk('Pacifista', 'OP01-075', 'Character', ['Red'], 2)
/** A card just added from search: its facts aren't loaded yet. */
const FRESH = mk('Fresh Card', null, 'Character', [], null)

const e = (card: number, qty = 1, section: DeckSection = 'main'): DeckEntry => ({
  section,
  card,
  qty
})
/** n copies of Red filler, at most 4 of each. */
const fill = (n: number): DeckEntry[] => {
  const out: DeckEntry[] = []
  for (let i = 0; n > 0; i++) {
    out.push(e(FILLERS[i], Math.min(4, n)))
    n -= 4
  }
  return out
}
/** Leader + the extra cards + Red filler up to n in Deck. */
const deck = (
  n: number,
  extra: DeckEntry[] = [],
  format = 'standard',
  leader: DeckEntry[] = [e(LUFFY, 1, 'leader')]
) => {
  const have = extra.reduce((s, x) => s + (x.section === 'main' ? x.qty : 0), 0)
  return {
    game: 'op' as const,
    format,
    cards: [...leader, ...extra, ...fill(n - have)]
  }
}
const check = (d: ReturnType<typeof deck>, p: PackState = pack, day = today) =>
  checkDeck(d, reg, p, day)
const keys = (d: ReturnType<typeof deck>, p: PackState = pack, day = today) =>
  check(d, p, day).problems.map((x) => x.key)

describe('op checkDeck', () => {
  it('a legal Leader + 50 gives [] and status legal', () => {
    const v = check(deck(50))
    expect(v.problems).toEqual([])
    expect(v.status).toBe('legal')
    expect(v.packVersion).toBe('2026-11-22')
  })
  it('49 in Deck is count:main', () => {
    const p = check(deck(49)).problems
    expect(p.map((x) => x.key)).toEqual(['count:main'])
    expect(p[0]).toMatchObject({ severity: 'error', section: 'main' })
    expect(p[0].message).toBe('Deck has 49 cards; it needs exactly 50')
  })
  it('an empty Leader is count:leader only', () => {
    const p = check(deck(50, [e(BLUE)], 'standard', [])).problems
    expect(p.map((x) => x.key)).toEqual(['count:leader'])
    expect(p[0].message).toBe('Leader has 0 cards; it needs exactly 1')
  })
  it('a Character in Leader is leader:, a Leader in Deck is place:', () => {
    const p = check(deck(50, [e(SHANKS)], 'standard', [e(FILLER, 1, 'leader')])).problems
    expect(p.map((x) => x.key)).toEqual([`leader:${FILLER}`, `place:${SHANKS}`])
    expect(p[0].message).toBe("Red Filler isn't a Leader")
    expect(p[1].message).toBe('Shanks is a Leader; it goes in the Leader slot')
  })
  it('3 English + 2 Japanese OP01-016 is copies:OP01-016', () => {
    const p = check(deck(50, [e(ZORO_EN, 3), e(ZORO_JA, 2)])).problems
    expect(p.map((x) => x.key)).toEqual(['copies:OP01-016'])
    expect(p[0].message).toBe('5 × Zoro (OP01-016): at most 4 copies of each card')
  })
  it('a Blue card under a Red Leader is color:', () => {
    const p = check(deck(50, [e(BLUE)], 'standard', [e(SHANKS, 1, 'leader')])).problems
    expect(p.map((x) => x.key)).toEqual([`color:${BLUE}`])
    expect(p[0].message).toBe("Blue Card doesn't share a colour with Shanks")
  })
  it('a Red/Blue card under a Red/Green Leader is fine', () => {
    expect(keys(deck(50, [e(REDBLUE, 4)]))).toEqual([])
  })
  it('a banned number is banned: in both formats', () => {
    for (const f of ['standard', 'extra']) {
      const p = check(deck(50, [e(BANNED)], f)).problems.filter((x) => x.severity === 'error')
      expect(p.map((x) => x.key)).toEqual(['banned:OP03-040'])
    }
    expect(check(deck(50, [e(BANNED)], 'extra')).problems[0].message).toBe(
      'Banned Card is banned in Extra Regulation'
    )
  })
  it('a dated ban is soon: before its date and banned: on it', () => {
    const before = check(deck(50, [e(SOON)])).problems
    expect(before.map((x) => x.key)).toEqual(['soon:OP14-020'])
    expect(before[0]).toMatchObject({
      severity: 'warning',
      message: 'Soon Card is banned from Dec 1'
    })
    expect(keys(deck(50, [e(SOON)]), pack, '2026-12-01')).toEqual(['banned:OP14-020'])
  })
  it('Bonney under Luffy OP13-001 is soon: before 2026-11-27 and pair: on 2026-11-27', () => {
    const before = check(deck(50, [e(BONNEY)])).problems
    expect(before.map((x) => x.key)).toEqual(['soon:EB05-001'])
    expect(before[0]).toMatchObject({
      severity: 'warning',
      message: "Jewelry Bonney can't be used with Monkey.D.Luffy from Nov 27"
    })
    const on = check(deck(50, [e(BONNEY)]), pack, '2026-11-27').problems
    expect(on.map((x) => x.key)).toEqual(['pair:EB05-001'])
    expect(on[0]).toMatchObject({
      severity: 'error',
      message: "Jewelry Bonney can't be used with Monkey.D.Luffy"
    })
  })
  it('Bonney under another Leader is fine', () => {
    const other = [e(UTA, 1, 'leader')]
    for (const day of [today, '2026-11-27']) {
      const k = keys(deck(50, [e(BONNEY)], 'standard', other), pack, day)
      expect(k.filter((x) => /^(pair|soon):/.test(x))).toEqual([])
    }
  })
  it("a pair's card number counts as a Character in Deck too", () => {
    expect(keys(deck(50, [e(QUASAR), e(BORSALINO)]))).toEqual([])
    const ruled = {
      ...file,
      formats: {
        ...file.formats,
        standard: {
          ...file.formats.standard,
          bannedPairs: [{ leader: 'EB04-058', cards: ['EB04-061'] }]
        }
      }
    }
    const pk: PackState = { state: 'ready', pack: buildOpPack(ruled, new Date(today)) }
    const q = check(deck(50, [e(QUASAR), e(BORSALINO)]), pk).problems
    expect(q.map((x) => x.key)).toEqual(['pair:EB04-061'])
    expect(q[0].message).toBe("I Re-Quasar can't be used with Borsalino")
    expect(keys(deck(50, [e(QUASAR)]), pk)).toEqual([])
  })
  it('a pair with a Leader in the Leader slot', () => {
    const q = check(deck(50, [e(BORSALINO)], 'standard', [e(KIZARU_L, 1, 'leader')])).problems
    expect(q.map((x) => x.key)).toEqual(['pair:EB04-058'])
  })
  it('a dated ban and a dated pair on one number give one soon:, the ban message', () => {
    const p = check(deck(50, [e(SOON)], 'standard', [e(SHANKS, 1, 'leader')])).problems
    expect(p.map((x) => x.key)).toEqual(['soon:OP14-020'])
    expect(p[0].message).toBe('Soon Card is banned from Dec 1')
  })
  it('a restricted 1 with 2 copies is limit:', () => {
    const p = check(deck(50, [e(RESTRICTED, 2)])).problems
    expect(p.map((x) => x.key)).toEqual(['limit:OP05-002'])
    expect(p[0].message).toBe('2 × Restricted: at most 1 in Standard')
    expect(keys(deck(50, [e(RESTRICTED, 1)]))).toEqual([])
  })
  it('Block 1 card is rotated: in standard, fine in extra', () => {
    const p = check(deck(50, [e(OLD)])).problems
    expect(p.map((x) => x.key)).toEqual([`rotated:${OLD}`])
    expect(p[0].message).toBe('Old Card is from Block 1, which has left Standard')
    expect(keys(deck(50, [e(OLD)], 'extra'))).toEqual([])
  })
  it('an exempt Block 1 card is fine in standard', () => {
    expect(keys(deck(50, [e(ZORO_EN, 2), e(ZORO_JA, 2)]))).toEqual([])
  })
  it('a card with null opBlock uses setBlocks', () => {
    expect(keys(deck(50, [e(NOBLOCK)]))).toEqual([`rotated:${NOBLOCK}`])
    expect(keys(deck(50, [e(NOBLOCK)], 'extra'))).toEqual([])
  })
  it('with no block entry it adds to the block warning', () => {
    const v = check(deck(50, [e(UNKNOWN, 2)]))
    expect(v.problems.map((x) => x.key)).toEqual(['block'])
    expect(v.problems[0]).toMatchObject({
      severity: 'warning',
      message: "Couldn't check the block of 2 cards"
    })
    expect(check(deck(50, [e(UNKNOWN, 1)])).problems[0].message).toBe(
      "Couldn't check the block of 1 card"
    )
    expect(v.badge).toBe('Legal · 1 warning')
    expect(keys(deck(50, [e(UNKNOWN, 2)], 'extra'))).toEqual([])
  })
  it('a DON!! card in either section is don:', () => {
    const p = check(deck(50, [e(DON, 2)], 'standard', [e(DON, 1, 'leader')])).problems
    // One problem for the card wherever it is: not leader:, copies: or block.
    expect(p.map((x) => x.key)).toEqual([`don:${DON}`])
    expect(p.find((x) => x.key === `don:${DON}`)).toMatchObject({
      severity: 'error',
      cardId: DON,
      message: "DON!! is a DON!! card; it doesn't go in the deck"
    })
    expect(keys(deck(50, [e(DON, 10)]))).toEqual([`don:${DON}`])
    expect(keys(deck(50, [e(DON, 10)]), { state: 'missing' })).toEqual([`don:${DON}`])
  })
  it('a card whose facts are not loaded yet raises no number-based problem', () => {
    // Added from search: no number, block or colours until the deck is read again.
    expect(keys(deck(50, [e(FRESH, 1)]))).toEqual([])
    expect(keys(deck(50, [e(FRESH, 1)]), pack, '2026-12-01')).toEqual([])
    expect(keys(deck(50, [e(FRESH, 5)]))).toEqual([`copies:${FRESH}`])
  })
  it('an unlimited number takes any number of copies; other rules still apply', () => {
    expect(keys(deck(50, [e(PACIFISTA, 6)]), pack)).toEqual([])
    expect(keys(deck(50, [e(PACIFISTA, 6)], 'extra'))).toEqual([])
    // With no pack the 4-copy rule can't know the card is unlimited.
    expect(keys(deck(50, [e(PACIFISTA, 6)]), { state: 'missing' })).toEqual(['copies:OP01-075'])
    const limited = {
      ...file,
      formats: {
        ...file.formats,
        standard: { ...file.formats.standard, restricted: { 'OP01-075': 2 } }
      }
    }
    const pk: PackState = { state: 'ready', pack: buildOpPack(limited, new Date(today)) }
    expect(keys(deck(50, [e(PACIFISTA, 6)]), pk)).toEqual(['limit:OP01-075'])
  })
  it('cards missing from the catalog are skipped', () => {
    expect(keys(deck(50, [e(99999, 5)]))).toEqual([])
  })
  it('no pack: counts, placement, copies and colours still run; status unknown', () => {
    const missing: PackState = { state: 'missing' }
    const d = deck(50, [e(SHANKS), e(ZORO_EN, 5), e(BLUE), e(BANNED), e(OLD), e(BONNEY)])
    expect(keys(d, missing, '2026-11-27')).toEqual([
      'copies:OP01-016',
      `color:${BLUE}`,
      `place:${SHANKS}`
    ])
    const ok = check(deck(50), missing)
    expect(ok.status).toBe('unknown')
    expect(ok.packVersion).toBeNull()
    expect(keys(deck(49), missing)).toEqual(['count:main'])
  })
  it('a stale pack warns', () => {
    const old: PackState = { state: 'ready', pack: { ...raw, builtAt: '2026-10-01T00:00:00Z' } }
    const v = check(deck(50), old)
    expect(v.problems.map((p) => p.key)).toEqual(['stale'])
    expect(v.problems[0].message).toBe('The rules here are from 2026-10-01 and may be out of date')
  })
  it('problem keys stay within 64 characters', () => {
    const long = mk('Long', 'X'.repeat(80), 'Character', ['Red'], 3)
    const p = check(deck(50, [e(long, 5)])).problems
    expect(p.map((x) => x.key)).toEqual([`copies:${'X'.repeat(80)}`.slice(0, 64)])
  })
})
