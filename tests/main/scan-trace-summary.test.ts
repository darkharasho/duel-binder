import { describe, expect, it } from 'vitest'
import { summarize, type TraceLineJson } from '../../scripts/scan/trace-summary'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'

const line = (o: Partial<TraceLineJson>): TraceLineJson => ({
  seq: 1,
  found: true,
  outcome: 'none',
  art: [],
  calls: [],
  ...o
})

const has = (ids: number[]) => (id: number) => ids.includes(id)
const images: Record<number, number[]> = { 7: [70, 71], 8: [80] }
const imagesOf = (cardId: number): number[] => images[cardId] ?? []

const reasonOf = (s: ReturnType<typeof summarize>, r: string) =>
  s.reasons.find((x) => x.reason === r)

describe('trace summary', () => {
  it('no-outline', () => {
    const s = summarize([line({ found: false, outcome: 'none', seq: 3 })], has([]), imagesOf)
    expect(reasonOf(s, 'no-outline')?.frames).toEqual(['#3'])
  })

  it('art-not-in-file', () => {
    const s = summarize(
      [
        line({
          outcome: 'far',
          frame: '0004.jpg',
          art: [{ imageId: 99, distance: 120, name: 'Other', sets: [] }],
          calls: [
            { m: 'matchName', args: ['Void'], out: { cardId: 7, name: 'Void', score: 1 }, ms: 1 }
          ]
        }),
        line({
          outcome: 'unsure',
          calls: [{ m: 'printingsByCode', args: ['FRA'], out: [{ cardId: 7 }], ms: 1 }]
        })
      ],
      has([80]),
      imagesOf
    )
    expect(reasonOf(s, 'art-not-in-file')).toMatchObject({
      frames: ['0004.jpg', '#1'],
      cards: ['7']
    })
    expect(reasonOf(s, 'unsure')).toBeUndefined()
  })

  it('art-far', () => {
    const s = summarize(
      [line({ outcome: 'far', art: [[11, 140]] as unknown as TraceLineJson['art'] })],
      has([11]),
      imagesOf
    )
    expect(reasonOf(s, 'art-far')?.frames).toEqual(['#1'])
  })

  it('a named card whose art is in the file is not art-not-in-file', () => {
    const s = summarize(
      [
        line({
          outcome: 'unsure',
          calls: [{ m: 'matchName', args: ['x'], out: { cardId: 8, name: 'x', score: 1 }, ms: 1 }]
        })
      ],
      has([80]),
      imagesOf
    )
    expect(reasonOf(s, 'unsure')?.frames).toEqual(['#1'])
    expect(reasonOf(s, 'art-not-in-file')).toBeUndefined()
  })

  it('unsure', () => {
    const s = summarize([line({ outcome: 'unsure' })], has([]), imagesOf)
    expect(reasonOf(s, 'unsure')?.frames).toEqual(['#1'])
  })

  it('recognized lines only counted in outcomes', () => {
    const s = summarize(
      [
        line({ outcome: 'recognized' }),
        line({ outcome: 'recognized' }),
        line({ outcome: 'unsure' })
      ],
      has([]),
      imagesOf
    )
    expect(s.frames).toBe(3)
    expect(s.outcomes).toEqual({ recognized: 2, unsure: 1 })
    expect(s.reasons.map((r) => r.reason)).toEqual(['unsure'])
  })

  it('FingerprintIndex.hasImage', () => {
    const hash = new Uint32Array(8)
    const index = decodeFingerprints(
      encodeFingerprints([
        { imageId: 433372871090, hash },
        { imageId: 5, hash }
      ])
    )
    expect(index.hasImage(433372871090)).toBe(true)
    expect(index.hasImage(5)).toBe(true)
    expect(index.hasImage(6)).toBe(false)
  })
})
