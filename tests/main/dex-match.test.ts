import { describe, expect, it } from 'vitest'
import { matchDexRows, type DexCatalogPrinting } from '../../src/shared/dex/match'
import type { DexRow } from '../../src/shared/dex/parse'

let nextId = 1
const printings = (
  sourceId: string,
  setName: string,
  cardName: string,
  versions: string[],
  language = 'en'
): DexCatalogPrinting[] =>
  versions.map((version) => ({
    id: nextId++,
    cardId: 1000 + nextId,
    sourceId,
    setName,
    version,
    cardName,
    language
  }))

const CATALOG = [
  ...printings('en/sv08.5-001', 'Prismatic Evolutions', 'Exeggcute', [
    'Normal',
    'Reverse Holofoil',
    'Poke Ball Pattern',
    'Master Ball Pattern'
  ]),
  ...printings('en/sv08.5-006', 'Prismatic Evolutions', 'Leafeon ex', [
    'Holofoil',
    'Set Logo Holofoil'
  ]),
  ...printings('en/sv08.5-082', 'Prismatic Evolutions', 'Lugia ex', [
    'Holofoil',
    'Set Logo Holofoil',
    'Set Logo Normal'
  ]),
  ...printings('en/sv08.5-122', 'Prismatic Evolutions', "Professor's Research", ['Normal']),
  ...printings('en/ex3-001', 'Dragon', 'Absol', ['Holofoil']),
  ...printings('en/ecard3-H25', 'Skyridge', 'Vaporeon', ['Holofoil']),
  ...printings('en/swsh12.5gg-GG01', 'Crown Zenith Galarian Gallery', 'Simisear VSTAR', [
    'Holofoil'
  ]),
  ...printings('en/smp-SM229', 'SM Black Star Promos', 'Pikachu', ['Holofoil']),
  ...printings('en/2018sm-011', "McDonald's Collection 2018", 'Poliwag', ['Normal']),
  ...printings('en/30th-c-014', '30th Classic Collection', 'Pikachu', ['Holofoil']),
  ...printings('en/30th-c-001', '30th Classic Collection', 'Charizard', ['Holofoil']),
  ...printings('en/30th-c-022', '30th Classic Collection', 'Palkia', ['Holofoil']),
  ...printings('en/30th-c-019', '30th Classic Collection', 'Darkrai & Cresselia LEGEND', [
    'Holofoil'
  ]),
  ...printings('en/30th-001', '30th Celebration', 'Exeggcute', ['Holofoil']),
  ...printings('ja/SV8a-001', 'Terastal Festival ex', 'Exeggcute', ['Normal'], 'ja')
]

const row = (over: Partial<DexRow>): DexRow => ({
  locale: 'International',
  series: 'Scarlet & Violet',
  set: 'Prismatic Evolutions',
  id: 'sv85-1',
  number: '1/131',
  name: 'Exeggcute',
  variant: 'Normal',
  quantity: 1,
  ...over
})

const expectFound = (over: Partial<DexRow>, sourceId: string, version: string): void => {
  const { wanted, missing } = matchDexRows([row(over)], CATALOG)
  expect(missing).toEqual([])
  const want = CATALOG.find((p) => p.sourceId === sourceId && p.version === version)
  expect([...wanted.keys()]).toEqual([want?.id])
}

const expectMissed = (over: Partial<DexRow>, reason: string): void => {
  const { wanted, missing } = matchDexRows([row(over)], CATALOG)
  expect(wanted.size).toBe(0)
  expect(missing.map((m) => m.reason)).toEqual([reason])
}

describe('Dex finishes', () => {
  it.each([
    ['Normal', 'Normal'],
    ['Reverse Holo', 'Reverse Holofoil'],
    ['Poké Ball Holo', 'Poke Ball Pattern'],
    ['Master Ball Holo', 'Master Ball Pattern']
  ])('%s lands on %s', (variant, version) => expectFound({ variant }, 'en/sv08.5-001', version))

  it('Holo lands on Holofoil', () =>
    expectFound(
      { id: 'sv85-6', number: '6/131', name: 'Leafeon ex', variant: 'Holo' },
      'en/sv08.5-006',
      'Holofoil'
    ))

  it('never takes a finish the card does not have', () =>
    expectMissed({ variant: 'Holo' }, 'finish'))

  it.each([
    'Play! Pokémon',
    'Jumbo',
    'Jumbo (Expansion Stamp)',
    'Expansion Stamp (Alternate Placement)',
    'Professor Program (Staff)',
    'Pokémon Day'
  ])('lists %s rather than guess', (variant) =>
    expectMissed({ id: 'sv85-6', number: '6/131', name: 'Leafeon ex', variant }, 'finish')
  )

  it('an Expansion Stamp lands on the one Set Logo version', () =>
    expectFound(
      { id: 'sv85-6', number: '6/131', name: 'Leafeon ex', variant: 'Expansion Stamp' },
      'en/sv08.5-006',
      'Set Logo Holofoil'
    ))

  it('an Expansion Stamp with two Set Logo versions is not guessed', () =>
    expectMissed(
      { id: 'sv85-82', number: '82/131', name: 'Lugia ex', variant: 'Expansion Stamp' },
      'finish'
    ))
})

describe('Dex sets and numbers', () => {
  it('finds EX series sets without their prefix', () =>
    expectFound(
      {
        series: 'EX',
        set: 'EX Dragon',
        id: 'ex3-1',
        number: '1/97',
        name: 'Absol',
        variant: 'Holo'
      },
      'en/ex3-001',
      'Holofoil'
    ))

  it('reads letter numbers', () => {
    expectFound(
      {
        series: 'e-Card',
        set: 'Skyridge',
        id: 'ecard3-H25',
        number: 'H25/144',
        name: 'Vaporeon',
        variant: 'Holo'
      },
      'en/ecard3-H25',
      'Holofoil'
    )
    expectFound(
      {
        set: 'Crown Zenith: Galarian Gallery',
        id: 'swsh12pt5gg-GG01',
        number: 'GG01/GG70',
        name: 'Simisear VSTAR',
        variant: 'Holo'
      },
      'en/swsh12.5gg-GG01',
      'Holofoil'
    )
  })

  it('finds a set our name differs on through the id table', () =>
    expectFound(
      {
        set: 'Sun & Moon Promos',
        id: 'smp-SM229',
        number: 'SM229/251',
        name: 'Pikachu',
        variant: 'Holo'
      },
      'en/smp-SM229',
      'Holofoil'
    ))

  it('rejects a set whose id and name disagree', () =>
    expectMissed({ set: 'Skyridge', id: 'sv85-1' }, 'set'))

  it('lists an unknown set', () =>
    expectMissed({ set: 'Tropical Mega Battle Half Deck', id: 'tmb-1' }, 'set'))

  it('never takes a country-flagged set for our set of that name', () =>
    expectMissed(
      {
        set: "McDonald's Collection 2018 (🇫🇷)",
        id: 'mcd18fr-11',
        number: '11/40',
        name: 'Poliwag'
      },
      'set'
    ))

  it('lists a number the set does not have', () =>
    expectMissed({ number: '999/131', id: 'sv85-999' }, 'number'))

  it('checks the card name last', () => expectMissed({ name: 'Pikachu' }, 'name'))

  it('accepts the words Dex adds to a name', () =>
    expectFound(
      { id: 'sv85-122', number: '122/131', name: "Professor's Research (Professor Oak)" },
      'en/sv08.5-122',
      'Normal'
    ))
})

describe('30th Classic Collection', () => {
  const classic = { set: '30th Celebration: Classic Collection', variant: 'Holo' }

  it('maps Dex numbers to ours', () => {
    expectFound(
      { ...classic, id: 'me55cc-1', number: '1/30', name: 'Pikachu' },
      'en/30th-c-014',
      'Holofoil'
    )
    expectFound(
      { ...classic, id: 'me55cc-2', number: '2/30', name: 'Charizard' },
      'en/30th-c-001',
      'Holofoil'
    )
    expectFound(
      { ...classic, id: 'me55cc-12', number: '12/30', name: 'Palkia LV.X' },
      'en/30th-c-022',
      'Holofoil'
    )
  })

  it('leaves the two LEGEND halves out', () =>
    expectMissed(
      { ...classic, id: 'me55cc-16', number: '16/30', name: 'Darkrai & Cresselia LEGEND' },
      'number'
    ))
})

describe('Dex languages', () => {
  it('never puts a Chinese card on its English twin', () =>
    expectMissed(
      {
        locale: 'Simplified Chinese',
        set: '30th Celebration',
        id: 'scn_30th-1',
        number: '1/103',
        series: 'MEGA'
      },
      'language'
    ))

  it('lands on the language printing when we have it', () =>
    expectFound(
      { locale: 'Japanese', set: 'Terastal Festival ex', id: 'sv8a-1', number: '001/187' },
      'ja/SV8a-001',
      'Normal'
    ))

  it('lists a locale it does not know', () => expectMissed({ locale: 'Klingon' }, 'language'))
})

describe('Dex quantities', () => {
  it('skips quantity 0 and lists an unreadable quantity', () => {
    const m = matchDexRows(
      [row({ quantity: 0 }), row({ variant: 'Holo', quantity: null })],
      CATALOG
    )
    expect(m.zeroRows).toBe(1)
    expect(m.wanted.size).toBe(0)
    expect(m.missing.map((x) => x.reason)).toEqual(['quantity'])
  })

  it('counts the same card in several lists once, at its highest quantity', () => {
    const m = matchDexRows(
      [row({ quantity: 2 }), row({ quantity: 5 }), row({ quantity: 5 })],
      CATALOG
    )
    expect([...m.wanted.values()].map((w) => w.quantity)).toEqual([5])
    expect(m.repeatRows).toBe(2)
  })

  it('keeps a variant and a locale apart', () => {
    const m = matchDexRows(
      [row({ quantity: 2 }), row({ variant: 'Reverse Holo', quantity: 3 })],
      CATALOG
    )
    expect([...m.wanted.values()].map((w) => w.quantity).sort()).toEqual([2, 3])
  })
})
