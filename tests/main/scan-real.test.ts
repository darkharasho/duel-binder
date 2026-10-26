// @vitest-environment node
// Recognition on the owner's real webcam photos. They stay out of the (public) repo, so this only
// runs when SCAN_REAL_DIR points at a folder holding shot_*.jpg, truth.json and the cropped/ art
// that scripts/scan/prep-real.ts downloads:
//   SCAN_REAL_DIR=<dir> npx vitest run --maxWorkers=2 --silent=false tests/main/scan-real.test.ts
// (--silent=false shows the per-shot and summary tables when the tests pass.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { ART_MAX_DISTANCE, ART_MIN_MARGIN } from '../../src/shared/scan/thresholds'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv } from '../../src/renderer/src/features/scan/vision/cv'
import { recognizeArt } from '../../src/renderer/src/features/scan/vision/candidates'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

/** Share of recognizable shots that must be accepted with the right card. */
const MIN_ACCEPTED_CORRECT = 0.6
const FLAGS = ['sleeved', 'foil', 'cased', 'finger_on_art', 'angled'] as const

interface Truth {
  file: string
  name: string | null
  cardId: number | null
  imageCandidates?: number[]
  flags: string[]
}

interface Row {
  file: string
  name: string
  flags: string
  recognizable: boolean
  negative: boolean
  /** False for unlabelled frames of several cards, where any card shown may be accepted. */
  judged: boolean
  found: boolean
  top: number | null
  correct: boolean
  distance?: number
  margin?: number
  accepted: boolean
  ms: number
}

const DIR = process.env.SCAN_REAL_DIR

function load(path: string): RgbaImage {
  return decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
}

const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(1)}%)`

describe.skipIf(!DIR)('recognizeArt on real webcam photos', () => {
  const rows: Row[] = []

  beforeAll(async () => {
    const dir = DIR!
    const cv = await loadCv()
    const arts = JSON.parse(readFileSync(join(dir, 'cropped', 'index.json'), 'utf8')) as {
      imageId: number
      cardId: number
      frameType: string
    }[]
    const cardOf = new Map(arts.map((a) => [a.imageId, a.cardId]))
    const index = decodeFingerprints(
      encodeFingerprints(
        arts.map((a) => ({
          imageId: a.imageId,
          hash: artHash(
            fingerprintSource(load(join(dir, 'cropped', `${a.imageId}.jpg`)), a.frameType)
          )
        }))
      )
    )
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth[]
    for (const t of truth) {
      const img = load(join(dir, t.file))
      const start = performance.now()
      const found = recognizeArt(cv, img, index)
      const ms = performance.now() - start
      const matches = found?.matches ?? []
      const top = matches[0] ? cardOf.get(matches[0].imageId)! : null
      const next = matches.find((m) => cardOf.get(m.imageId) !== top)
      const distance = matches[0]?.distance
      // Margin is measured against the next different card; none in the top matches counts as clear.
      const margin = distance === undefined ? undefined : (next?.distance ?? Infinity) - distance
      // A card whose printed artwork YGOPRODeck lacks is labelled by its other artworks.
      const cardId = t.cardId ?? cardOf.get(t.imageCandidates?.[0] ?? -1) ?? null
      rows.push({
        file: t.file,
        name: t.name ?? '-',
        flags: t.flags.join(' '),
        recognizable:
          t.cardId !== null && !t.flags.includes('art_not_in_db') && !t.flags.includes('unsure'),
        negative: t.name === null || t.flags.includes('art_not_in_db'),
        judged: t.name !== null || !t.flags.includes('multiple'),
        found: found !== null,
        top,
        correct: top !== null && top === cardId,
        distance,
        margin,
        accepted:
          distance !== undefined && distance <= ART_MAX_DISTANCE && margin! >= ART_MIN_MARGIN,
        ms: Math.round(ms)
      })
    }
    const recognizable = rows.filter((r) => r.recognizable)
    const negatives = rows.filter((r) => r.negative)
    const misses = recognizable.filter((r) => !(r.accepted && r.correct))
    const sorted = rows.map((r) => r.ms).sort((a, b) => a - b)
    console.table(rows)
    console.table({
      'top-1 card correct': pct(recognizable.filter((r) => r.correct).length, recognizable.length),
      'accepted and correct': pct(
        recognizable.filter((r) => r.accepted && r.correct).length,
        recognizable.length
      ),
      'false accepts (not recognizable)': `${negatives.filter((r) => r.accepted).length}/${negatives.length}`,
      'accepted but wrong (all shots)': rows.filter((r) => r.accepted && !r.correct && r.judged)
        .length,
      'accepted in unlabelled multi-card frames': rows.filter((r) => r.accepted && !r.judged)
        .length,
      'median ms': sorted[sorted.length >> 1]
    })
    console.table(
      Object.fromEntries(
        FLAGS.map((f) => {
          const withFlag = recognizable.filter((r) => r.flags.split(' ').includes(f))
          const missed = misses.filter((r) => r.flags.split(' ').includes(f)).length
          return [f, `${missed} missed of ${withFlag.length}`]
        })
      )
    )
  }, 600_000)

  it('never accepts the wrong card', () => {
    const wrong = rows.filter((r) => r.accepted && !r.correct && r.judged)
    expect(wrong.map((r) => `${r.file} (${r.name}) as ${r.top}`)).toEqual([])
  })

  it(`accepts the right card in at least ${MIN_ACCEPTED_CORRECT * 100}% of recognizable shots`, () => {
    const recognizable = rows.filter((r) => r.recognizable)
    const hits = recognizable.filter((r) => r.accepted && r.correct).length
    expect(hits).toBeGreaterThanOrEqual(MIN_ACCEPTED_CORRECT * recognizable.length)
  })
})
