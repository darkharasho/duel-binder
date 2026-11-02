import { describe, expect, it } from 'vitest'
import { pickByTilt, tiltFinish, type TiltModel, type TiltPair } from '../../src/shared/scan/tilt'

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
})

describe('pickByTilt', () => {
  it('picks only among the given finishes', () => {
    expect(pickByTilt(MODEL, [at('Secret Rare')], ['Super Rare', 'Ultra Rare'])?.finish).toBe(
      'Ultra Rare'
    )
    expect(pickByTilt(MODEL, [at('Super Rare')], ['Super Rare'])).toBeNull()
  })
  it('no pair among the finishes means no pick', () => {
    const noPair: TiltModel = { ...MODEL, pairs: [] }
    expect(pickByTilt(noPair, [0], ['Super Rare', 'Ultra Rare'])).toBeNull()
  })
  it('a three-way pick goes to the finish that wins most pairs', () => {
    expect(
      pickByTilt(MODEL, [at('Ultra Rare')], ['Common', 'Super Rare', 'Ultra Rare'])?.finish
    ).toBe('Ultra Rare')
  })
})
