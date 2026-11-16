import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  handId,
  matchCards,
  parseHub,
  parseSetPage,
  setIdOf,
  type PpCard,
  type ZhCatalogCard
} from '../../scripts/catalog/pokemon/pokipair'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/pokipair', name), 'utf8')

const KNOWN = new Set([
  'CSFC',
  'CSV8C',
  'CS4aC',
  'CBB7C',
  'CBB1C',
  'CSV9.5C',
  'CSV10.6C',
  'CSV10.5C',
  'CS6.5C',
  'CS4.1C',
  'CSM2aC',
  'CSDC',
  'CSZC',
  'CS0LC',
  '30thC',
  '151C',
  'CSVL2C'
])

describe('parseHub', () => {
  it('lists each set page with its pack picture, and nothing else', () => {
    const sets = parseHub(fixture('hub.html'))
    expect(sets.map((s) => s.slug)).toEqual([
      'bright-fantasy-csv8-card-list',
      'gem-pack-vol-7-card-list',
      'nine-colors-gathering-set-list-cs4a'
    ])
    expect(sets[0].url).toBe('https://www.pokipair.com/bright-fantasy-csv8-card-list/')
    // The thumbnail's full size: the -150x300 suffix dropped.
    expect(sets[0].pack).toBe(
      'https://media.pokipair.com/2026/03/13091212/CSV8-Bright-Fantasy-Simplified-Chinese-Pokemon.png'
    )
  })
})

describe('parseSetPage', () => {
  it('reads number, version, full picture and name', () => {
    const page = parseSetPage(fixture('csv8.html'))
    expect(page.title).toBe('Bright Fantasy CSV8 Card List')
    const illumise = page.cards.filter((c) => c.number === '006')
    expect(illumise.map((c) => c.variant)).toEqual([
      'normal',
      'pokeball-reverse',
      'masterball-reverse'
    ])
    expect(illumise[0].name).toBe('Illumise')
    expect(illumise[0].url).toMatch(/^https:\/\/media\.pokipair\.com\/.*-016\.png$/)
  })

  it('reads a labelled Gem Pack page: card 01, version 03 of 07 is number 0103', () => {
    const page = parseSetPage(fixture('gem6.html'))
    expect(page.cards.map((c) => c.number)).toEqual([
      '0101',
      '0102',
      '0103',
      '0104',
      '0105',
      '0106',
      '0107'
    ])
    expect(page.cards[0].name).toBe('Alolan Dugtrio')
    expect(new Set(page.cards.map((c) => c.variant)).has('glitter-foil')).toBe(true)
  })

  it('reads a Gem Pack page that names no number or card', () => {
    const page = parseSetPage(fixture('gem7.html'))
    expect(page.cards).toHaveLength(3)
    expect(page.cards.every((c) => c.number === null && c.name === null)).toBe(true)
    expect(page.cards[0].url).toMatch(/Gem-Pack-Vol-7-.*-001\.png$/)
  })
})

describe('setIdOf', () => {
  it.each([
    ['bright-fantasy-csv8-card-list', 'CSV8C'],
    ['nine-colors-gathering-set-list-cs4a', 'CS4aC'],
    ['gem-pack-vol-7-card-list', 'CBB7C'],
    ['gem-pack-volume-one-card-list', 'CBB1C'],
    ['crystal-gathering-csv95-card-list', 'CSV9.5C'],
    ['white-flare-csv10-6c-card-list', 'CSV10.6C'],
    ['black-bolt-csv10-5-card-list', 'CSV10.5C'],
    ['victory-stars-card-list-cs6-5', 'CS6.5C'],
    ['cs4-1c-promo-pack', 'CS4.1C'],
    ['shining-synergy-csm2a-card-list', 'CSM2aC'],
    ['csd-promo-pack-card-list', 'CSDC'],
    ['cs-z-promo-pack-card-list', 'CSZC'],
    ['cs-ol-promo-pack-card-list', 'CS0LC'],
    ['30th-anniversary-30thc-card-list', '30thC'],
    ['collect-151-hope-card-list', '151C'],
    ['journey-promo-pack-csvl2', 'CSVL2C'],
    ['return-of-the-dragon-set-list', 'CSFC']
  ])('%s is %s', (slug, id) => {
    expect(setIdOf(slug, KNOWN)).toBe(id)
  })

  it.each([
    'collect-151-promo-pack-simplified-chinese-pokemon',
    'ex-legend-maker-traditional-chinese',
    'stellar-crystal-csv9-card-list' // a code we have no set for
  ])('%s is no set', (slug) => {
    expect(setIdOf(slug, KNOWN)).toBeNull()
  })
})

describe('matchCards', () => {
  const pp = (number: string | null, variant: string, name: string | null, n = 1): PpCard => ({
    number,
    variant,
    name,
    url: `https://media.pokipair.com/x/${number ?? 'g'}-${variant}-${n}.png`
  })
  const zh = (n: string, name: string, set = 'CSV8C'): ZhCatalogCard => ({
    sourceId: `zh-hans/${set}-${n}`,
    number: n,
    name
  })

  it('takes the plain picture over the reverse patterns, by number and name', () => {
    const got = matchCards(
      [
        pp('006', 'pokeball-reverse', 'Illumise'),
        pp('006', 'normal', 'Illumise'),
        pp('006', 'masterball-reverse', 'Illumise')
      ],
      [zh('006', 'Illumise')]
    )
    expect([...got]).toEqual([
      ['zh-hans/CSV8C-006', 'https://media.pokipair.com/x/006-normal-1.png']
    ])
  })

  it('takes a holo, full art or ACE picture', () => {
    const got = matchCards(
      [pp('201', 'full-art', 'Lillie'), pp('100', 'ace', 'Hero Cape')],
      [zh('201', 'Lillie'), zh('100', 'Hero Cape')]
    )
    expect([...got.keys()].sort()).toEqual(['zh-hans/CSV8C-100', 'zh-hans/CSV8C-201'])
  })

  it('skips a card whose name disagrees, and a number we lack', () => {
    const got = matchCards(
      [pp('006', 'normal', 'Volbeat'), pp('300', 'normal', 'Mew')],
      [zh('006', 'Illumise')]
    )
    expect(got.size).toBe(0)
  })

  it('takes a Gem Pack version of any finish, each its own number', () => {
    const got = matchCards(
      [
        pp('0103', 'glitter-foil', 'Alolan Dugtrio'),
        pp('0104', 'prismatic-foil', 'Alolan Dugtrio')
      ],
      [zh('0103', 'Alolan Dugtrio', 'CBB6C'), zh('0104', 'Alolan Dugtrio', 'CBB6C')]
    )
    expect(got.size).toBe(2)
  })

  it('takes a reverse pattern only when a number has no other picture', () => {
    const got = matchCards(
      [pp('0102', 'pokeball-reverse', 'Alolan Dugtrio')],
      [zh('0102', 'Alolan Dugtrio', 'CBB6C')]
    )
    expect(got.size).toBe(1)
  })

  it('lets a name with a word more or less agree on the same number, and no other', () => {
    // Most of the page agrees outright, as a real one does.
    const exact = Array.from({ length: 16 }, (_, i) => `${20 + i}01`)
    const got = matchCards(
      [
        pp('1801', 'gem', 'Basic Grass Energy'),
        pp('0101', 'gem', 'Pikachu'),
        pp('1001', 'gem', 'Castform'),
        pp('0107', 'full-art', 'Clefable'),
        ...exact.map((n) => pp(n, 'gem', `Mon ${n}`))
      ],
      [
        zh('1801', 'Grass Energy', 'CBB1C'),
        zh('0101', 'Captain Pikachu', 'CBB1C'),
        zh('1001', 'Castform Sunny Form', 'CBB1C'),
        zh('0107', 'Blissey V ex', 'CBB1C'),
        ...exact.map((n) => zh(n, `Mon ${n}`, 'CBB1C'))
      ]
    )
    expect([...got.keys()].filter((k) => !exact.some((n) => k.endsWith(n))).sort()).toEqual([
      'zh-hans/CBB1C-0101',
      'zh-hans/CBB1C-1001',
      'zh-hans/CBB1C-1801'
    ])
  })

  it('matches nothing on a page numbered one off from ours, even where an evolution line lines up', () => {
    const ours = [
      zh('004', 'Charmander'),
      zh('005', 'Charizard ex'),
      zh('006', 'Squirtle'),
      zh('007', 'Wartortle'),
      zh('008', 'Blastoise')
    ]
    const theirs = [
      pp('004', 'normal', 'Charmeleon'),
      pp('005', 'normal', 'Charizard'),
      pp('006', 'normal', 'Bulbasaur'),
      pp('007', 'normal', 'Squirtle'),
      pp('008', 'normal', 'Wartortle')
    ]
    expect(matchCards(theirs, ours).size).toBe(0)
  })

  it('compares numbers without the set total or leading zeros', () => {
    const got = matchCards([pp('6', 'normal', 'Illumise')], [zh('006', 'Illumise')])
    expect(got.size).toBe(1)
  })

  it('takes a Gem Pack page in order when its pictures and our cards are as many', () => {
    const cards = [
      zh('0102', 'Raticate', 'CBB7C'),
      zh('0101', 'Raticate', 'CBB7C'),
      zh('0201', 'Meowth', 'CBB7C')
    ]
    const page = [
      pp(null, 'normal', null, 1),
      pp(null, 'normal', null, 2),
      pp(null, 'normal', null, 3)
    ]
    expect([...matchCards(page, cards)]).toEqual([
      ['zh-hans/CBB7C-0101', page[0].url],
      ['zh-hans/CBB7C-0102', page[1].url],
      ['zh-hans/CBB7C-0201', page[2].url]
    ])
    expect(matchCards(page.slice(1), cards).size).toBe(0)
  })
})

describe('handId', () => {
  it('is the source id, lowercase, with dashes', () => {
    expect(handId('zh-hans/CBB7C-0101')).toBe('zh-hans-cbb7c-0101')
    expect(handId('zh-hans/CSV9.5C-001')).toBe('zh-hans-csv9-5c-001')
  })
})
