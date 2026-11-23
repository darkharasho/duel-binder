import { describe, expect, it } from 'vitest'
import { checkDeck } from '../../../src/shared/decks/check'
import { formatOf } from '../../../src/shared/decks/formats'
import { buildMtgPack, type MtgPackCard } from '../../../src/shared/decks/magic/buildPack'
import { checkMtg, validPair } from '../../../src/shared/decks/magic/check'
import type { PackState } from '../../../src/shared/decks/pack'
import type { DeckCard, DeckEntry, DeckSection } from '../../../src/shared/decks/types'

const today = '2026-11-23'
const ALL = Object.fromEntries(
  ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'].map((f) => [
    f,
    'legal'
  ])
)
const pc = (o: Partial<MtgPackCard> & { name: string }): MtgPackCard => ({
  layout: 'normal',
  legalities: ALL,
  released_at: '2020-01-01',
  ...o
})
const legendary = (name: string, text = '', keywords: string[] = []): MtgPackCard =>
  pc({ name, type_line: 'Legendary Creature — Human', oracle_text: text, keywords })

const packCards: MtgPackCard[] = [
  pc({ name: 'Lightning Bolt' }),
  pc({ name: 'Mountain', type_line: 'Basic Land — Mountain' }),
  pc({
    name: 'Relentless Rats',
    oracle_text: 'A deck can have any number of cards named Relentless Rats.'
  }),
  pc({
    name: 'Seven Dwarves',
    oracle_text: 'A deck can have up to seven cards named Seven Dwarves.'
  }),
  pc({ name: 'Banned Card', legalities: { ...ALL, modern: 'banned' } }),
  pc({ name: 'Not Pioneer', legalities: { ...ALL, pioneer: 'not_legal' } }),
  pc({ name: 'Black Lotus', legalities: { ...ALL, vintage: 'restricted' } }),
  pc({ name: 'Future Card', released_at: '2026-12-05' }),
  legendary('Red Boss'),
  legendary('Boros Boss'),
  legendary('Thrasios', 'Partner', ['Partner']),
  legendary('Tymna', 'Partner', ['Partner']),
  legendary('Pir', 'Partner with Toothy, Imaginary Friend'),
  legendary('Toothy, Imaginary Friend', 'Partner with Pir, Imaginary Friend'),
  legendary('Pir, Imaginative Rascal', 'Partner with Toothy, Imaginary Friend'),
  legendary('Wizard Chooser', 'Choose a Background'),
  pc({ name: 'Cool Background', type_line: 'Legendary Enchantment — Background' }),
  legendary('Doc Companion', "Doctor's companion"),
  pc({ name: 'The Doctor', type_line: 'Legendary Creature — Time Lord Doctor' }),
  legendary('Sidekick A', 'Partner—Survivors'),
  legendary('Sidekick B', 'Partner—Survivors'),
  legendary('Sidekick C', 'Partner—Father & Son'),
  pc({ name: 'Plain Human', type_line: 'Creature — Human' })
]
const fillerNames: string[] = Array.from({ length: 120 }, (_, i) => `Filler ${i}`)
packCards.push(...fillerNames.map((name) => pc({ name })))
packCards.push(
  pc({ name: 'Colourless Rock', type_line: 'Artifact' }),
  pc({ name: 'Boros Card', type_line: 'Instant' }),
  pc({ name: 'Blue Card', type_line: 'Creature — Merfolk' })
)
const raw = buildMtgPack(packCards, {
  version: '2026-11-23T03:00:00+00:00',
  builtAt: new Date('2026-11-23T03:00:00Z')
})
const pack: PackState = { state: 'ready', pack: raw }
// Pir's partner is named "Toothy, Imaginary Friend" after the rules text.
raw.commander['Pir, Imaginative Rascal'] = 'partner-with:Toothy, Imaginary Friend'
raw.commander['Toothy, Imaginary Friend'] = 'partner-with:Pir, Imaginative Rascal'

let nextId = 1
const reg: Record<number, DeckCard> = {}
const ids = new Map<string, number>()
function mk(name: string, type = 'Creature — Human', identity: string[] = [], lang = ''): number {
  const key = `${name}|${lang}`
  const have = ids.get(key)
  if (have) return have
  const id = nextId++
  ids.set(key, id)
  reg[id] = {
    id,
    name: lang ? `${name} (${lang})` : name,
    type: '',
    frameType: '',
    imageId: null,
    owned: 0,
    price: null,
    regionPrice: null,
    sourceId: null,
    code: null,
    opNumber: null,
    opCardType: null,
    opColors: [],
    opCost: null,
    opBlock: null,
    mtgName: name,
    mtgTypeLine: type,
    mtgColorIdentity: identity,
    mtgManaValue: null,
    mtgLayout: null
  }
  return id
}
const e = (card: number, qty = 1, section: DeckSection = 'main'): DeckEntry => ({
  section,
  card,
  qty
})
/** n filler cards (distinct names, `per` each, colourless and legal everywhere in the pack). */
const fill = (n: number, per = 4, section: DeckSection = 'main'): DeckEntry[] => {
  const out: DeckEntry[] = []
  for (let i = 0; n > 0; i++) {
    const q = Math.min(per, n)
    out.push(e(mk(fillerNames[i], 'Creature — Human', []), q, section))
    n -= q
  }
  return out
}
const keys = (f: string, cards: DeckEntry[], p: PackState = pack) =>
  checkDeck({ game: 'mtg', format: f, cards }, reg, p, today).problems.map((x) => x.key)
const run = (f: string, cards: DeckEntry[], p: typeof raw | null = raw) =>
  checkMtg({ format: f, cards }, formatOf('mtg', f)!, reg, p, today)

const BOLT = mk('Lightning Bolt', 'Instant', ['R'])
const commanderDeck = (boss: number, extra: DeckEntry[] = []): DeckEntry[] => {
  const used = extra.reduce((s, x) => s + (x.section === 'main' ? x.qty : 0), 0)
  return [e(boss, 1, 'commander'), ...extra, ...fill(99 - used, 1)]
}

describe('checkMtg: 60-card formats', () => {
  it('a legal 60 + 15 modern deck gives [] and status legal', () => {
    const side = Array.from({ length: 15 }, (_, i) => e(mk(fillerNames[15 + i]), 1, 'side'))
    const v = checkDeck(
      { game: 'mtg', format: 'modern', cards: [...fill(60), ...side] },
      reg,
      pack,
      today
    )
    expect(v.problems).toEqual([])
    expect(v.status).toBe('legal')
  })
  it('59 main is count:main, 16 side is count:side', () => {
    expect(keys('modern', fill(59))).toEqual(['count:main'])
    const side = Array.from({ length: 16 }, (_, i) => e(mk(fillerNames[15 + i]), 1, 'side'))
    expect(keys('modern', [...fill(60), ...side])).toEqual(['count:side'])
  })
  it('3 English + 2 Japanese Lightning Bolt is copies:', () => {
    const jp = mk('Lightning Bolt', 'Instant', ['R'], 'ja')
    const k = keys('modern', [e(BOLT, 3), e(jp, 2), ...fill(55)])
    expect(k).toEqual([`copies:${BOLT}`])
  })
  it('24 basic Mountains are fine', () => {
    const m = mk('Mountain', 'Basic Land — Mountain')
    expect(keys('modern', [e(m, 24), ...fill(36)])).toEqual([])
  })
  it('Relentless Rats unlimited; 8 Seven Dwarves is copies: with cap 7', () => {
    const rats = mk('Relentless Rats')
    const d = mk('Seven Dwarves')
    expect(keys('modern', [e(rats, 30), ...fill(30)])).toEqual([])
    const p = run('modern', [e(d, 8), ...fill(52)])
    expect(p.map((x) => x.key)).toEqual([`copies:${d}`])
    expect(p[0].message).toBe('8 × Seven Dwarves: at most 7 copies')
    expect(keys('modern', [e(d, 7), ...fill(53)])).toEqual([])
  })
  it('a banned card is banned:, a not-Pioneer card is legal:', () => {
    const b = mk('Banned Card')
    expect(keys('modern', [e(b), ...fill(59)])).toEqual([`banned:${b}`])
    const n = mk('Not Pioneer')
    const p = run('pioneer', [e(n), ...fill(59)])
    expect(p.map((x) => x.key)).toEqual([`legal:${n}`])
    expect(p[0].message).toBe("Not Pioneer isn't legal in Pioneer")
  })
  it('Black Lotus main + side in vintage is limit:', () => {
    const l = mk('Black Lotus')
    expect(keys('vintage', [e(l), e(l, 1, 'side'), ...fill(59)])).toEqual([`limit:${l}`])
    expect(keys('vintage', [e(l), ...fill(59)])).toEqual([])
  })
  it('an upcoming card is soon:, not legal:; gone on its date', () => {
    const f = mk('Future Card')
    const cards = [e(f), ...fill(59)]
    expect(keys('modern', cards)).toEqual([`soon:${f}`])
    const later = checkMtg(
      { format: 'modern', cards },
      formatOf('mtg', 'modern')!,
      reg,
      raw,
      '2026-12-05'
    )
    expect(later).toEqual([])
  })
  it('a card missing from the pack adds to unsure', () => {
    const x = mk('Mystery Card')
    const p = run('modern', [e(x, 2), ...fill(58)])
    expect(p).toEqual([{ key: 'unsure', severity: 'warning', message: "Couldn't check 2 cards" }])
    expect(
      checkDeck({ game: 'mtg', format: 'modern', cards: [e(x, 2), ...fill(58)] }, reg, pack, today)
        .status
    ).toBe('warnings')
  })
  it('no pack: counts, copies (no cap) and colour still run; status unknown', () => {
    const rats = mk('Relentless Rats')
    const missing: PackState = { state: 'missing' }
    expect(keys('modern', [e(rats, 5), ...fill(50)], missing)).toEqual([
      'count:main',
      `copies:${rats}`
    ])
    const ok = checkDeck({ game: 'mtg', format: 'modern', cards: fill(60) }, reg, missing, today)
    expect(ok.status).toBe('unknown')
    const boss = mk('Red Boss', 'Legendary Creature — Human', ['R'])
    const blue = mk('Blue Card', 'Creature — Merfolk', ['U'])
    const p = run('commander', [e(boss, 1, 'commander'), e(blue), ...fill(98, 1)], null)
    expect(p.map((x) => x.key)).toEqual([`color:${blue}`])
  })
})

describe('checkMtg: Commander', () => {
  const boss = mk('Red Boss', 'Legendary Creature — Human', ['R'])
  it('a 100-card deck with one Legendary Creature is legal', () => {
    const v = checkDeck(
      { game: 'mtg', format: 'commander', cards: commanderDeck(boss) },
      reg,
      pack,
      today
    )
    expect(v.problems).toEqual([])
    expect(v.status).toBe('legal')
  })
  it('99 cards is count:total only (Main 98 is in range, not double-reported)', () => {
    const cards = [e(boss, 1, 'commander'), ...fill(98, 1)]
    const p = run('commander', cards)
    expect(p.map((x) => x.key)).toEqual(['count:total'])
    expect(p[0].message).toBe('The deck has 99 cards; Commander needs exactly 100')
  })
  it('a Main of 97 gives one count problem, count:total, and no Main message', () => {
    const p = run('commander', [e(boss, 1, 'commander'), ...fill(97, 1)])
    expect(p.map((x) => x.key)).toEqual(['count:total'])
  })
  it('2 copies of a non-basic is copies: with the Commander message', () => {
    const p = run('commander', commanderDeck(boss, [e(BOLT, 2)]))
    expect(p.map((x) => x.key)).toContain(`copies:${BOLT}`)
    expect(p.find((x) => x.key.startsWith('copies'))?.message).toBe(
      '2 × Lightning Bolt: Commander allows 1 copy'
    )
  })
  it('an empty commander zone gives count:commander only', () => {
    const p = run('commander', fill(99, 1))
    expect(p.map((x) => x.key)).toEqual(['count:commander'])
    expect(p[0].message).toBe('Commander has 0 cards; it needs 1 or 2')
  })
  it('a non-legendary commander is commander:, a lone Background too', () => {
    const plain = mk('Plain Human')
    expect(run('commander', commanderDeck(plain)).map((x) => x.key)).toEqual([`commander:${plain}`])
    const bg = mk('Cool Background', 'Legendary Enchantment — Background')
    expect(run('commander', commanderDeck(bg)).map((x) => x.key)).toEqual([`commander:${bg}`])
  })
  it('a commander the pack does not know is unsure, not commander: or pair', () => {
    const fresh = mk('Brand New Legend', 'Legendary Creature — Elf')
    const p = run('commander', commanderDeck(fresh))
    expect(p.map((x) => x.key)).toEqual(['unsure'])
    expect(p[0].message).toBe("Couldn't check 1 card")
    const t = mk('Thrasios', 'Legendary Creature — Human')
    expect(
      run('commander', [e(t, 1, 'commander'), e(fresh, 1, 'commander'), ...fill(98, 1)]).map(
        (x) => x.key
      )
    ).toEqual(['unsure'])
  })
  const two = (a: string, b: string): string[] => {
    const A = mk(a, 'Legendary Creature — Human')
    const B = mk(b, 'Legendary Creature — Human')
    const used = fill(98, 1)
    return run('commander', [e(A, 1, 'commander'), e(B, 1, 'commander'), ...used]).map((x) => x.key)
  }
  it('pairs', () => {
    expect(two('Thrasios', 'Tymna')).toEqual([])
    expect(two('Thrasios', 'Red Boss')).toEqual(['pair'])
    expect(two('Pir, Imaginative Rascal', 'Toothy, Imaginary Friend')).toEqual([])
    expect(two('Pir, Imaginative Rascal', 'Thrasios')).toEqual(['pair'])
    expect(two('Sidekick A', 'Sidekick B')).toEqual([])
    expect(two('Sidekick A', 'Sidekick C')).toEqual(['pair'])
    const p = run('commander', [
      e(mk('Thrasios', 'Legendary Creature — Human'), 1, 'commander'),
      e(mk('Red Boss', 'Legendary Creature — Human'), 1, 'commander'),
      ...fill(98, 1)
    ])
    expect(p[0].message).toBe("Thrasios and Red Boss can't be commanders together")
  })
  it('background-chooser + background and companion + doctor are fine', () => {
    const w = mk('Wizard Chooser', 'Legendary Creature — Wizard')
    const bg = mk('Cool Background', 'Legendary Enchantment — Background')
    expect(run('commander', [e(w, 1, 'commander'), e(bg, 1, 'commander'), ...fill(98, 1)])).toEqual(
      []
    )
    const c = mk('Doc Companion', 'Legendary Creature — Human')
    const d = mk('The Doctor', 'Legendary Creature — Time Lord Doctor')
    expect(run('commander', [e(c, 1, 'commander'), e(d, 1, 'commander'), ...fill(98, 1)])).toEqual(
      []
    )
  })
  it('colour identity', () => {
    const blue = mk('Blue Card', 'Creature — Merfolk', ['U'])
    const p = run('commander', commanderDeck(boss, [e(blue)]))
    expect(p.map((x) => x.key)).toEqual([`color:${blue}`])
    expect(p[0].message).toBe("Blue Card is outside your commander's colour identity")
    const rock = mk('Colourless Rock', 'Artifact', [])
    expect(run('commander', commanderDeck(boss, [e(rock)]))).toEqual([])
    const boros = mk('Boros Card', 'Instant', ['R', 'W'])
    const t = mk('Thrasios', 'Legendary Creature — Human', ['R'])
    const y = mk('Tymna', 'Legendary Creature — Human', ['W'])
    reg[t].mtgColorIdentity = ['R']
    reg[y].mtgColorIdentity = ['W']
    expect(
      run('commander', [e(t, 1, 'commander'), e(y, 1, 'commander'), e(boros), ...fill(97, 1)])
    ).toEqual([])
  })
  it('a banned commander-format card is banned:', () => {
    const b = mk('Banned Card')
    raw.legal['Banned Card'] = 3 << 12
    expect(run('commander', commanderDeck(boss, [e(b)])).map((x) => x.key)).toEqual([`banned:${b}`])
  })
})

describe('validPair', () => {
  it('matches partner-with both ways and rejects plain pairs', () => {
    const a = { name: 'Pir', kind: 'partner-with:Toothy' }
    const b = { name: 'Toothy', kind: 'partner-with:Pir' }
    expect(validPair(a, b) && validPair(b, a)).toBe(true)
    expect(validPair({ name: 'A', kind: '' }, { name: 'B', kind: '' })).toBe(false)
    expect(validPair({ name: 'A', kind: 'friends' }, { name: 'B', kind: 'friends' })).toBe(true)
  })
})
