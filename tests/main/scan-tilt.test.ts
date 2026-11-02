import { describe, expect, it } from 'vitest'
import {
  isHoloType,
  pickByTilt,
  tiltFinish,
  tiltFinishes,
  type TiltModel,
  type TiltPair
} from '../../src/shared/scan/tilt'

const CLASSES = [
  'Common',
  'Super Rare',
  'Ultra Rare',
  'Secret Rare',
  'Normal',
  'Holofoil',
  'Reverse Holofoil',
  'Cosmos Holo'
]
const pairs: TiltPair[] = []
for (let i = 0; i < CLASSES.length; i++)
  for (let j = i + 1; j < CLASSES.length; j++)
    pairs.push({
      a: CLASSES[i],
      b: CLASSES[j],
      use: [0],
      mean: [0],
      spread: [1],
      ca: [i],
      cb: [j]
    })
const MODEL: TiltModel = { features: ['f0'], classes: CLASSES, pairs }
const at = (finish: string): number => CLASSES.indexOf(finish)

describe('tilt finishes', () => {
  it('maps catalog rarities to finishes', () => {
    expect(tiltFinish('ygo', 'Ultra Rare (Alternate Art)')).toBe('Ultra Rare')
    expect(tiltFinish('pkm', '1st Edition Holofoil')).toBe('Holofoil')
    expect(tiltFinish('pkm', 'Set Logo Reverse Holofoil')).toBe('Reverse Holofoil')
    expect(tiltFinish('pkm', 'Shadowless Normal')).toBe('Normal')
    expect(tiltFinish('pkm', '1st Edition')).toBe('Normal')
    expect(tiltFinish('pkm', 'Poke Ball Pattern')).toBe('Poke Ball Pattern')
  })
  it('names holo-type finishes per game', () => {
    for (const r of ['Common', 'Rare', 'Short Print', 'Rare (Purple)', 'Kaiba Corporation Rare'])
      expect(isHoloType('ygo', tiltFinish('ygo', r))).toBe(false)
    for (const r of [
      'Super Rare',
      'Ultra Rare',
      'Secret Rare',
      'Prismatic Secret Rare',
      'Starfoil Rare',
      'PlScR'
    ])
      expect(isHoloType('ygo', tiltFinish('ygo', r))).toBe(true)
    for (const r of ['Normal', 'Reverse Holofoil', 'Poke Ball Pattern', 'Master Ball Pattern'])
      expect(isHoloType('pkm', tiltFinish('pkm', r))).toBe(false)
    for (const r of ['Holofoil', 'Cosmos Holo', 'Cracked Ice Holo'])
      expect(isHoloType('pkm', tiltFinish('pkm', r))).toBe(true)
  })
  it('tilts only for two known holo-type finishes', () => {
    expect(tiltFinishes('ygo', ['Common', 'Rare'], MODEL)).toBeNull()
    expect(tiltFinishes('ygo', ['Common', 'Ultra Rare'], MODEL)).toBeNull()
    expect(tiltFinishes('ygo', ['Super Rare', 'Ultimate Rare'], MODEL)).toBeNull()
    expect(tiltFinishes('ygo', ['Common', 'Super Rare', 'Ultra Rare'], MODEL)).toEqual([
      'Common',
      'Super Rare',
      'Ultra Rare'
    ])
    expect(
      tiltFinishes('ygo', ['Ultra Rare', 'Ultra Rare (Overframe)', 'Secret Rare'], MODEL)
    ).toBeNull()
    expect(tiltFinishes('pkm', ['Normal', 'Reverse Holofoil'], MODEL)).toBeNull()
    expect(tiltFinishes('pkm', ['Holofoil', 'Reverse Holofoil'], MODEL)).toBeNull()
    expect(tiltFinishes('pkm', ['Holofoil', 'Cosmos Holo', 'Master Ball Pattern'], MODEL)).toEqual([
      'Holofoil',
      'Cosmos Holo'
    ])
  })
})

describe('pickByTilt', () => {
  it('picks only among the given finishes', () => {
    expect(pickByTilt(MODEL, [at('Secret Rare')], ['Super Rare', 'Ultra Rare'])?.finish).toBe(
      'Ultra Rare'
    )
    expect(pickByTilt(MODEL, [at('Super Rare')], ['Super Rare'])).toBeNull()
  })
  it('a three-way pick goes to the finish that wins most pairs', () => {
    expect(
      pickByTilt(MODEL, [at('Ultra Rare')], ['Common', 'Super Rare', 'Ultra Rare'])?.finish
    ).toBe('Ultra Rare')
  })
})
