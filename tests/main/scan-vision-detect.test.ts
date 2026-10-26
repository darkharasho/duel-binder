// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import {
  decodeFingerprints,
  encodeFingerprints,
  type FingerprintIndex
} from '../../src/shared/scan/fingerprintFile'
import {
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  ART_MIN_MARGIN
} from '../../src/shared/scan/thresholds'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import {
  findCard,
  matchArt,
  rotate180,
  warpCard,
  type Quad
} from '../../src/renderer/src/features/scan/vision/detect'
import {
  findCandidates,
  recognizeArt
} from '../../src/renderer/src/features/scan/vision/candidates'

// Vitest's CommonJS interop exposes the Emscripten module's own `then` on the import, which
// would make importing it never settle; hand over the plain module instead.
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

const frames = new Map(shots.map((s) => [s.file, load(join(DIR, s.file))]))
const diagonal = Math.hypot(1280, 720)

/** img turned a quarter turn clockwise (or anticlockwise). */
function rotate90(img: RgbaImage, clockwise: boolean): RgbaImage {
  const { width, height, data } = img
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = clockwise ? height - 1 - y : y
      const ny = clockwise ? x : width - 1 - x
      out.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (ny * height + nx) * 4)
    }
  }
  return { width: height, height: width, data: out }
}

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

/** A desk-like background like the fixture generator's: octaves of smooth noise plus grain. */
function emptyFrame(seed: number): RgbaImage {
  const rand = rng(seed)
  const width = 1280
  const height = 720
  const base = [30 + rand() * 120, 30 + rand() * 120, 30 + rand() * 120]
  const field = new Float32Array(width * height)
  for (const [cells, amp] of [
    [4, 40],
    [16, 18],
    [64, 8]
  ]) {
    const gw = cells + 1
    const gh = Math.ceil((cells * height) / width) + 1
    const grid = Array.from({ length: gw * gh }, () => (rand() - 0.5) * 2 * amp)
    for (let y = 0; y < height; y++) {
      const gy = (y / height) * (gh - 1)
      const y0 = Math.floor(gy)
      const fy = gy - y0
      for (let x = 0; x < width; x++) {
        const gx = (x / width) * (gw - 1)
        const x0 = Math.floor(gx)
        const fx = gx - x0
        const at = (i: number, j: number): number =>
          grid[Math.min(gh - 1, j) * gw + Math.min(gw - 1, i)]
        field[y * width + x] +=
          (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
          (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
      }
    }
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < field.length; i++) {
    const grain = (rand() - 0.5) * 12
    for (let c = 0; c < 3; c++) data[i * 4 + c] = base[c] + field[i] + grain
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

/** Top matches for the card found in img, or none when no card is found. */
function scan(img: RgbaImage): { imageId: number; distance: number }[] | null {
  const quad = findCard(cv, img)
  return quad && matchArt(cv, warpCard(cv, img, quad), index)
}

let cv: CV
let index: FingerprintIndex

beforeAll(async () => {
  cv = await loadCv()
  const thumbs = readdirSync(join(DIR, 'cropped'))
  index = decodeFingerprints(
    encodeFingerprints(
      thumbs.map((f) => ({
        imageId: Number(f.replace('.jpg', '')),
        hash: artHash(
          fingerprintSource(
            load(join(DIR, 'cropped', f)),
            artFrames.get(Number(f.replace('.jpg', '')))!
          )
        )
      }))
    )
  )
}, 30_000)

describe('findCard', () => {
  it('finds the card corners in at least 90% of shots', () => {
    const misses: string[] = []
    for (const s of shots) {
      const quad = findCard(cv, frames.get(s.file)!)
      const worst = quad
        ? Math.max(...quad.map((p, i) => Math.hypot(p[0] - s.quad[i][0], p[1] - s.quad[i][1])))
        : Infinity
      if (worst > 0.04 * diagonal) misses.push(`${s.file}: ${quad ? worst.toFixed(1) : 'none'}`)
    }
    console.log(`findCard: ${shots.length - misses.length}/${shots.length}`, misses)
    expect(shots.length - misses.length).toBeGreaterThanOrEqual(0.9 * shots.length)
  })

  it('finds nothing on an empty textured background', () => {
    for (let seed = 1; seed <= 5; seed++)
      expect(findCard(cv, emptyFrame(seed)), `seed ${seed}`).toBeNull()
  })

  it('finds and matches cards held sideways or upside down', () => {
    const turns: [string, (img: RgbaImage) => RgbaImage][] = [
      ['clockwise', (img) => rotate90(img, true)],
      ['anticlockwise', (img) => rotate90(img, false)],
      ['upside down', rotate180]
    ]
    for (const [name, turn] of turns) {
      const misses = shots
        .filter((s) => scan(turn(frames.get(s.file)!))?.[0]?.imageId !== s.imageId)
        .map((s) => s.file)
      expect(shots.length - misses.length, `${name}: ${misses.join(', ')}`).toBeGreaterThanOrEqual(
        0.9 * shots.length
      )
    }
  }, 60_000)
})

describe('matchArt', () => {
  const results = new Map<string, { imageId: number; distance: number }[]>()
  const times: number[] = []

  beforeAll(() => {
    for (const s of shots) {
      const t = performance.now()
      results.set(s.file, scan(frames.get(s.file)!) ?? [])
      times.push(performance.now() - t)
    }
  })

  const report = (): {
    file: string
    frame: string
    ok: boolean
    own?: number
    second?: number
  }[] =>
    shots.map((s) => {
      const top = results.get(s.file)!
      return {
        file: s.file,
        frame: s.frame,
        ok: top[0]?.imageId === s.imageId,
        own: top.find((r) => r.imageId === s.imageId)?.distance,
        second: top[1]?.distance
      }
    })

  it('names the right artwork first in at least 90% of shots', () => {
    const rows = report()
    const hits = rows.filter((r) => r.ok).length
    if (hits < 0.9 * shots.length) console.table(rows)
    expect(hits).toBeGreaterThanOrEqual(0.9 * shots.length)
  })

  it('clears the confidence thresholds on right matches', () => {
    const right = report().filter((r) => r.ok)
    const confident = right.filter(
      (r) => r.own! <= ART_MAX_DISTANCE_IN_SET && r.second! - r.own! >= ART_MIN_MARGIN
    )
    const tooFar = right.filter((r) => r.own! > ART_MAX_DISTANCE)
    if (confident.length < 0.9 * shots.length || tooFar.length) console.table(right)
    expect(confident.length).toBeGreaterThanOrEqual(0.9 * shots.length)
    expect(tooFar).toEqual([])
  })

  it('tells Dark Magician from its alternate art', () => {
    for (const s of shots.filter((x) => x.imageId === 46986414 || x.imageId === 46986415))
      expect(results.get(s.file)![0]?.imageId, s.file).toBe(s.imageId)
  })

  it('keeps detection, straightening and matching under 400 ms', () => {
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]
    console.log(`findCard + warpCard + matchArt median ${median.toFixed(1)} ms`)
    expect(median).toBeLessThan(400)
  })

  it('limits matches to the candidate images', () => {
    const s = shots[0]
    const img = frames.get(s.file)!
    const card = warpCard(cv, img, findCard(cv, img)!)
    const candidates = new Set([46986415, 89631139])
    const top = matchArt(cv, card, index, candidates)
    expect(top.length).toBeGreaterThan(0)
    expect(top.every((r) => candidates.has(r.imageId))).toBe(true)
  })
})

describe('recognizeArt', () => {
  /** Mean absolute difference of two same-sized images' pixels. */
  const difference = (a: RgbaImage, b: RgbaImage): number => {
    let sum = 0
    for (let i = 0; i < a.data.length; i += 4)
      for (let c = 0; c < 3; c++) sum += Math.abs(a.data[i + c] - b.data[i + c])
    return sum / (a.data.length * 0.75)
  }

  it('names the right artwork first in at least 90% of shots, held any way round', () => {
    const turns: [string, (img: RgbaImage) => RgbaImage][] = [
      ['upright', (img) => img],
      ['clockwise', (img) => rotate90(img, true)],
      ['upside down', rotate180]
    ]
    const times: number[] = []
    for (const [name, turn] of turns) {
      const misses = shots
        .filter((s) => {
          const img = turn(frames.get(s.file)!)
          const t = performance.now()
          const found = recognizeArt(cv, img, index)
          times.push(performance.now() - t)
          return found?.matches[0]?.imageId !== s.imageId
        })
        .map((s) => s.file)
      expect(shots.length - misses.length, `${name}: ${misses.join(', ')}`).toBeGreaterThanOrEqual(
        0.9 * shots.length
      )
    }
    const median = [...times].sort((a, b) => a - b)[times.length >> 1]
    console.log(`recognizeArt median ${median.toFixed(1)} ms`)
    expect(median).toBeLessThan(400)
  }, 120_000)

  it('returns the straightened card upright', () => {
    for (const s of shots.slice(0, 12)) {
      const upright = warpCard(cv, frames.get(s.file)!, s.quad)
      for (const img of [frames.get(s.file)!, rotate180(frames.get(s.file)!)]) {
        const { card } = recognizeArt(cv, img, index)!
        expect([card.width, card.height]).toEqual([842, 1228])
        expect(difference(card, upright), s.file).toBeLessThan(difference(rotate180(card), upright))
      }
    }
  }, 60_000)

  it('limits matches to the candidate images', () => {
    const candidates = new Set([46986415, 89631139])
    const found = recognizeArt(cv, frames.get(shots[0].file)!, index, candidates)!
    expect(found.matches.length).toBeGreaterThan(0)
    expect(found.matches.every((r) => candidates.has(r.imageId))).toBe(true)
  })

  it('finds no card on an empty textured background', () => {
    for (let seed = 1; seed <= 5; seed++) {
      expect(findCandidates(cv, emptyFrame(seed)), `seed ${seed}`).toEqual([])
      expect(recognizeArt(cv, emptyFrame(seed), index), `seed ${seed}`).toBeNull()
    }
  })
})

describe('warpCard', () => {
  it('straightens the card to 842x1228', () => {
    const s = shots[0]
    const img = frames.get(s.file)!
    const card = warpCard(cv, img, s.quad)
    expect([card.width, card.height]).toEqual([842, 1228])
    expect(card.data.length).toBe(842 * 1228 * 4)
  })
})
