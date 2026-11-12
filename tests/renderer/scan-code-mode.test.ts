import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ScanDraft } from '@shared/scan/types'
import { useCodeReader, type CodeStatus } from '../../src/renderer/src/features/scan/useCodeReader'
import { createMockApi } from './mockApi'
import { printing } from './scanFakes'
import {
  aimRect,
  codeBands,
  createCodeGate,
  darkBands,
  readCode,
  codeModeGame
} from '../../src/renderer/src/features/scan/codeMode'

describe('createCodeGate', () => {
  const run = (reads: (string | null)[]): (string | null)[] => {
    const gate = createCodeGate(2, 3)
    return reads.map((r) => gate.push(r))
  }

  it('takes a code once it reads twice running, and once only while it stays', () => {
    expect(run(['A', 'A', 'A', 'A', 'A'])).toEqual([null, 'A', null, null, null])
  })

  it('never takes a single misread', () => {
    expect(run(['A', 'B', 'A', null, 'B'])).toEqual([null, null, null, null, null])
  })

  it('takes the next code at once, and the same code again only after it left the box', () => {
    expect(run(['A', 'A', 'B', 'B', 'A', 'A'])).toEqual([null, 'A', null, 'B', null, 'A'])
    expect(run(['A', 'A', null, null, 'A', 'A'])).toEqual([null, 'A', null, null, null, null])
    expect(run(['A', 'A', null, null, null, 'A', 'A'])).toEqual([
      null,
      'A',
      null,
      null,
      null,
      null,
      'A'
    ])
  })

  it('takes the code again after forget', () => {
    const gate = createCodeGate(2, 3)
    gate.push('A')
    expect(gate.push('A')).toBe('A')
    gate.forget()
    expect(gate.push('A')).toBe(null)
    expect(gate.push('A')).toBe('A')
  })
})

describe('readCode', () => {
  it("reads each game's code", () => {
    expect(readCode('ygo', 'LOCR-JP001')).toBe('LOCR-JP001')
    expect(readCode('ygo', ' LOCRJP001 ')).toBe('LOCR-JP001')
    expect(readCode('ygo', 'hello')).toBeNull()
    expect(readCode('op', 'OP05-119')).toBe('OP05-119')
  })
})

  it('reads a Magic code in code mode', () => {
    expect(readCode('mtg', 'C 0081 FRA • EN')).toBe('FRA 81')
    expect(readCode('mtg', 'Wizards of the Coast')).toBeNull()
    expect(codeModeGame('mtg')).toBe(true)
  })

describe('aimRect', () => {
  it('is the aim box within the part of the frame the 3:4 preview shows', () => {
    // A 1920x1080 frame shows 810x1080 from x = 555.
    expect(aimRect(1920, 1080, [0, 0.5, 1, 0.6])).toEqual({
      x: 555,
      y: 540,
      width: 810,
      height: 108
    })
  })
})

describe('codeBands', () => {
  it('cuts out the line of characters in the box, in grayscale and as ink, and nothing from a blank box', () => {
    const width = 300
    const height = 60
    const data = new Uint8ClampedArray(width * height * 4).fill(235)
    // Eight dark "characters" 14 px wide and 30 px tall, 8 px apart, from x = 20 to 188.
    for (let c = 0; c < 8; c++)
      for (let y = 15; y < 45; y++)
        for (let x = 20 + c * 22; x < 34 + c * 22; x++) data.set([20, 20, 20], (y * width + x) * 4)
    const bands = codeBands({ width, height, data })
    // One line (found in the whole box and again in its top and bottom), as grayscale then ink.
    expect(bands.length).toBeGreaterThanOrEqual(2)
    // A box this small is read three times up; the line is cut to its own width, not the box's.
    for (const b of bands) {
      expect(b.width).toBeGreaterThan(0)
      expect(b.width).toBeLessThan(width * 3 * 0.8)
    }
    const blank = new Uint8ClampedArray(width * height * 4).fill(235)
    expect(codeBands({ width, height, data: blank })).toEqual([])
  })
})

describe('darkBands', () => {
  /** A 600x140 box: a mid-gray foil bar full of light and dark glitter, with eight black
   * characters 24 px wide and 50 px tall from x = 150, and nothing else dark. */
  function foilBox(withCode: boolean): { width: number; height: number; data: Uint8ClampedArray } {
    const width = 600
    const height = 140
    const data = new Uint8ClampedArray(width * height * 4)
    let seed = 7
    const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < width * height; i++) {
      // Single-pixel specks, as glitter is at this size.
      const r = rand()
      const v = r < 0.08 ? 250 : r < 0.16 ? 70 : 140
      data.set([v, v, v, 255], i * 4)
    }
    if (withCode)
      for (let c = 0; c < 8; c++)
        for (let y = 45; y < 95; y++)
          for (let x = 150 + c * 34; x < 174 + c * 34; x++)
            data.set([15, 15, 15], (y * width + x) * 4)
    return { width, height, data }
  }

  it('cuts the code out to its own width through the glitter, as ink on white', () => {
    const bands = darkBands(foilBox(true))
    expect(bands.length).toBeGreaterThan(0)
    for (const b of bands) {
      // The line is 262 px of a 600 px box, worked on at 160/140 and brought to 32 px letters.
      expect(b.width).toBeGreaterThan(0)
      expect(b.width).toBeLessThan(300)
      expect(new Set(b.data)).toEqual(new Set([0, 255]))
    }
  })

  it('finds no line in glitter alone', () => {
    expect(darkBands(foilBox(false))).toEqual([])
  })
})

describe('useCodeReader', () => {
  const LOCR = [
    printing({ printingId: 201, setCode: 'LOCR-JP001', rarity: 'Common', language: 'ja' }),
    printing({ printingId: 202, setCode: 'LOCR-JP001', rarity: 'Secret Rare', language: 'ja' })
  ]

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(
    reads: string[][],
    known: string[] = ['LOCR-JP001']
  ): {
    onDraft: ReturnType<typeof vi.fn>
    result: { current: CodeStatus }
    rerender: (p: { running: boolean }) => void
  } {
    vi.useFakeTimers()
    window.api = createMockApi({
      scan: {
        printingsByCode: vi.fn(async (code: string) =>
          known.includes(code) ? LOCR.map((p) => ({ ...p, setCode: code })) : []
        )
      }
    })
    let i = 0
    // A plain text is a fallback band's read; "vote:" before it makes it a glitter-free band's.
    const read = vi.fn(async function* () {
      for (const r of reads[Math.min(i++, reads.length - 1)])
        yield r.startsWith('vote:') ? { text: r.slice(5), vote: true } : { text: r, vote: false }
    })
    const onDraft = vi.fn(() => 'row')
    const video = { current: document.createElement('video') }
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useCodeReader({
          videoRef: video,
          running,
          game: 'ygo',
          setPrintings: null,
          defaultRarity: null,
          filterLanguage: null,
          onDraft,
          read
        }),
      { initialProps: { running: true } }
    )
    return { onDraft, result, rerender }
  }

  const tick = async (n: number): Promise<void> => {
    for (let k = 0; k < n; k++) await act(() => vi.advanceTimersByTimeAsync(150))
  }

  it('adds the card a code names once it reads twice, offering the code’s rarities', async () => {
    const { onDraft, result } = setup([['LOCR-JP001'], ['LOCRJP001'], ['LOCR-JP001'], []])
    expect(result.current).toEqual({ kind: 'aim' })
    await tick(4)
    expect(onDraft).toHaveBeenCalledTimes(1)
    const draft = onDraft.mock.calls[0][0] as ScanDraft
    expect(draft).toMatchObject({ cardId: 1, setCode: 'LOCR-JP001', via: 'code' })
    expect(draft.options.map((p) => p.rarity)).toEqual(['Common', 'Secret Rare'])
    expect(result.current).toMatchObject({ kind: 'added', code: 'LOCR-JP001' })
  })

  it('passes over a misread that names no card for the next band that does', async () => {
    const { onDraft } = setup([['RAOS-EN045', 'LOCR-JP001']])
    await tick(3)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect((onDraft.mock.calls[0][0] as ScanDraft).setCode).toBe('LOCR-JP001')
  })

  it('says when a code read twice names no card, and adds nothing', async () => {
    const { onDraft, result } = setup([['ABCD-EN999']])
    await tick(3)
    expect(onDraft).not.toHaveBeenCalled()
    expect(result.current).toEqual({ kind: 'unknown', code: 'ABCD-EN999' })
  })

  it('takes the code most glitter-free bands name, outvoting a misread digit', async () => {
    const reads = ['vote:LOCR-JP001', 'vote:LOCR-JP002', 'vote:LOCR-JP001', 'LOCR-JP002']
    const { onDraft } = setup([reads], ['LOCR-JP001', 'LOCR-JP002'])
    await tick(3)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect((onDraft.mock.calls[0][0] as ScanDraft).setCode).toBe('LOCR-JP001')
  })

  it('takes nothing on a tie, nor reads the fallback bands once a vote names a card', async () => {
    const { onDraft } = setup(
      [['vote:LOCR-JP001', 'vote:LOCR-JP002', 'LOCR-JP001']],
      ['LOCR-JP001', 'LOCR-JP002']
    )
    await tick(4)
    expect(onDraft).not.toHaveBeenCalled()
  })

  it('takes nothing on a single vote', async () => {
    const { onDraft } = setup([['vote:LOCR-JP001', 'vote:ABCD-EN999']])
    await tick(4)
    expect(onDraft).not.toHaveBeenCalled()
  })

  it('reads the fallback bands when no glitter-free band names a card', async () => {
    const { onDraft } = setup([['vote:ABCD-EN999', 'LOCR-JP001']])
    await tick(3)
    expect(onDraft).toHaveBeenCalledTimes(1)
  })

  it('reads nothing while off', async () => {
    const { onDraft, rerender } = setup([['LOCR-JP001']])
    rerender({ running: false })
    await tick(4)
    expect(onDraft).not.toHaveBeenCalled()
  })
})
