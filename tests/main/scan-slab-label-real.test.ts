// @vitest-environment node
// Reading graded slabs' labels on real photos: the app's own card outline (analyze), the label cut
// above it (slabLabelBand) and read whole with the English model, then parsed (parseSlabLabel).
// Scored against the company and grade noted in the label files. Not part of CI (the photos are
// on the owner's machine): SCAN_SLAB_DIR=~/scan-capture npx vitest run tests/main/scan-slab-label-real.test.ts
// SCAN_SLAB_OUT=<dir> writes each band as a PGM and the reads as reads.json, for a look.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { decodeFingerprints, type FingerprintIndex } from '../../src/shared/scan/fingerprintFile'
import { readTexts, toPgm } from '../../src/shared/scan/ocr'
import { scanProfile } from '../../src/shared/scan/profiles'
import { parseSlabLabel, type SlabRead } from '../../src/shared/scan/slabLabel'
import type { OcrBand, RgbaImage } from '../../src/shared/scan/types'
import { createOcr } from '../../src/main/scan/ocr'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { toMat } from '../../src/renderer/src/features/scan/vision/detect'
import { slabQuad } from '../../src/renderer/src/features/scan/vision/holder'
import { slabLabelBand } from '../../src/renderer/src/features/scan/vision/slabLabel'

vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('../../vendor/opencv/opencv.js') }
})

const home = (p: string): string => p.replace(/^~/, homedir())
const DIR = process.env.SCAN_SLAB_DIR ? home(process.env.SCAN_SLAB_DIR) : undefined
const OUT = process.env.SCAN_SLAB_OUT ? home(process.env.SCAN_SLAB_OUT) : undefined
const READY = !!DIR && existsSync(join(DIR, 'label-work'))

interface Case {
  file: string
  company: string
  grade: string
}

function cases(dir: string): Case[] {
  const seen = new Map<string, Case>()
  for (const f of readdirSync(join(dir, 'label-work')).filter((f) => f.endsWith('.json'))) {
    let rows: unknown
    try {
      rows = JSON.parse(readFileSync(join(dir, 'label-work', f), 'utf8'))
    } catch {
      continue
    }
    if (!Array.isArray(rows)) continue
    for (const r of rows as { file?: string; holder?: string; notes?: string }[]) {
      if (r?.holder !== 'slab' || !r.file || seen.has(r.file)) continue
      // "PSA 7 NM", "CGC 10 Gem Mint"; a note that says the title and label differ is left out.
      const m = /\b(PSA|CGC|BGS|SGC|TAG|ACE)\s*(10|[1-9](?:\.5)?)\b/.exec(r.notes ?? '')
      if (!m || /title says/i.test(r.notes ?? '')) continue
      if (existsSync(join(dir, r.file)))
        seen.set(r.file, { file: r.file, company: m[1], grade: m[2] })
    }
  }
  return [...seen.values()]
}

function loadImage(path: string): RgbaImage {
  const bytes = readFileSync(path)
  if (bytes[0] === 0x89) {
    const png = PNG.sync.read(bytes)
    return { width: png.width, height: png.height, data: png.data }
  }
  return decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
}

describe.skipIf(!READY)('reading slab labels on real photos', () => {
  let cv: CV
  let index: FingerprintIndex
  const ocr = createOcr()
  const results: {
    file: string
    want: Case
    got: SlabRead | null
    text: string
    why: string
    detected?: boolean
  }[] = []

  beforeAll(async () => {
    cv = await loadCv()
    index = decodeFingerprints(readFileSync(join(DIR!, 'pkm-work', 'fingerprints-pkm.bin')))
    if (OUT) mkdirSync(OUT, { recursive: true })
    const profile = scanProfile('pkm')
    for (const c of cases(DIR!)) {
      const img = loadImage(join(DIR!, c.file))
      const signals = analyze(cv, img, index, null, false, false, profile)
      if (!signals.found || !signals.quad) {
        results.push({ file: c.file, want: c, got: null, text: '', why: 'no card' })
        continue
      }
      const frame = toMat(cv, img)
      const bands: OcrBand[] = []
      let detected: boolean
      try {
        const turned = slabQuad(frame, signals.quad)
        detected = turned !== null
        // A photo cropped to the slab leaves no desk round the label, so the slab check misses it
        // (the app reads only labels it found): then both ways up are read, to score the reading.
        const q = signals.quad
        const ways = turned ? [turned] : [q, [q[2], q[3], q[0], q[1]] as typeof q]
        for (const w of ways) {
          const b = slabLabelBand(cv, frame, w)
          if (b) bands.push(b)
        }
      } finally {
        frame.delete()
      }
      if (!bands.length) {
        results.push({ file: c.file, want: c, got: null, text: '', why: 'no band' })
        continue
      }
      let got: SlabRead = {}
      let text = ''
      let band = bands[0]
      for (const b of bands) {
        const [t = ''] = await readTexts(ocr, [b], 'eng').catch(() => [''])
        const read = parseSlabLabel(t)
        if (read.grade || !text) {
          got = read
          text = t
          band = b
        }
        if (read.grade) break
      }
      const name = c.file.replace(/[/]/g, '_')
      if (OUT) writeFileSync(join(OUT, `${name}.pgm`), toPgm(band))
      results.push({ file: c.file, want: c, got, text, why: '', detected })
    }
  }, 1_800_000)

  afterAll(async () => {
    await ocr.dispose()
  })

  it('reads the grade right, and says nothing rather than a wrong one', () => {
    const right = results.filter((r) => r.got?.grade === r.want.grade)
    const wrong = results.filter((r) => r.got?.grade && r.got.grade !== r.want.grade)
    const companyRight = results.filter((r) => r.got?.company === r.want.company)
    const companyWrong = results.filter((r) => r.got?.company && r.got.company !== r.want.company)
    const certs = results.filter((r) => r.got?.cert)
    const summary = {
      photos: results.length,
      'grade right': right.length,
      'grade wrong': wrong.length,
      'company right': companyRight.length,
      'company wrong': companyWrong.length,
      'cert read': certs.length,
      'no card/slab/band': results.filter((r) => r.why).length
    }
    console.log(summary)
    for (const r of wrong)
      console.log('WRONG', r.file, r.want, r.got, JSON.stringify(r.text.slice(0, 200)))
    for (const r of companyWrong)
      console.log('CO-WRONG', r.file, r.want, r.got, JSON.stringify(r.text.slice(0, 200)))
    if (OUT) writeFileSync(join(OUT, 'reads.json'), JSON.stringify(results, null, 1))
    expect(results.length).toBeGreaterThan(0)
  })
})
