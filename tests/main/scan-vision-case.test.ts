// @vitest-environment node
// Cards in magnetic one-touch cases, made from the fixture shots by drawing a clear acrylic slab
// round each card (tests/main/scanCase.ts), and outlines a few percent off the card.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import {
  decodeFingerprints,
  encodeFingerprints,
  type FingerprintIndex
} from '../../src/shared/scan/fingerprintFile'
import { ART_BOX_JITTER, ART_MAX_DISTANCE, ART_MIN_MARGIN } from '../../src/shared/scan/thresholds'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import {
  rankArt,
  warpCard,
  type Point,
  type Quad
} from '../../src/renderer/src/features/scan/vision/detect'
import {
  findCandidates,
  preferOuter,
  recognizeArt
} from '../../src/renderer/src/features/scan/vision/candidates'
import { cardPoint, inCase, TIGHT_CASE, WIDE_CASE, type CaseStyle } from './scanCase'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

const DIR = 'tests/fixtures/scan'

interface Shot {
  file: string
  imageId: number
  frame: string
  quad: Quad
}

const { shots, distractors } = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  shots: Shot[]
  distractors: { imageId: number; frame: string }[]
}
const artFrames = new Map([...shots, ...distractors].map((x) => [x.imageId, x.frame]))

function load(path: string): RgbaImage {
  return decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
}

const diagonal = Math.hypot(1280, 720)

/** How far a's corners are from b's, either way round, as a share of the frame's diagonal. */
function off(a: readonly Point[], b: readonly Point[]): number {
  const from = (c: readonly Point[]): number =>
    Math.max(...a.map((p, i) => Math.hypot(p[0] - c[i][0], p[1] - c[i][1])))
  return Math.min(from(b), from([b[2], b[3], b[0], b[1]])) / diagonal
}

/** A thick case with glare streaking over the card. */
const GLARE_CASE: CaseStyle = { ...TIGHT_CASE, streaks: 5, glare: 0.85, seed: 5 }

let cv: CV
let index: FingerprintIndex

beforeAll(async () => {
  cv = await loadCv()
  index = decodeFingerprints(
    encodeFingerprints(
      readdirSync(join(DIR, 'cropped')).map((f) => {
        const imageId = Number(f.replace('.jpg', ''))
        return {
          imageId,
          hash: artHash(fingerprintSource(load(join(DIR, 'cropped', f)), artFrames.get(imageId)!))
        }
      })
    )
  )
}, 30_000)

/** Whether found names s's artwork first, close and clear enough to accept. */
function accepted(found: ReturnType<typeof recognizeArt>, s: Shot): boolean {
  const [top, ...rest] = found?.matches ?? []
  const next = rest.find((m) => m.imageId !== top?.imageId)
  return (
    top?.imageId === s.imageId &&
    top.distance <= ART_MAX_DISTANCE &&
    (next?.distance ?? Infinity) - top.distance >= ART_MIN_MARGIN
  )
}

describe('a card in a magnetic one-touch case', () => {
  it('takes the card, not the case round it, for the outline when no artwork is known', () => {
    // Without fingerprints the outline is all there is to read the code and name off. A thick
    // case's rim is the crispest closed outline in view and near enough a card's shape (35/48 of
    // these picked it before cases were told apart).
    let onCard = 0
    let onCase = 0
    for (const s of shots) {
      const { img, outer } = inCase(load(join(DIR, s.file)), s.quad, WIDE_CASE)
      const likeliest = preferOuter(findCandidates(cv, img))!
      if (off(likeliest, s.quad) < 0.01) onCard++
      if (off(likeliest, outer) < 0.01) onCase++
    }
    expect(onCase).toBeLessThanOrEqual(0.15 * shots.length)
    expect(onCard).toBeGreaterThanOrEqual(0.6 * shots.length)
  }, 120_000)

  it('still takes a bare card itself, not a frame printed inside it, for its outline', () => {
    for (const s of shots) {
      const likeliest = preferOuter(findCandidates(cv, load(join(DIR, s.file))))!
      expect(off(likeliest, s.quad), s.file).toBeLessThan(0.01)
    }
  }, 60_000)

  it('accepts the right card through narrow and wide cases', () => {
    for (const style of [TIGHT_CASE, WIDE_CASE]) {
      const misses = shots
        .filter((s) => {
          const { img } = inCase(load(join(DIR, s.file)), s.quad, style)
          return !accepted(recognizeArt(cv, img, index), s)
        })
        .map((s) => s.file)
      expect(shots.length - misses.length, misses.join(', ')).toBeGreaterThanOrEqual(
        0.95 * shots.length
      )
    }
  }, 120_000)

  it('accepts the right card through glare on the case, and never a wrong one', () => {
    let hits = 0
    for (const s of shots) {
      const { img } = inCase(load(join(DIR, s.file)), s.quad, GLARE_CASE)
      const found = recognizeArt(cv, img, index)
      if (accepted(found, s)) hits++
      const [top, ...rest] = found?.matches ?? []
      const next = rest.find((m) => m.imageId !== top?.imageId)
      const wrong =
        top &&
        top.imageId !== s.imageId &&
        top.distance <= ART_MAX_DISTANCE &&
        (next?.distance ?? Infinity) - top.distance >= ART_MIN_MARGIN
      expect(wrong, s.file).toBeFalsy()
    }
    // 38/48 before the art box was jittered, 41/48 after.
    expect(hits).toBeGreaterThanOrEqual(0.82 * shots.length)
  }, 120_000)
})

describe('rankArt with a jittered art box', () => {
  it('matches a card straightened from an outline 3% short', () => {
    // The outline stops 3% short of the card's right and bottom edges, as one running along a
    // case's inner bevel or cut short by glare does.
    const own = { plain: [] as number[], jittered: [] as number[] }
    for (const s of shots) {
      const img = load(join(DIR, s.file))
      const short = [
        cardPoint(s.quad, 0, 0),
        cardPoint(s.quad, 0.97, 0),
        cardPoint(s.quad, 0.97, 0.97),
        cardPoint(s.quad, 0, 0.97)
      ] as const
      const card = warpCard(cv, img, short)
      for (const [way, jitter] of [
        ['plain', 0],
        ['jittered', ART_BOX_JITTER]
      ] as const) {
        const { matches } = rankArt(cv, card, index, undefined, 5, jitter)
        own[way].push(matches.find((m) => m.imageId === s.imageId)?.distance ?? 128)
        if (jitter) expect(matches[0].imageId, s.file).toBe(s.imageId)
      }
    }
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    expect(median(own.jittered)).toBeLessThanOrEqual(median(own.plain) - 10)
    expect(own.jittered.every((d, i) => d <= own.plain[i])).toBe(true)
  }, 120_000)
})
