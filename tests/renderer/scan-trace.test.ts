import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTraceSampler,
  newTraceSession,
  recordLookups,
  scanTraceOn,
  setScanTraceOn,
  traceLine,
  type TraceFrame
} from '@/features/scan/scanTrace'
import type { FrameSignals } from '@/features/scan/engine'

const raw = (over: Partial<FrameSignals> = {}): FrameSignals => ({
  found: true,
  quad: [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
    { x: 7, y: 8 }
  ] as unknown as FrameSignals['quad'],
  art: [
    { imageId: 11, distance: 30 },
    { imageId: 12, distance: 55 }
  ],
  codeBands: [],
  nameBands: [],
  textBands: [],
  cues: null,
  look: null,
  ...over
})

const frame = (over: Partial<TraceFrame> = {}): TraceFrame => ({
  seq: 1,
  game: 'mtg',
  setKey: 'fra',
  sets: ['fra'],
  filterLanguage: null,
  finishLock: 'auto',
  camera: 'Facecam',
  size: [1920, 1080],
  raw: raw(),
  outcome: { kind: 'unsure' },
  counted: false,
  calls: [],
  reads: {},
  fpCount: 40000,
  ms: { vision: 20 },
  ...over
})

describe('scan trace (renderer)', () => {
  beforeEach(() => localStorage.clear())

  it('switch round-trips', () => {
    expect(scanTraceOn()).toBe(false)
    setScanTraceOn(true)
    expect(scanTraceOn()).toBe(true)
    expect(localStorage.getItem('scan.trace')).toBe('1')
    setScanTraceOn(false)
    expect(localStorage.getItem('scan.trace')).toBeNull()
  })

  it('newTraceSession format', () => {
    expect(newTraceSession(new Date('2026-11-13T08:16:58.123Z'))).toBe('2026-11-13T08-16-58-123Z')
  })

  it('recordLookups records calls and results', async () => {
    const hit = { cardId: 1, name: 'X', score: 0.9 }
    const { lookups, calls } = recordLookups({ matchName: async (_n: string) => hit })
    await expect(lookups.matchName('X')).resolves.toBe(hit)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ m: 'matchName', args: ['X'], out: hit })
    expect(typeof calls[0]!.ms).toBe('number')
  })

  it('recordLookups passes errors through', async () => {
    const boom = new Error('boom')
    const { lookups, calls } = recordLookups({
      matchName: async (_n: string): Promise<null> => {
        throw boom
      }
    })
    await expect(lookups.matchName('X')).rejects.toBe(boom)
    expect(calls[0]!.error).toBe('boom')
  })

  it('traceLine stays under 8 KB', () => {
    const printings = Array.from({ length: 500 }, (_, i) => ({
      printingId: i,
      cardId: 7,
      setCode: 'FRA',
      number: String(i),
      rarity: 'Common',
      language: 'en'
    }))
    const line = traceLine(
      frame({ calls: [{ m: 'printingsOfArt', args: [433372871090], out: printings, ms: 3 }] })
    )
    expect(line.length).toBeLessThanOrEqual(8192)
    const parsed = JSON.parse(line) as { calls: { out: { count: number; first: unknown[] } }[] }
    expect(parsed.calls[0]!.out.count).toBe(500)
    expect(parsed.calls[0]!.out.first).toHaveLength(3)
  })

  it('traceLine stays under 8 KB with many calls', () => {
    const calls = Array.from({ length: 200 }, (_, i) => ({
      m: 'matchName',
      args: ['a long card name that is read off the band ' + i],
      out: { cardId: i, name: 'Some long card name here ' + i, score: 0.5 },
      ms: 1
    }))
    const line = traceLine(frame({ calls }))
    expect(line.length).toBeLessThanOrEqual(8192)
    expect(JSON.parse(line)).toMatchObject({ callsCut: true })
  })

  it('traceLine stays valid JSON when one result is huge', () => {
    const line = traceLine(
      frame({
        calls: [{ m: 'matchName', args: ['x'], out: null, ms: 1 }],
        reads: { localName: ['z'.repeat(9000)] }
      })
    )
    expect(line.length).toBeLessThanOrEqual(8192)
    expect(JSON.parse(line)).toMatchObject({ callsCut: true, outcome: 'unsure', seq: 1 })
  })

  it('traceLine fields', () => {
    const parsed = JSON.parse(
      traceLine(
        frame({
          outcome: {
            kind: 'recognized',
            item: {
              cardId: 7,
              name: 'Void Extrapolator',
              imageId: 11,
              printingId: 70,
              setCode: 'FRA',
              rarity: 'Rare',
              options: [],
              flag: null,
              via: 'art',
              guess: true
            }
          },
          counted: true
        })
      )
    ) as Record<string, unknown>
    expect(parsed).toMatchObject({
      seq: 1,
      game: 'mtg',
      setKey: 'fra',
      found: true,
      art: [
        [11, 30],
        [12, 55]
      ],
      fpCount: 40000,
      outcome: 'recognized',
      card: { cardId: 7, name: 'Void Extrapolator', printingId: 70, rarity: 'Rare', guess: true },
      counted: true
    })
    expect(typeof parsed['t']).toBe('number')
  })

  it('traceLine outcome far', () => {
    const parsed = JSON.parse(traceLine(frame({ outcome: { kind: 'none', far: true } })))
    expect(parsed.outcome).toBe('far')
    expect(parsed.card).toBeUndefined()
  })

  it('sampler', () => {
    const s = createTraceSampler()
    expect([1, 2, 3].map(() => s.take(false, 'none').line)).toEqual([true, false, false])
    expect([1, 2, 3, 4].map(() => s.take(true, 'unsure').jpeg)).toEqual([true, false, true, false])
    expect(s.take(true, 'recognized')).toEqual({ line: true, jpeg: true })
    expect(s.take(false, 'none').line).toBe(true)
  })
})
