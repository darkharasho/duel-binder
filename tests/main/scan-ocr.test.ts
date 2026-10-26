// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bestNameMatch } from '../../src/shared/scan/names'
import { setCodeCandidates } from '../../src/shared/scan/setCode'
import type { RgbaImage } from '../../src/shared/scan/types'
import { createOcr } from '../../src/main/scan/ocr'
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

describe('ocr', () => {
  it('reads the set code in at least 75% of shots', async () => {
    const rows: { file: string; want: string; texts: string[] }[] = []
    for (const s of shots) {
      const bands = (cards.get(s.file) ?? []).flatMap((card) =>
        CODE_BANDS.map((b) => toBand(card, b))
      )
      const texts = await timed(bands, 'code')
      rows.push({ file: s.file, want: s.setCode, texts })
    }
    const hits = rows.filter((r) => r.texts.some((t) => setCodeCandidates(t).includes(r.want)))
    console.log(`set code: ${hits.length}/${shots.length}`)
    if (hits.length < shots.length) console.table(rows.filter((r) => !hits.includes(r)))
    expect(hits.length).toBeGreaterThanOrEqual(0.75 * shots.length)
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
})
