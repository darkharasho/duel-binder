import { readFileSync } from 'node:fs'
import { SET_TYPES, setType, type SetType } from '@shared/setTypes'

const cases: [SetType, string[]][] = [
  [
    'booster',
    [
      'Cosmo Blazer',
      'Phantom Nightmare',
      'Invasion of Chaos',
      'Legend of Blue Eyes White Dragon',
      'Metal Raiders',
      'Absolute Powerforce',
      'Duelist Nexus',
      'Age of Overlord',
      'Return of the Duelist',
      'Brothers of Legend',
      'Extreme Force',
      'Lightning Overdrive',
      "Magician's Force",
      'Duel Power',
      'Dragons of Legend: Unleashed',
      'Rage of the Abyss',
      'The Infinite Forbidden',
      'Wild Survivors',
      'Chaos Origins'
    ]
  ],
  [
    'deck',
    [
      'Structure Deck: Blue-Eyes White Destiny',
      'Starter Deck: Kaiba',
      '2-Player Starter Deck: Yuya & Declan',
      '2-Player Starter Set',
      'Speed Duel Starter Decks: Destiny Masters',
      'Egyptian God Deck: Slifer the Sky Dragon',
      'Super Starter: Space-Time Showdown'
    ]
  ],
  ['tin', ['2013 Collectible Tins Wave 1', 'Mega-Tin 2023']],
  [
    'collection',
    [
      "Legendary Collection 3: Yugi's World",
      'Battles of Legend: Chapter 1',
      'Maximum Gold',
      'Hidden Arsenal 7: Knight of Stars',
      'Ghosts From the Past',
      'Duel Devastator',
      'Duelist Pack: Yusei',
      'Quarter Century Bonanza',
      'Rarity Collection II'
    ]
  ],
  [
    'promo',
    [
      'Adidas collaboration card',
      'Nike collaboration cards',
      'Blue-Eyes Alternative White Dragon Sweepstakes',
      'OTS Tournament Pack 21',
      'Yu-Gi-Oh! 3D Bonds Beyond Time Theater distribution card',
      'Shonen Jump Magazine Promos'
    ]
  ]
]

it.each(cases.flatMap(([t, names]) => names.map((n) => [n, t] as const)))(
  '%s -> %s',
  (name, type) => {
    expect(setType({ setName: name, setCode: '' })).toBe(type)
  }
)

it('SET_TYPES lists the five labels in order', () => {
  expect(SET_TYPES.map((t) => t.label)).toEqual([
    'Booster sets',
    'Decks',
    'Tins',
    'Collections',
    'Promos'
  ])
})

it('classifies the real cardsets list sensibly', () => {
  const sets: { set_name: string; set_code: string }[] = JSON.parse(
    readFileSync(new URL('../fixtures/ygoprodeck-cardsets.json', import.meta.url), 'utf8')
  )
  const count = (t: SetType): number =>
    sets.filter((s) => setType({ setName: s.set_name, setCode: s.set_code }) === t).length
  expect(count('promo')).toBeLessThan(600)
  expect(count('booster')).toBeGreaterThan(250)
  for (const s of sets.filter((s) => s.set_name.includes('Structure Deck')))
    expect(setType({ setName: s.set_name, setCode: s.set_code })).toBe('deck')
})
