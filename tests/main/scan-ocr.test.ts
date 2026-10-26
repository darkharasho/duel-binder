// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { decode } from 'jpeg-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bestNameMatch } from '../../src/shared/scan/names'
import { setCodeCandidates } from '../../src/shared/scan/setCode'
import type { RgbaImage } from '../../src/shared/scan/types'
import { checkOcrBands, createOcr, engLangPath } from '../../src/main/scan/ocr'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { findCard, rotate180, warpCard } from '../../src/renderer/src/features/scan/vision/detect'
import { CODE_BANDS, NAME_BAND } from '../../src/renderer/src/features/scan/vision/regions'
import { toBand } from '../../src/renderer/src/features/scan/vision/bands'

// See scan-vision-detect.test.ts: hand over the plain OpenCV module so importing it settles.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

const DIR = 'tests/fixtures/scan'

interface Shot {
  file: string
  cardId: number
  name: string
  setCode: string
}

const { shots, distractors } = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  shots: Shot[]
  distractors: { cardId: number; name: string }[]
}
const names = [
  ...new Map([...shots, ...distractors].map((c) => [c.cardId, { id: c.cardId, name: c.name }]))
].map(([, n]) => n)

const ocr = createOcr()
const times: number[] = []

async function timed(...args: Parameters<typeof ocr.read>): Promise<string[]> {
  const t = performance.now()
  const out = await ocr.read(...args)
  if (args[0].length) times.push((performance.now() - t) / args[0].length)
  return out
}

/** The straightened card both ways up, since warpCard doesn't know which end is the top. */
const cards = new Map<string, RgbaImage[]>()

let cv: CV

beforeAll(async () => {
  cv = await loadCv()
  for (const s of shots) {
    const img = decode(readFileSync(join(DIR, s.file)), { useTArray: true, formatAsRGBA: true })
    const quad = findCard(cv, img)
    if (!quad) continue
    const card = warpCard(cv, img, quad)
    cards.set(s.file, [card, rotate180(card)])
  }
}, 60_000)

afterAll(() => ocr.dispose())

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A code band as a card held close shows it: the code ~20 px tall in dark ink on a light, uneven
 * frame under the art's edge, slightly blurred, with sensor noise. Sized like CODE_BANDS[0] on a
 * straightened card (842 wide).
 */
function codeLine(code: string, seed: number): RgbaImage {
  const rand = rng(seed)
  const width = 758
  const height = 86
  const mat = new cv.Mat(height, width, cv.CV_8UC4)
  const base = [170 + rand() * 50, 160 + rand() * 50, 140 + rand() * 50]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const shade = 20 * (x / width - 0.5)
      for (let c = 0; c < 3; c++) mat.data[(y * width + x) * 4 + c] = base[c] + shade
      mat.data[(y * width + x) * 4 + 3] = 255
    }
  const ink = new cv.Scalar(25, 25, 30, 255)
  cv.line(mat, new cv.Point(20, 8), new cv.Point(width - 20, 8), ink, 2)
  const x = Math.round(width * (0.35 + rand() * 0.2))
  cv.putText(mat, code, new cv.Point(x, 54), cv.FONT_HERSHEY_SIMPLEX, 0.9, ink, 2, cv.LINE_AA)
  cv.GaussianBlur(mat, mat, new cv.Size(0, 0), 0.6 + rand() * 0.4)
  const data = new Uint8ClampedArray(mat.data)
  mat.delete()
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] += (rand() - 0.5) * 16
  return { width, height, data }
}

describe('ocr', () => {
  it('reads set codes printed at a legible size', async () => {
    const codes = [...new Set(shots.map((s) => s.setCode))]
    const rows: { code: string; text: string; candidates: string[] }[] = []
    for (const [i, code] of codes.entries()) {
      const [text] = await timed([toBand(codeLine(code, i + 1), [0, 0, 1, 1])], 'code')
      rows.push({ code, text, candidates: setCodeCandidates(text) })
    }
    const hits = rows.filter((r) => r.candidates.includes(r.code))
    console.log(`set code, legible: ${hits.length}/${codes.length}`)
    if (hits.length < codes.length) console.table(rows.filter((r) => !hits.includes(r)))
    expect(hits.length).toBeGreaterThanOrEqual(0.75 * codes.length)
  }, 60_000)

  // At normal holding distance a webcam shows the code ~8 px tall, too small to read; this is a
  // metric only. Art matching carries recognition, and codes are read when a card is held close.
  it('logs the set code rate on the webcam fixtures', async () => {
    const rows: { file: string; want: string; texts: string[] }[] = []
    for (const s of shots) {
      const bands = (cards.get(s.file) ?? []).flatMap((card) =>
        CODE_BANDS.map((b) => toBand(card, b))
      )
      rows.push({ file: s.file, want: s.setCode, texts: await timed(bands, 'code') })
    }
    const hits = rows.filter((r) => r.texts.some((t) => setCodeCandidates(t).includes(r.want)))
    console.log(`set code, webcam fixtures: ${hits.length}/${shots.length}`)
    expect(rows).toHaveLength(shots.length)
  }, 300_000)

  it('names the right card in at least 75% of shots', async () => {
    const rows: { file: string; want: string; texts: string[]; got?: number }[] = []
    for (const s of shots) {
      const texts = await timed(
        (cards.get(s.file) ?? []).map((card) => toBand(card, NAME_BAND)),
        'name'
      )
      const best = texts
        .map((t) => bestNameMatch(t, names))
        .reduce<{ id: number; score: number } | null>(
          (a, b) => (b && (!a || b.score > a.score) ? b : a),
          null
        )
      rows.push({ file: s.file, want: s.name, texts, got: best?.id })
    }
    const hits = rows.filter((r, i) => r.got === shots[i].cardId)
    console.log(`name: ${hits.length}/${shots.length}`)
    if (hits.length < shots.length) console.table(rows.filter((r) => !hits.includes(r)))
    expect(hits.length).toBeGreaterThanOrEqual(0.75 * shots.length)
  }, 300_000)

  it('reports per-band OCR time', () => {
    const sorted = [...times].sort((a, b) => a - b)
    console.log(`OCR per band: median ${sorted[sorted.length >> 1]?.toFixed(1)} ms`)
    expect(times.length).toBeGreaterThan(0)
  })

  it('never reaches for the network', () => {
    expect(readFileSync('src/main/scan/ocr.ts', 'utf8')).not.toContain('http')
  })

  it('finds the installed English model', () => {
    const dir = engLangPath()
    expect(isAbsolute(dir)).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
    expect(existsSync(join(dir, 'eng.traineddata.gz'))).toBe(true)
  })
})

describe('ocr failures', () => {
  const band = (width: number, height: number, length = width * height): unknown => ({
    width,
    height,
    data: new Uint8Array(length)
  })

  it('accepts what toBand makes, including an empty band', () => {
    expect(() => checkOcrBands([band(300, 80), band(0, 0)])).not.toThrow()
  })

  it.each([
    ['not a list', { width: 1, height: 1, data: new Uint8Array(1) }],
    ['too many bands', Array.from({ length: 9 }, () => band(2, 2))],
    ['a fractional width', [band(10.5, 10, 105)]],
    ['a negative height', [band(10, -1, 0)]],
    ['one side zero', [band(0, 10, 0)]],
    ['a side over 4096', [band(4097, 1)]],
    ['over 4 million pixels', [band(2001, 2000)]],
    ['short data', [band(10, 10, 99)]],
    ['data that is not bytes', [{ width: 1, height: 1, data: [0] }]],
    ['a missing band', [null]]
  ])('rejects %s', (_, bands) => {
    expect(() => checkOcrBands(bands)).toThrow(/OCR/)
  })

  it('rejects a band tesseract cannot read without an uncaught exception, then reads again', async () => {
    const uncaught = vi.fn()
    process.on('uncaughtException', uncaught)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const local = createOcr()
    try {
      // Past checkOcrBands this can't come from the renderer; it makes the job itself fail.
      const bad = { width: 10.5, height: 10, data: new Uint8Array(105) }
      await expect(local.read([bad], 'code')).rejects.toThrow()
      const [text] = await local.read([toBand(codeLine('BROL-EN062', 1), [0, 0, 1, 1])], 'code')
      expect(setCodeCandidates(text)).toContain('BROL-EN062')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(uncaught).not.toHaveBeenCalled()
    } finally {
      process.off('uncaughtException', uncaught)
      warn.mockRestore()
      await local.dispose()
    }
  }, 30_000)

  it('gives up on a read that takes too long and starts afresh', async () => {
    const local = createOcr({ timeoutMs: 1 })
    try {
      await expect(
        local.read([toBand(codeLine('LOB-EN005', 2), [0, 0, 1, 1])], 'code')
      ).rejects.toThrow('OCR timed out')
    } finally {
      await local.dispose()
    }
  })
})
