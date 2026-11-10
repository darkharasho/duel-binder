import {
  createSharpnessGate,
  createVote,
  readSnap,
  sharpness,
  snapBands,
  snapRect,
  stretch,
  toGray
} from '../../src/phone/training/numberSnap'
import type { OcrBand } from '@shared/scan/types'

const band = (width: number, height: number): OcrBand => ({
  width,
  height,
  data: new Uint8Array(width * height).map((_, i) => i % 251)
})

describe('snapRect', () => {
  it('maps the guide box through object-cover onto the video', () => {
    // A 1920x1080 frame in a 3:4 preview shows 810x1080 from x = 555.
    const r = snapRect(1920, 1080, 300, 400)
    expect(r).toEqual({ x: 758, y: 486, width: 405, height: 108 })
  })

  it('a grown box keeps its centre', () => {
    const r = snapRect(1920, 1080, 300, 400, undefined, 1.5)
    expect(r).toEqual({ x: 656, y: 459, width: 608, height: 162 })
    // Same centre as the drawn box's (960.5, 540), to the pixel.
    expect(Math.abs(r.x + r.width / 2 - (758 + 405 / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(r.y + r.height / 2 - (486 + 108 / 2))).toBeLessThanOrEqual(1)
  })

  it('a grown box stays inside what the preview shows', () => {
    const box = { left: 0.05, top: 0.9, width: 0.5, height: 0.1 } as const
    const r = snapRect(1920, 1080, 300, 400, box, 1.5)
    expect(r.x).toBe(555)
    expect(r.y + r.height).toBe(1080)
    expect(r.width).toBe(608)
  })
})

describe('toGray', () => {
  it('weights the channels', () => {
    const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1)
    expect([...g.data]).toEqual([255, 0])
  })
})

describe('stretch', () => {
  it('spreads grey-on-grey text out to black and white', () => {
    // A dim number under a sleeve: grays 100..140.
    const data = new Uint8Array(100).map((_, i) => 100 + Math.round((i * 40) / 99))
    const out = stretch({ width: 10, height: 10, data })
    expect(out.data[0]).toBe(0)
    expect(out.data[99]).toBe(255)
    expect(out.data[50]).toBeGreaterThan(110)
    expect(out.data[50]).toBeLessThan(145)
  })

  it('leaves a flat band alone', () => {
    const flat = { width: 4, height: 1, data: new Uint8Array([90, 92, 91, 93]) }
    expect(stretch(flat)).toBe(flat)
  })
})

describe('snapBands', () => {
  it('the whole box and its upper and lower parts', () => {
    const b = band(10, 20)
    const [whole, top, bottom] = snapBands(b)
    expect(whole).toBe(b)
    expect(top.height).toBe(12)
    expect(bottom.height).toBe(12)
    expect([...top.data.slice(0, 10)]).toEqual([...b.data.slice(0, 10)])
    expect([...bottom.data.slice(-10)]).toEqual([...b.data.slice(-10)])
  })

  it('a thin box is read whole', () => {
    expect(snapBands(band(10, 6))).toHaveLength(1)
  })

  it('a grown box: the drawn box rows first, then as tall at the top and the bottom', () => {
    const b = band(10, 30)
    const [mid, top, bottom] = snapBands(b, 1.5)
    expect(mid.height).toBe(20)
    expect([...mid.data.slice(0, 10)]).toEqual([...b.data.slice(50, 60)])
    expect(top.height).toBe(20)
    expect([...top.data.slice(0, 10)]).toEqual([...b.data.slice(0, 10)])
    expect(bottom.height).toBe(20)
    expect([...bottom.data.slice(-10)]).toEqual([...b.data.slice(-10)])
    expect(snapBands(b, 1.5)).toHaveLength(3)
  })
})

/** A band of vertical stripes `period` px wide, or flat when blurred out. */
const stripes = (period: number, contrast = 255): OcrBand => {
  const width = 40
  const height = 10
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data[y * width + x] = Math.floor(x / period) % 2 === 0 ? 0 : contrast
  return { width, height, data }
}

/** A 3-tap box blur along rows, like a sideways wobble. */
const blur = (b: OcrBand): OcrBand => {
  const out = new Uint8Array(b.data.length)
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      const at = (dx: number): number =>
        b.data[y * b.width + Math.min(b.width - 1, Math.max(0, x + dx))]
      out[y * b.width + x] = Math.round((at(-2) + at(-1) + at(0) + at(1) + at(2)) / 5)
    }
  return { ...b, data: out }
}

describe('sharpness', () => {
  it('falls when the band is blurred', () => {
    const sharp = stripes(3)
    expect(sharpness(sharp)).toBeGreaterThan(sharpness(blur(sharp)) * 2)
    expect(sharpness(blur(sharp))).toBeGreaterThan(sharpness(blur(blur(sharp))))
  })

  it('a flat or tiny band is 0', () => {
    expect(sharpness({ width: 4, height: 4, data: new Uint8Array(16).fill(120) })).toBe(0)
    expect(sharpness({ width: 2, height: 2, data: new Uint8Array(4) })).toBe(0)
  })
})

describe('createSharpnessGate', () => {
  it('lets the first frames through, then skips one far softer than the recent best', () => {
    const gate = createSharpnessGate()
    expect(gate.pass(100)).toBe(true)
    expect(gate.pass(90)).toBe(true)
    expect(gate.pass(30)).toBe(false)
    expect(gate.pass(60)).toBe(true)
  })

  it('a soft camera is never locked out: after a few skips it reads anyway', () => {
    const gate = createSharpnessGate({ maxSkips: 3 })
    gate.pass(1000)
    gate.pass(1000)
    expect([gate.pass(5), gate.pass(5), gate.pass(5), gate.pass(5)]).toEqual([
      false,
      false,
      false,
      true
    ])
  })

  it('the bar comes down once the sharp frames leave the window', () => {
    const gate = createSharpnessGate({ window: 4, maxSkips: 99 })
    gate.pass(1000)
    gate.pass(1000)
    const passes = Array.from({ length: 6 }, () => gate.pass(10))
    expect(passes.slice(0, 2)).toEqual([false, false])
    expect(passes.at(-1)).toBe(true)
  })

  it('reset starts over', () => {
    const gate = createSharpnessGate()
    gate.pass(1000)
    gate.pass(1000)
    gate.reset()
    expect(gate.pass(1)).toBe(true)
  })
})

describe('createVote', () => {
  it('two of the last three agree', () => {
    const vote = createVote()
    expect(vote.push('OP01-001')).toBeNull()
    expect(vote.push(null)).toBeNull()
    expect(vote.push('OP01-001')).toBe('OP01-001')
  })

  it('a wrong read between two good ones does not reset it', () => {
    const vote = createVote()
    vote.push('OP01-001')
    vote.push('OP01-007')
    expect(vote.push('OP01-001')).toBe('OP01-001')
  })

  it('one read among misses is not enough', () => {
    const vote = createVote()
    const got = ['OP01-001', null, null, 'OP01-001', null, null, 'OP01-001'].map((r) =>
      vote.push(r)
    )
    expect(got.every((g) => g === null)).toBe(true)
  })

  it('the next card takes over once it reads twice', () => {
    const vote = createVote()
    vote.push('OP01-001')
    vote.push('OP01-001')
    expect(vote.push('OP01-002')).toBe('OP01-001')
    expect(vote.push('OP01-002')).toBe('OP01-002')
  })
})

describe('readSnap', () => {
  const exists = async (n: string): Promise<boolean> => n !== 'OP09-999'
  const deps = (texts: string[]): Parameters<typeof readSnap>[1] => ({
    ocr: async () => texts,
    prefixes: ['OP05', 'P'],
    exists
  })

  it('one number the catalog has, read on any line', async () => {
    expect(await readSnap(band(10, 20), deps(['', 'OP05-119 SEC', '0P05-1I9']))).toEqual({
      number: 'OP05-119'
    })
  })

  it('nothing, or only numbers the catalog lacks', async () => {
    expect(await readSnap(band(10, 20), deps(['HELLO']))).toEqual({ problem: 'none' })
    expect(await readSnap(band(10, 20), deps(['OP09-999']))).toEqual({ problem: 'none' })
  })

  it('a grown box: a number in the drawn box rows skips the other bands', async () => {
    const ocr = vi.fn(async (bands: OcrBand[]) => bands.map(() => 'OP05-119'))
    const r = await readSnap(band(10, 30), { ocr, prefixes: ['OP05'], exists, grow: 1.5 })
    expect(r).toEqual({ number: 'OP05-119' })
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(ocr.mock.calls[0][0]).toHaveLength(1)
  })

  it('a grown box: nothing in the drawn box rows reads the top and the bottom', async () => {
    const ocr = vi
      .fn<(bands: OcrBand[]) => Promise<string[]>>()
      .mockResolvedValueOnce(['CP9'])
      .mockResolvedValueOnce(['', 'OP05-119'])
    const r = await readSnap(band(10, 30), { ocr, prefixes: ['OP05'], exists, grow: 1.5 })
    expect(r).toEqual({ number: 'OP05-119' })
    expect(ocr.mock.calls[1][0]).toHaveLength(2)
  })

  it('two numbers is a problem', async () => {
    expect(await readSnap(band(10, 20), deps(['OP05-119', 'OP05-118']))).toEqual({
      problem: 'many'
    })
  })
})
