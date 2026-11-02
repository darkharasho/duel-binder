import { describe, expect, it } from 'vitest'
import { tiltFinish, type TiltModel, type TiltPair } from '../../src/shared/scan/tilt'
import { pickByRead, readFinishes } from '../../src/shared/scan/tiltRead'

const pairOf = (a: string, b: string): TiltPair => ({
  a,
  b,
  use: [0],
  mean: [0],
  spread: [1],
  ca: [-1],
  cb: [1]
})
const split = (classes: string[]): TiltModel => {
  const pairs: TiltPair[] = []
  for (let i = 0; i < classes.length; i++)
    for (let j = i + 1; j < classes.length; j++) pairs.push(pairOf(classes[i], classes[j]))
  return { features: ['f0'], classes, pairs }
}
const M = split(['Normal', 'Reverse Holofoil', 'Holofoil'])
const NR: [string, string][] = [['Normal', 'Reverse Holofoil']]

describe('readFinishes', () => {
  it('lists the finishes when an enabled pair is among them', () => {
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil'], M, NR)).toEqual([
      'Normal',
      'Reverse Holofoil'
    ])
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil', 'Holofoil'], M, NR)).toEqual([
      'Normal',
      'Reverse Holofoil',
      'Holofoil'
    ])
  })
  it('is null without an enabled pair', () => {
    expect(readFinishes('pkm', ['Holofoil', 'Reverse Holofoil'], M, NR)).toBeNull()
  })
  it('is null when any finish is one the model does not know', () => {
    // Cosmos Holo and Master Ball Pattern are kept as their own finishes by tiltFinish.
    expect(tiltFinish('pkm', 'Master Ball Pattern')).toBe('Master Ball Pattern')
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil'], M, NR)).not.toBeNull()
    expect(
      readFinishes('pkm', ['Normal', 'Reverse Holofoil', 'Master Ball Pattern'], M, NR)
    ).toBeNull()
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil', 'Cosmos Holo'], M, NR)).toBeNull()
  })
  it('is null when an option is overframe or full art and nothing else rules the row out', () => {
    // Every finish is known and an enabled pair is among them: only the option itself decides.
    const FA = split(['Normal', 'Reverse Holofoil', 'Full Art'])
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil'], FA, NR)).not.toBeNull()
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil', 'Full Art'], FA, NR)).toBeNull()
    const Y = split(['Common', 'Ultra Rare'])
    const CU: [string, string][] = [['Common', 'Ultra Rare']]
    expect(readFinishes('ygo', ['Common', 'Ultra Rare'], Y, CU)).toEqual(['Common', 'Ultra Rare'])
    expect(
      readFinishes('ygo', ['Common', 'Ultra Rare', 'Ultra Rare (Overframe)'], Y, CU)
    ).toBeNull()
  })
  it('defaults to the game allowlist', () => {
    expect(readFinishes('pkm', ['Normal', 'Reverse Holofoil'], M)).toEqual([
      'Normal',
      'Reverse Holofoil'
    ])
    expect(readFinishes('pkm', ['Holofoil', 'Reverse Holofoil'], M)).toBeNull()
  })
})

describe('pickByRead', () => {
  it('takes the nearer finish of a lone pair', () => {
    expect(pickByRead(M, [-1], ['Normal', 'Reverse Holofoil'], NR)).toBe('Normal')
    expect(pickByRead(M, [1], ['Normal', 'Reverse Holofoil'], NR)).toBe('Reverse Holofoil')
  })
  it('takes the only finish that wins all of its pairs', () => {
    const enabled: [string, string][] = [
      ['Normal', 'Holofoil'],
      ['Reverse Holofoil', 'Normal']
    ]
    // Normal beats Holofoil, Reverse Holofoil beats Normal: Reverse Holofoil swept its only pair.
    expect(
      pickByRead(
        {
          ...M,
          pairs: [
            { ...pairOf('Normal', 'Holofoil'), ca: [-1], cb: [1] },
            { ...pairOf('Normal', 'Reverse Holofoil'), ca: [1], cb: [-1] }
          ]
        },
        [-1],
        ['Normal', 'Reverse Holofoil', 'Holofoil'],
        enabled
      )
    ).toBe('Reverse Holofoil')
  })
  it('takes Common when it wins both of its pairs', () => {
    const Y = split(['Common', 'Super Rare', 'Ultra Rare'])
    const pairs: [string, string][] = [
      ['Common', 'Super Rare'],
      ['Common', 'Ultra Rare']
    ]
    expect(pickByRead(Y, [-1], ['Common', 'Super Rare', 'Ultra Rare'], pairs)).toBe('Common')
  })
  it('is null when two finishes each win all their pairs', () => {
    const Y = split(['Common', 'Super Rare', 'Ultra Rare'])
    const pairs: [string, string][] = [
      ['Common', 'Super Rare'],
      ['Common', 'Ultra Rare']
    ]
    expect(pickByRead(Y, [1], ['Common', 'Super Rare', 'Ultra Rare'], pairs)).toBeNull()
  })
  it('is null with no enabled pair in the model', () => {
    expect(
      pickByRead(M, [-1], ['Normal', 'Reverse Holofoil'], [['Normal', 'Cosmos Holo']])
    ).toBeNull()
    expect(pickByRead({ ...M, pairs: [] }, [-1], ['Normal', 'Reverse Holofoil'], NR)).toBeNull()
  })
})
