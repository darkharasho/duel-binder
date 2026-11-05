import { readSnap, snapBands, snapRect, toGray } from '../../src/phone/training/numberSnap'
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
    expect(r).toEqual({ x: 555 + 65, y: 432, width: 680, height: 216 })
  })
})

describe('toGray', () => {
  it('weights the channels', () => {
    const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1)
    expect([...g.data]).toEqual([255, 0])
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

  it('two numbers is a problem', async () => {
    expect(await readSnap(band(10, 20), deps(['OP05-119', 'OP05-118']))).toEqual({
      problem: 'many'
    })
  })
})
