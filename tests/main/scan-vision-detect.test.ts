// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { artHash, fingerprintSource, hamming } from '../../src/shared/scan/fingerprint'
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
import { scanProfile } from '../../src/shared/scan/profiles'
import type { RgbaImage } from '../../src/shared/scan/types'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { windowArtBoxes } from '../../src/renderer/src/features/scan/vision/artWindow'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import {
  CARD_H,
  CARD_W,
  findCard,
  matchArt,
  rotate180,
  toMat,
  warpCard,
  type Point,
  type Quad
} from '../../src/renderer/src/features/scan/vision/detect'
import { ART_BOXES, crop, type Box } from '../../src/renderer/src/features/scan/vision/regions'
import {
  findCandidates,
  preferOuter,
  recognizeArt
} from '../../src/renderer/src/features/scan/vision/candidates'

// Vitest's CommonJS interop exposes the Emscripten module's own `then` on the import, which
// would make importing it never settle; hand over the plain module instead.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

const DIR = 'tests/fixtures/scan'
const PKM_DIR = 'tests/fixtures/scan-pkm/full'

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

/**
 * A black-framed (Xyz) card on a dark desk, turned by angle radians, with its art and a light
 * text box under it: the card's own edge barely shows, while the art and text boxes stand out.
 * quad is the card's outline in the frame.
 */
function blackFrameShot(art: RgbaImage, angle: number): { img: RgbaImage; quad: Quad } {
  const rand = rng(7)
  const width = 1280
  const height = 720
  const cardH = 560
  const cardW = (cardH * 59) / 86
  const [cx, cy] = [640, 360]
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  const toFrame = (u: number, v: number): Point => [
    cx + (u - 0.5) * cardW * cos - (v - 0.5) * cardH * sin,
    cy + (u - 0.5) * cardW * sin + (v - 0.5) * cardH * cos
  ]
  const [ax0, ay0, ax1, ay1] = ART_BOXES.normal
  // The text box spans the art window's width, from just under it to near the card's bottom.
  const text = [ax0, 0.74, ax1, 0.95]
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Card coordinates of this pixel.
      const dx = x - cx
      const dy = y - cy
      const u = (dx * cos + dy * sin) / cardW + 0.5
      const v = (-dx * sin + dy * cos) / cardH + 0.5
      const i = (y * width + x) * 4
      const grain = (rand() - 0.5) * 8
      let rgb = [22 + grain, 20 + grain, 24 + grain]
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        rgb = [34 + grain, 32 + grain, 36 + grain]
        if (u >= ax0 && u < ax1 && v >= ay0 && v < ay1) {
          const px = Math.floor(((u - ax0) / (ax1 - ax0)) * art.width)
          const py = Math.floor(((v - ay0) / (ay1 - ay0)) * art.height)
          const j = (py * art.width + px) * 4
          rgb = [art.data[j], art.data[j + 1], art.data[j + 2]]
        } else if (u >= text[0] && u < text[2] && v >= text[1] && v < text[3]) {
          rgb = [214 + grain, 210 + grain, 200 + grain]
        }
      }
      data.set([...rgb, 255], i)
    }
  }
  return {
    img: { width, height, data },
    quad: [toFrame(0, 0), toFrame(1, 0), toFrame(1, 1), toFrame(0, 1)]
  }
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

  it('takes no outline with a card aspect ratio that is far from a rectangle', () => {
    // As a magnetic case's edge and the card's text box made one in a real photo: two upright
    // sides, one of them short, joined by a level side and a long slanted one.
    const width = 1280
    const height = 720
    const data = new Uint8ClampedArray(width * height * 4)
    const inside = (x: number, y: number): boolean =>
      x >= 420 && x <= 700 && y <= 600 && y >= 520 - ((x - 420) * 370) / 280
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = inside(x, y) ? 220 : 40
        data.set([v, v, v, 255], (y * width + x) * 4)
      }
    expect(findCard(cv, { width, height, data })).toBeNull()
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

  it('finds a black-framed card whose own edge barely shows against a dark desk', () => {
    const imageId = 46986414
    const art = load(join(DIR, 'cropped', `${imageId}.jpg`))
    for (const angle of [0.05, Math.PI + 0.05]) {
      const { img, quad } = blackFrameShot(art, angle)
      const found = recognizeArt(cv, img, index)!
      expect(found.matches[0].imageId, `angle ${angle}`).toBe(imageId)
      expect(found.matches[0].distance, `angle ${angle}`).toBeLessThanOrEqual(ART_MAX_DISTANCE)
      // The card's outline, either way round, rather than its art and text boxes.
      const off = (q: readonly Point[]): number =>
        Math.max(...found.quad.map((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1])))
      const turned = [quad[2], quad[3], quad[0], quad[1]]
      expect(Math.min(off(quad), off(turned)), `angle ${angle}`).toBeLessThan(0.03 * diagonal)
    }
  })

  it('gives the likeliest outline, either way up, when no artwork is close enough', () => {
    // An artwork missing from the fingerprints, as a new alternate art is: the closest match
    // says nothing of where the card is or which way up.
    const other = distractors[0].imageId
    for (const s of shots.slice(0, 4)) {
      const img = frames.get(s.file)!
      const found = recognizeArt(cv, img, index, new Set([other]))!
      expect(found.matches[0].distance, s.file).toBeGreaterThan(ART_MAX_DISTANCE)
      expect(found.upsideDown, s.file).toBeNull()
      const outline = preferOuter(findCandidates(cv, img))!
      expect(found.quad, s.file).toEqual(outline)
      expect(difference(found.card, warpCard(cv, img, outline)), s.file).toBe(0)
    }
  })

  it('finds no card on an empty textured background', () => {
    for (let seed = 1; seed <= 5; seed++) {
      expect(findCandidates(cv, emptyFrame(seed)), `seed ${seed}`).toEqual([])
      expect(recognizeArt(cv, emptyFrame(seed), index), `seed ${seed}`).toBeNull()
    }
  })
})

describe('a frame already in OpenCV', () => {
  /** img at twice its size: a 4K camera's frame, where one leaked copy shows in the heap. */
  const doubled = (img: RgbaImage): RgbaImage => {
    const width = img.width * 2
    const height = img.height * 2
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        data.set(
          img.data.subarray(
            ((y >> 1) * img.width + (x >> 1)) * 4,
            ((y >> 1) * img.width + (x >> 1)) * 4 + 4
          ),
          (y * width + x) * 4
        )
    return { width, height, data }
  }

  it('gives the same results as its pixels, and is left for the caller to free', () => {
    const s = shots[0]
    const img = frames.get(s.file)!
    const mat = toMat(cv, img)
    try {
      expect(findCandidates(cv, mat)).toEqual(findCandidates(cv, img))
      expect(warpCard(cv, mat, s.quad)).toEqual(warpCard(cv, img, s.quad))
      expect(recognizeArt(cv, mat, index)).toEqual(recognizeArt(cv, img, index))
      expect(mat.isDeleted()).toBe(false)
    } finally {
      mat.delete()
    }
  }, 60_000)

  it('leaves nothing behind in the OpenCV heap, from pixels or a Mat', () => {
    const img = doubled(frames.get(shots[0].file)!)
    const empty = doubled(emptyFrame(1))
    const round = (): void => {
      for (const frame of [img, empty]) {
        recognizeArt(cv, frame, index)
        const mat = toMat(cv, frame)
        try {
          recognizeArt(cv, mat, index)
          findCandidates(cv, mat)
          warpCard(cv, mat, shots[0].quad, 1684)
        } finally {
          mat.delete()
        }
      }
    }
    // The WASM heap only ever grows, so its size shows whether anything was kept.
    const heapSize = (): number => (cv as unknown as { HEAPU8: Uint8Array }).HEAPU8.length
    round()
    const heap = heapSize()
    // A frame here is 14.7 MB: one copy kept per round would outgrow any slack within a few.
    for (let i = 0; i < 12; i++) round()
    expect(heapSize()).toBe(heap)
  }, 120_000)
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

describe('the Pokémon profile', () => {
  const pkm = scanProfile('pkm')
  // TCGdex's en/sv03-045 (Lapras, Obsidian Flames), a full-card reference image.
  const PKM_IMAGE = 3948443432832600
  const reference = (): RgbaImage => load(join(PKM_DIR, `${PKM_IMAGE}.jpg`))

  /** img stretched to width x height, as warpCard leaves a card. */
  const resized = (img: RgbaImage, width: number, height: number): RgbaImage => {
    const src = toMat(cv, img)
    const out = new cv.Mat()
    try {
      cv.resize(src, out, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR)
      return { width, height, data: new Uint8ClampedArray(out.data) }
    } finally {
      src.delete()
      out.delete()
    }
  }

  /** The card at height px tall in the middle of an empty 1280x720 frame, and its corners. */
  const framed = (card: RgbaImage, height: number): { img: RgbaImage; quad: Quad } => {
    const width = Math.round((height * card.width) / card.height)
    const small = resized(card, width, height)
    const img = emptyFrame(3)
    const [x0, y0] = [Math.round((1280 - width) / 2), Math.round((720 - height) / 2)]
    for (let y = 0; y < height; y++)
      img.data.set(
        small.data.subarray(y * width * 4, (y + 1) * width * 4),
        ((y0 + y) * 1280 + x0) * 4
      )
    const quad: Quad = [
      [x0, y0],
      [x0 + width, y0],
      [x0 + width, y0 + height],
      [x0, y0 + height]
    ]
    return { img, quad }
  }

  it('pkm art box crops the reference and the warped card alike', () => {
    const img = reference()
    const stored = artHash(fingerprintSource(img, 'pokemon', pkm))
    const seen = artHash(crop(resized(img, CARD_W, CARD_H), pkm.artBoxes[0]))
    expect(hamming(stored, 0, seen, 0)).toBeLessThanOrEqual(20)
  })

  it('places the pkm art box on the art window of a card straightened by its inner frame', () => {
    const stored = artHash(fingerprintSource(reference(), 'pokemon', pkm))
    const distance = (card: RgbaImage, box: Box): number =>
      hamming(stored, 0, artHash(crop(card, box)), 0)
    const card = resized(reference(), CARD_W, CARD_H)
    // A card held over a deck is often found by the inner edge of its border, a few percent in,
    // with the deck's card edge below: straightened from there, the art box is that far off and
    // the hash says nothing.
    const inner = resized(crop(card, [0.037, 0.04, 0.963, 0.985]), CARD_W, CARD_H)
    expect(distance(inner, pkm.artBoxes[0])).toBeGreaterThan(ART_MAX_DISTANCE)
    const found = (img: RgbaImage): number =>
      Math.min(...windowArtBoxes(img, pkm).map((b) => distance(img, b)))
    expect(found(inner)).toBeLessThanOrEqual(30)
    // A card straightened by its own outline still matches where it is.
    expect(found(card)).toBeLessThanOrEqual(20)
    // Found by the line under its header, the name lost under a deck's edge: the window sits
    // further off than the near search reaches.
    const headless = resized(crop(card, [0, 0.07, 1, 1]), CARD_W, CARD_H)
    expect(found(headless)).toBeLessThanOrEqual(30)
  })

  it('finds a Pokémon card whose outline is lost, around its art window', () => {
    const pkmIndex = decodeFingerprints(
      encodeFingerprints([
        { imageId: PKM_IMAGE, hash: artHash(fingerprintSource(reference(), 'pokemon', pkm)) }
      ])
    )
    const { img, quad } = framed(reference(), 600)
    // Everything of the card but its art window is the desk again, as a held card's frame is
    // lost under fingers, a sleeve or a holder's rim while its art window's border stays crisp.
    const desk = emptyFrame(3)
    const [[x0, y0], [x1, , ], [, y1]] = quad
    const [wx0, wy0, wx1, wy1] = pkm.windows[0]
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const u = (x - x0) / (x1 - x0)
        const v = (y - y0) / (y1 - y0)
        if (u >= wx0 && u <= wx1 && v >= wy0 && v <= wy1) continue
        const i = (y * 1280 + x) * 4
        img.data.set(desk.data.subarray(i, i + 4), i)
      }
    const found = recognizeArt(cv, img, pkmIndex, undefined, undefined, pkm)
    expect(found?.matches[0]?.imageId).toBe(PKM_IMAGE)
    expect(found!.matches[0].distance).toBeLessThanOrEqual(ART_MAX_DISTANCE)
    // The card's own corners, not the window's.
    for (let i = 0; i < 4; i++) {
      const [x, y] = found!.quad[i]
      expect(Math.min(...quad.map(([qx, qy]) => Math.hypot(qx - x, qy - y)))).toBeLessThan(25)
    }
  }, 60_000)

  it('a Yu-Gi-Oh reference is left as it was', () => {
    const img = load(join(DIR, 'cropped', readdirSync(join(DIR, 'cropped'))[0]))
    expect(fingerprintSource(img, 'effect')).toBe(img)
  })

  it('matches a Pokémon card in a frame by its art, without the Yu-Gi-Oh rarity look', () => {
    const pkmIndex = decodeFingerprints(
      encodeFingerprints([
        { imageId: PKM_IMAGE, hash: artHash(fingerprintSource(reference(), 'pokemon', pkm)) }
      ])
    )
    const { img } = framed(reference(), 600)
    const signals = analyze(cv, img, pkmIndex, null, true, true, pkm)
    expect(signals.found).toBe(true)
    expect(signals.art[0]).toEqual({ imageId: PKM_IMAGE, distance: expect.any(Number) })
    expect(signals.art[0].distance).toBeLessThanOrEqual(ART_MAX_DISTANCE)
    expect(signals.cues).toBeNull()
    expect(signals.look).toBeNull()
    expect(signals.nameBands.length).toBeGreaterThan(0)
    expect(signals.codeBands.length).toBeGreaterThan(0)
  }, 30_000)
})
