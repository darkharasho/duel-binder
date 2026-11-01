import { describe, expect, it } from 'vitest'
import { matchDexRows, type DexCatalogPrinting } from '../../src/shared/dex/match'
import type { DexRow } from '../../src/shared/dex/parse'
import { dexSets } from '../../scripts/catalog/pokemon/dexSets'
import { cardVersions } from '../../scripts/catalog/pokemon/versions'

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
  ...printings('en/sve-009', 'Scarlet & Violet Energy', 'Grass Energy', ['Normal', 'Holofoil']),
  ...printings('en/svp-046', 'SVP Black Star Promos', 'Bulbasaur', ['Cosmos Holo']),
  ...printings('en/mep-037', 'MEP Black Star Promos', 'Bulbasaur', ['Holofoil']),
  ...printings('en/30th-002', '30th Celebration', 'Alolan Exeggutor', ['Normal']),
  ...printings('en/mee-008', 'Mega Evolution Energy', 'Metal Energy', ['Normal']),
  ...printings('en/mee-016', 'Mega Evolution Energy', 'Basic Metal Energy', ['Holofoil']),
  ...printings('en/mep-036', 'MEP Black Star Promos', 'Mega Feraligatr ex', [
    'Holofoil',
    'Lenticular'
  ]),
  ...printings('en/me02.5-004', 'Ascended Heroes', "Erika's Bellsprout", [
    'Normal',
    'Energy Symbol Pattern',
    'Poke Ball Pattern'
  ]),
  ...printings('en/sm1-010', 'Sun & Moon', 'Rowlet', ['Holofoil']),
  ...printings(
    'ja/M2a-001',
    'High Class Pack: MEGA Dream ex',
    "Ethan's Pinsir",
    ['Normal', 'Reverse Holofoil'],
    'ja'
  ),
  ...printings('ja/SV11W-011', 'White Flare', 'Tepig', ['Normal', 'Reverse Holofoil'], 'ja'),
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

  it('a jumbo lenticular is the Lenticular version', () =>
    expectFound(
      {
        id: 'mep-36',
        set: 'Mega Evolution Promos',
        number: '36',
        name: 'Mega Feraligatr ex',
        variant: 'Jumbo (Lenticular)'
      },
      'en/mep-036',
      'Lenticular'
    ))

  it("a basic energy's holo is numbered after the eight", () =>
    expectFound(
      {
        id: 'mee-8',
        set: 'Mega Evolution Basic Energies',
        number: '8/8',
        name: 'Basic Metal Energy',
        variant: 'Holo'
      },
      'en/mee-016',
      'Holofoil'
    ))

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

describe('sets Dex names its own way', () => {
  const at = (set: string, id: string, number: string, name: string, variant: string) => ({
    series: 'x',
    set,
    id,
    number,
    name,
    variant
  })

  it('finds promos and basic energies by id', () => {
    expectFound(
      at('Scarlet & Violet Basic Energies', 'uen23-9', '9/24', 'Basic Grass Energy', 'Normal'),
      'en/sve-009',
      'Normal'
    )
    expectFound(
      at('Scarlet & Violet Promos', 'svp-46', '46/225', 'Bulbasaur', 'Cosmos Holo'),
      'en/svp-046',
      'Cosmos Holo'
    )
  })

  it("takes a one-finish set's only version, whatever Dex calls it", () => {
    expectFound(
      at('Mega Evolution Promos', 'mep-37', '37', 'Bulbasaur', '30th Anniversary'),
      'en/mep-037',
      'Holofoil'
    )
    expectFound(
      at('30th Celebration', 'me55-2', '2/128', 'Alolan Exeggutor', 'Holo'),
      'en/30th-002',
      'Normal'
    )
  })

  it('keeps an ordinary set strict: a Reverse Holo never lands on a Holofoil', () =>
    expectMissed(at('Sun & Moon', 'sm1-10', '10/149', 'Rowlet', 'Reverse Holo'), 'finish'))

  it("reads Ascended Heroes' reverse as its Energy Symbol pattern", () =>
    expectFound(
      at('Ascended Heroes', 'me25-4', '4/217', "Erika's Bellsprout", 'Reverse Holo'),
      'en/me02.5-004',
      'Energy Symbol Pattern'
    ))

  it('finds Japanese sets by their Dex id', () => {
    expectFound(
      {
        ...at('MEGA Dream ex', 'jpn_m2a-1', '1/193', "Ethan's Pinsir", 'Normal'),
        locale: 'Japanese'
      },
      'ja/M2a-001',
      'Normal'
    )
    expectFound(
      {
        ...at('White Flare', 'jpn_sv11w-11', '11/86', 'Tepig', 'Poké Ball Holo'),
        locale: 'Japanese'
      },
      'ja/SV11W-011',
      'Reverse Holofoil'
    )
  })
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

describe('sets only an export holds', () => {
  const held = dexSets().flatMap(({ set, cards }) =>
    cards.flatMap((card) =>
      cardVersions(card, [], new Map()).versions.map((v, i) => ({
        id: Number(card.localId) * 10 + i + (set.id === 'ba20m' ? 1000 : 0),
        cardId: Number(card.localId),
        sourceId: `en/${card.id}`,
        setName: set.name,
        version: v.label,
        cardName: card.name,
        language: 'en'
      }))
    )
  )
  const catalog = [
    ...held,
    ...printings('en/2018sm-11', "McDonald's Collection 2018", 'Eevee', ['Holofoil'])
  ]
  const poliwag = {
    id: 'mcd18fr-11',
    set: "McDonald's Collection 2018 (🇫🇷)",
    number: '11/40',
    name: 'Poliwag'
  }

  it("finds France's McDonald's set by id, never the set of its name", () => {
    const { wanted, missing } = matchDexRows(
      [row({ ...poliwag, variant: 'Normal' }), row({ ...poliwag, variant: 'Reverse Holo' })],
      catalog
    )
    expect(missing).toEqual([])
    expect(wanted.size).toBe(2)
  })
  it('leaves out a flagged set with no pin', () => {
    const { missing } = matchDexRows([row({ ...poliwag, id: 'mcd19fr-11' })], catalog)
    expect(missing[0].reason).toBe('set')
  })
  it('finds the Battle Academy deck', () => {
    const { missing } = matchDexRows(
      [
        row({ id: 'ba20m-6', set: 'Battle Academy 2020: Mewtwo Deck', number: '6/17', name: 'Mew' })
      ],
      catalog
    )
    expect(missing).toEqual([])
  })
  it('pins Japanese 30th Celebration to its set', () => {
    const sylveon = printings(
      'ja/M6a-059',
      'MEGA Expansion 30th Celebration',
      'Sylveon ex',
      ['Holofoil'],
      'ja'
    )
    const { missing } = matchDexRows(
      [
        row({
          locale: 'Japanese',
          id: 'jpn_m6a-59',
          set: '30th Celebration',
          number: '59/103',
          name: 'Sylveon ex',
          variant: 'Holo'
        })
      ],
      sylveon
    )
    expect(missing).toEqual([])
  })
})

describe('Dex rows the first full export missed', () => {
  const found = (catalog: DexCatalogPrinting[], over: Partial<DexRow>): string | undefined => {
    const { wanted } = matchDexRows([row(over)], catalog)
    const [id] = [...wanted.keys()]
    return catalog.find((p) => p.id === id)?.version
  }

  it('reads the named stamps as our versions', () => {
    const pikachu = printings('en/sv05-051', 'Temporal Forces', 'Pikachu', [
      'Normal',
      'Pokemon Day Holofoil'
    ])
    expect(
      found(pikachu, {
        id: 'sv5-51',
        set: 'Temporal Forces',
        number: '51/162',
        name: 'Pikachu',
        variant: 'Pokémon Day'
      })
    ).toBe('Pokemon Day Holofoil')
    const iono = printings('en/sv09-053', 'Journey Together', "Iono's Bellibolt ex", [
      'Holofoil',
      'Player Rewards Program Holofoil'
    ])
    expect(
      found(iono, {
        id: 'sv9-53',
        set: 'Journey Together',
        number: '53/159',
        name: "Iono's Bellibolt ex",
        variant: 'Play! Pokémon'
      })
    ).toBe('Player Rewards Program Holofoil')
  })

  it('keeps a Team Rocket pattern and a plain reverse apart in Ascended Heroes', () => {
    const diglett = printings('en/me02.5-100', 'Ascended Heroes', "Team Rocket's Diglett", [
      'Normal',
      'Reverse Holofoil',
      'Energy Symbol Pattern'
    ])
    const at = {
      id: 'me25-100',
      set: 'Ascended Heroes',
      number: '100/217',
      name: "Team Rocket's Diglett"
    }
    expect(found(diglett, { ...at, variant: 'Team Rocket Holo' })).toBe('Reverse Holofoil')
    expect(found(diglett, { ...at, variant: 'Reverse Holo' })).toBe('Energy Symbol Pattern')
    const trainer = printings('en/me02.5-188', 'Ascended Heroes', 'Forest of Vitality', [
      'Normal',
      'Reverse Holofoil'
    ])
    expect(
      found(trainer, {
        id: 'me25-188',
        set: 'Ascended Heroes',
        number: '188/217',
        name: 'Forest of Vitality',
        variant: 'Reverse Holo'
      })
    ).toBe('Reverse Holofoil')
  })

  it('reads 四 as E4, and no other mark', () => {
    const gallade = printings('en/pl2-20', 'Rising Rivals', 'Gallade E4', ['Normal'])
    expect(
      found(gallade, { id: 'pl2-20', set: 'Rising Rivals', number: '20/111', name: 'Gallade 四' })
    ).toBe('Normal')
    expect(
      found(gallade, { id: 'pl2-20', set: 'Rising Rivals', number: '20/111', name: 'Gardevoir 四' })
    ).toBeUndefined()
  })

  it('takes a Japanese Trainer by set and number, never a Japanese Pokémon', () => {
    const at = {
      locale: 'Japanese',
      id: 'jpn_m2-74',
      set: 'Inferno X',
      number: '74/80',
      name: 'Blowtorch'
    }
    const trainer = printings('ja/M2-074', 'Inferno X', 'Heat Burner', ['Normal'], 'ja').map(
      (p) => ({ ...p, category: 'Trainer' })
    )
    expect(found(trainer, at)).toBe('Normal')
    const pokemon = trainer.map((p) => ({ ...p, category: 'Pokemon' }))
    expect(found(pokemon, at)).toBeUndefined()
  })

  it("lands MEGA Dream ex's Holo on its base version, and never over a real Holofoil", () => {
    const at = {
      locale: 'Japanese',
      id: 'jpn_m2a-10',
      set: 'MEGA Dream ex',
      number: '10/193',
      name: 'Zeraora',
      variant: 'Holo'
    }
    expect(
      found(
        printings('ja/M2a-010', 'MEGA Dream ex', 'Zeraora', ['Normal', 'Reverse Holofoil'], 'ja'),
        at
      )
    ).toBe('Normal')
    expect(
      found(printings('ja/M2a-010', 'MEGA Dream ex', 'Zeraora', ['Normal', 'Holofoil'], 'ja'), at)
    ).toBe('Holofoil')
  })

  it('takes a card with one print only where its finish can be off', () => {
    const rc = printings('en/bw11-RC3', 'Legendary Treasures', 'Serperior', ['Normal'])
    expect(
      found(rc, {
        id: 'bw11-RC3',
        set: 'Legendary Treasures',
        number: 'RC3/113',
        name: 'Serperior',
        variant: 'Holo'
      })
    ).toBe('Normal')
    const plain = printings('en/bw11-3', 'Legendary Treasures', 'Serperior', ['Normal'])
    expect(
      found(plain, {
        id: 'bw11-3',
        set: 'Legendary Treasures',
        number: '3/113',
        name: 'Serperior',
        variant: 'Holo'
      })
    ).toBeUndefined()
    const bea = printings(
      'zh-hans/CSIC-002',
      'Trainer Collection Gift Box',
      'Bea',
      ['Normal'],
      'zh-hans'
    )
    const zh = {
      locale: 'Simplified Chinese',
      id: 'scn_csI-2',
      set: 'Trainer Collection Gift Box',
      number: '2/7',
      name: 'Bea'
    }
    expect(found(bea, { ...zh, variant: 'Holo' })).toBe('Normal')
    expect(found(bea, { ...zh, variant: 'Master Ball Holo' })).toBeUndefined()
  })

  it('finds a Classic Collection card by name, and a Chinese regional form without its region', () => {
    const oak = printings(
      'en/cel25cc-CC004',
      'Celebrations Classic Collection',
      'Imposter Professor Oak',
      ['Holofoil']
    )
    expect(
      found(oak, {
        id: 'cel25c-73_A',
        set: 'Celebrations: Classic Collection',
        number: '73/25',
        name: 'Imposter Professor Oak',
        variant: 'Holo'
      })
    ).toBe('Holofoil')
    const clodsire = printings(
      'zh-hans/CSV6C-089',
      'Arcane Truth',
      'Paldean Clodsire',
      ['Normal'],
      'zh-hans'
    )
    expect(
      found(clodsire, {
        locale: 'Simplified Chinese',
        id: 'scn_csv6-89',
        set: 'Arcane Truth',
        number: '89/128',
        name: 'Clodsire'
      })
    ).toBe('Normal')
  })
})
