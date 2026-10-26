// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { artHash } from '../../src/shared/scan/fingerprint'
import {
  decodeFingerprints,
  encodeFingerprints,
  type FingerprintIndex
} from '../../src/shared/scan/fingerprintFile'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import {
  findCard,
  matchArt,
  warpCard,
  type Quad
} from '../../src/renderer/src/features/scan/vision/detect'

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

const { shots } = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { shots: Shot[] }

function load(path: string): RgbaImage {
  return decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
}

const frames = new Map(shots.map((s) => [s.file, load(join(DIR, s.file))]))
const diagonal = Math.hypot(1280, 720)

let cv: CV
let index: FingerprintIndex

beforeAll(async () => {
  cv = await loadCv()
  const thumbs = readdirSync(join(DIR, 'cropped'))
  index = decodeFingerprints(
    encodeFingerprints(
      thumbs.map((f) => ({
        imageId: Number(f.replace('.jpg', '')),
        hash: artHash(load(join(DIR, 'cropped', f)))
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

  it('finds nothing on a blank background', () => {
    const data = new Uint8ClampedArray(1280 * 720 * 4)
    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % 1280
      data[i] = 90 + (x >> 6)
      data[i + 1] = 110
      data[i + 2] = 80
      data[i + 3] = 255
    }
    expect(findCard(cv, { width: 1280, height: 720, data })).toBeNull()
  })
})

describe('matchArt', () => {
  const results = new Map<string, { imageId: number; distance: number }[]>()
  const times: number[] = []

  beforeAll(() => {
    for (const s of shots) {
      const t = performance.now()
      const img = frames.get(s.file)!
      const quad = findCard(cv, img)
      results.set(s.file, quad ? matchArt(cv, warpCard(cv, img, quad), index) : [])
      times.push(performance.now() - t)
    }
  })

  it('names the right artwork first in at least 90% of shots', () => {
    const report = shots.map((s) => {
      const top = results.get(s.file)!
      const own = top.find((r) => r.imageId === s.imageId)
      const rival = top.find((r) => r.imageId !== s.imageId)
      return {
        file: s.file,
        frame: s.frame,
        ok: top[0]?.imageId === s.imageId,
        own: own?.distance,
        rival: rival?.distance
      }
    })
    const hits = report.filter((r) => r.ok).length
    console.log(`matchArt: ${hits}/${shots.length}`)
    console.table(report)
    expect(hits).toBeGreaterThanOrEqual(0.9 * shots.length)
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

describe('warpCard', () => {
  it('straightens the card to 842x1228', () => {
    const s = shots[0]
    const img = frames.get(s.file)!
    const card = warpCard(cv, img, s.quad)
    expect([card.width, card.height]).toEqual([842, 1228])
    expect(card.data.length).toBe(842 * 1228 * 4)
  })
})
