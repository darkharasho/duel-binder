/**
 * Replays the Contribute screen's One Piece number reader (step 3b) on photos and reports how
 * often it reads the card's number, how often it reads a wrong one, and what it costs a frame:
 *
 *   npm run scan:op-replay -- --real ~/scan-capture
 *       The testers' photos as `npm run scan:pull-training` lays them out: <dir>/op-truth.json
 *       and <dir>/shots-op/<clientId>.jpg. Each photo is one still, read as the app reads a live
 *       frame (the same centre crop, analyze() with the op profile, tesseract, frameNumber).
 *
 *   npm run scan:op-replay -- --cards /tmp/op-cards [--backgrounds ~/scan-capture/shots-pkm]
 *       Synthetic frames: Bandai card renders (<number>[_pN].png) laid into camera frames at
 *       40-70% of the frame's height, turned, tilted, blurred, noisy, dimmed or brightened, some
 *       with a thumb over an edge or a glare spot, on the background photos when given (read
 *       only) or a plain desk. Each pose is shot as --frames consecutive frames (small shake,
 *       fresh noise), which go through the 2-in-a-row gate and the catalog check as in the app.
 *
 * Options: --poses N (per card and size, default 4), --frames N (default 4), --heights 1080,2160
 * (the app frame's height: a 1080p camera's centre crop, and a 4K one's), --catalog <file> (the
 * catalog's numbers, one a line; default a stand-in of every number in Bandai's sets so far),
 * --band x0,y0,x1,y1[;…] (try other number bands), --reach r (their codeReach), --gray on|off, --need N (tries in a row, default 2),
 * --seed N, --save <dir> (writes each synthetic frame as a JPEG, to look at).
 *
 * A wrong read is a number in the right format that isn't the card's. "Gated wrong" is one the
 * app would offer: it read twice running and is in the catalog.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { createOcr } from '../../src/main/scan/ocr'
import { createNumberGate, frameNumber } from '../../src/shared/scan/onePieceNumber'
import { scanProfile, type Box, type ScanProfile } from '../../src/shared/scan/profiles'
import { crop } from '../../src/shared/scan/regions'
import type { RgbaImage } from '../../src/shared/scan/types'
import { centreCrop } from '../../src/renderer/src/features/scan/crop'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { warpCard } from '../../src/renderer/src/features/scan/vision/detect'

// ---- Options ----

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const home = (p: string): string => p.replace(/^~(?=$|\/)/, homedir())
const numberOption = (name: string, fallback: number): number => {
  const v = option(name)
  return v === undefined ? fallback : Number(v)
}

// ---- A stand-in catalog ----

/**
 * Every number Bandai's English sets have printed so far, roughly: boosters OP01-OP14 to 121,
 * starter decks ST01-ST29 to 017, extra boosters EB01-EB04 to 061, premium boosters PRB01-PRB02
 * to 150 and promos P-001 to P-120. Close enough for the catalog check on synthetic frames; pass
 * --catalog with the real list for real photos.
 */
export function standInCatalog(): string[] {
  const out: string[] = []
  const run = (code: string, n: number): void => {
    for (let i = 1; i <= n; i++) out.push(`${code}-${String(i).padStart(3, '0')}`)
  }
  const two = (i: number): string => String(i).padStart(2, '0')
  for (let s = 1; s <= 14; s++) run(`OP${two(s)}`, 121)
  for (let s = 1; s <= 29; s++) run(`ST${two(s)}`, 17)
  for (let s = 1; s <= 4; s++) run(`EB${two(s)}`, 61)
  for (let s = 1; s <= 2; s++) run(`PRB${two(s)}`, 150)
  run('P', 120)
  return out
}

/** The set codes of a list of numbers, as `scan:numberPrefixes` gives them ("OP05", "P"). */
export const prefixesOf = (numbers: readonly string[]): string[] =>
  [...new Set(numbers.map((n) => n.slice(0, n.lastIndexOf('-'))))].sort()

// ---- Images ----

function loadImage(path: string): RgbaImage {
  const bytes = readFileSync(path)
  if (bytes[0] === 0x89) {
    const png = PNG.sync.read(bytes)
    return { width: png.width, height: png.height, data: png.data }
  }
  return jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
}

/** The part of a frame the app reads: useScanLoop's (and the Contribute reader's) centre crop. */
function appFrame(img: RgbaImage): RgbaImage {
  const { x, y, width, height } = centreCrop(img.width, img.height)
  return crop(img, [
    x / img.width,
    y / img.height,
    (x + width) / img.width,
    (y + height) / img.height
  ])
}

/** A small, seeded random number generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Pose {
  /** Card height over the frame's. */
  scale: number
  cx: number
  cy: number
  /** Turn, radians. */
  angle: number
  /** Each corner's offset, as shares of the card's width: the perspective of a tilted card. */
  tilt: [number, number][]
  blur: number
  gain: number
  offset: number
  noise: number
  thumb: 'left' | 'right' | null
  glare: [number, number] | null
  background: number
}

/** A random pose; `mild` is a steady hand in good light (for telling the cutter from the camera). */
function randomPose(rnd: () => number, mild: boolean): Pose {
  const u = (a: number, b: number): number => a + (b - a) * rnd()
  const t = u(0, mild ? 0.02 : 0.06)
  const pose: Pose = {
    scale: u(0.4, 0.7),
    cx: u(0.42, 0.58),
    cy: u(0.42, 0.58),
    angle: u(-0.2, 0.2) * (mild ? 0.3 : 1),
    tilt: [0, 1, 2, 3].map(() => [u(-t, t), u(-t, t)] as [number, number]),
    blur: u(0, mild ? 0.5 : 1.4),
    gain: mild ? 1 : u(0.65, 1.2),
    offset: mild ? 0 : u(-15, 15),
    noise: mild ? 1 : u(2, 6),
    thumb: rnd() < 0.5 ? (rnd() < 0.5 ? 'left' : 'right') : null,
    glare: rnd() < 0.2 ? [u(0.1, 0.9), u(0.1, 0.9)] : null,
    background: Math.floor(rnd() * 1e9)
  }
  return mild ? { ...pose, thumb: null, glare: null } : pose
}

/** The pose a moment later: a little shake and fresh noise. */
function shaken(p: Pose, rnd: () => number): Pose {
  const u = (a: number, b: number): number => a + (b - a) * rnd()
  return {
    ...p,
    cx: p.cx + u(-0.004, 0.004),
    cy: p.cy + u(-0.004, 0.004),
    angle: p.angle + u(-0.006, 0.006),
    blur: Math.max(0, p.blur + u(-0.3, 0.3))
  }
}

/** A desk-coloured frame, or a background photo's centre crop, at width x height. */
function background(
  cv: CV,
  width: number,
  height: number,
  photos: string[],
  pick: number
): RgbaImage {
  if (photos.length) {
    const photo = appFrame(loadImage(photos[pick % photos.length]))
    const src = new cv.Mat(photo.height, photo.width, cv.CV_8UC4)
    const dst = new cv.Mat()
    try {
      src.data.set(photo.data)
      cv.resize(src, dst, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR)
      return { width, height, data: new Uint8ClampedArray(dst.data) }
    } finally {
      src.delete()
      dst.delete()
    }
  }
  const rnd = random(pick)
  const base = [40 + rnd() * 120, 40 + rnd() * 100, 40 + rnd() * 90]
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const shade = 0.8 + (0.3 * (x + y)) / (width + height)
      const i = (y * width + x) * 4
      data[i] = base[0] * shade
      data[i + 1] = base[1] * shade
      data[i + 2] = base[2] * shade
      data[i + 3] = 255
    }
  return { width, height, data }
}

/** The card laid into a frame of the given height (3:4, as the app's crop) at pose. */
function render(
  cv: CV,
  card: RgbaImage,
  pose: Pose,
  height: number,
  photos: string[],
  rnd: () => number
): { img: RgbaImage; corners: number[][] } {
  const width = Math.round(height * 0.75)
  const bg = background(cv, width, height, photos, pose.background)
  const ch = pose.scale * height
  const cw = (ch * 63) / 88
  const cos = Math.cos(pose.angle)
  const sin = Math.sin(pose.angle)
  const corners = [
    [-cw / 2, -ch / 2],
    [cw / 2, -ch / 2],
    [cw / 2, ch / 2],
    [-cw / 2, ch / 2]
  ].map(([x, y], i) => {
    const tx = x + pose.tilt[i][0] * cw
    const ty = y + pose.tilt[i][1] * cw
    return [pose.cx * width + tx * cos - ty * sin, pose.cy * height + tx * sin + ty * cos]
  })
  const src = new cv.Mat(card.height, card.width, cv.CV_8UC4)
  const warped = new cv.Mat()
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    card.width,
    0,
    card.width,
    card.height,
    0,
    card.height
  ])
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat())
  const m = cv.getPerspectiveTransform(from, to)
  const out = new Uint8ClampedArray(bg.data)
  try {
    src.data.set(card.data)
    cv.warpPerspective(
      src,
      warped,
      m,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(0, 0, 0, 0)
    )
    const w = warped.data
    for (let i = 0; i < width * height; i++) {
      const a = w[i * 4 + 3] / 255
      if (!a) continue
      for (let c = 0; c < 3; c++) out[i * 4 + c] = w[i * 4 + c] * a + out[i * 4 + c] * (1 - a)
    }
  } finally {
    for (const mat of [src, warped, from, to, m]) mat.delete()
  }
  // A thumb over the middle of a long side.
  if (pose.thumb) {
    const [a, b] = pose.thumb === 'left' ? [corners[0], corners[3]] : [corners[1], corners[2]]
    const tx = (a[0] + b[0]) / 2
    const ty = (a[1] + b[1]) / 2 + ch * 0.1
    const rx = cw * 0.13
    const ry = ch * 0.1
    for (let y = Math.floor(ty - ry); y <= ty + ry; y++)
      for (let x = Math.floor(tx - rx); x <= tx + rx; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if (((x - tx) / rx) ** 2 + ((y - ty) / ry) ** 2 > 1) continue
        const i = (y * width + x) * 4
        out[i] = 205
        out[i + 1] = 150
        out[i + 2] = 125
      }
  }
  // A soft glare spot somewhere on the card.
  if (pose.glare) {
    const [gx, gy] = pose.glare
    const x0 = corners[0][0] + (corners[1][0] - corners[0][0]) * gx
    const y0 = corners[0][1] + (corners[3][1] - corners[0][1]) * gy
    const r = cw * 0.18
    for (let y = Math.floor(y0 - r); y <= y0 + r; y++)
      for (let x = Math.floor(x0 - r); x <= x0 + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const d = Math.hypot(x - x0, y - y0) / r
        if (d > 1) continue
        const k = 0.75 * (1 - d * d)
        const i = (y * width + x) * 4
        for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - k) + 255 * k
      }
  }
  // Blur, then light and sensor noise.
  const mat = new cv.Mat(height, width, cv.CV_8UC4)
  try {
    mat.data.set(out)
    // Softness grows with the frame, but slower: a 4K phone camera resolves more than 1080p, if
    // not twice as much.
    const sigma = pose.blur * Math.sqrt(height / 1080)
    if (sigma > 0.2) cv.GaussianBlur(mat, mat, new cv.Size(0, 0), sigma, sigma)
    const d = mat.data
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) {
        // A rough normal sample: the sum of three uniforms.
        const n = (rnd() + rnd() + rnd() - 1.5) * 2 * pose.noise
        out[i * 4 + c] = d[i * 4 + c] * pose.gain + pose.offset + n
      }
      out[i * 4 + 3] = 255
    }
  } finally {
    mat.delete()
  }
  return { img: { width, height, data: out }, corners }
}

/**
 * Whether a found outline is the card's: each corner within 3% of the card's height of the true
 * one, whichever corner it starts from.
 */
function outlineRight(quad: readonly (readonly number[])[] | null, corners: number[][]): boolean {
  if (!quad) return false
  const size = Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1])
  for (const order of [quad, [...quad].reverse()])
    for (let k = 0; k < 4; k++) {
      const worst = Math.max(
        ...corners.map((c, i) => {
          const q = order[(i + k) % 4]
          return Math.hypot(q[0] - c[0], q[1] - c[1])
        })
      )
      if (worst <= 0.03 * size) return true
    }
  return false
}

// ---- Reading ----

interface Read {
  number: string | null
  quad: readonly (readonly number[])[] | null
  texts: string[]
  visionMs: number
  ocrMs: number
}

type ReadFrame = (img: RgbaImage) => Promise<Read>

let debugFrame = 0

async function reader(
  cv: CV,
  profile: ScanProfile,
  prefixes: string[]
): Promise<{
  read: ReadFrame
  dispose(): Promise<void>
}> {
  const ocr = createOcr()
  // Starts tesseract before the first timed frame.
  await ocr.read([{ width: 8, height: 8, data: new Uint8Array(64).fill(255) }], 'code')
  return {
    async read(img) {
      const t0 = performance.now()
      const signals = analyze(cv, img, null, null, true, false, profile)
      const t1 = performance.now()
      const texts = signals.codeBands.length ? await ocr.read(signals.codeBands, 'code') : []
      const t2 = performance.now()
      if (process.argv.includes('--debug')) {
        const quad = signals.quad?.map((p) => p.map(Math.round).join(',')).join(' ')
        console.log(`  found ${signals.found} quad ${quad} texts ${JSON.stringify(texts)}`)
        const save = option('save')
        if (save)
          signals.codeBands.forEach((b, i) => {
            const png = new PNG({ width: b.width, height: b.height })
            for (let p = 0; p < b.width * b.height; p++) {
              png.data.set([b.data[p], b.data[p], b.data[p], 255], p * 4)
            }
            writeFileSync(join(home(save), `band_${debugFrame}_${i}.png`), PNG.sync.write(png))
          })
        if (save && signals.quad) {
          // The straightened card's bottom right, as the band cutter sees it.
          const card = warpCard(cv, img, signals.quad, 842)
          const corner = crop(card, [0.6, 0.9, 1, 1])
          const png = new PNG({ width: corner.width, height: corner.height })
          png.data.set(corner.data)
          writeFileSync(join(home(save), `corner_${debugFrame}.png`), PNG.sync.write(png))
        }
        debugFrame++
      }
      return {
        number: frameNumber(texts, prefixes),
        quad: signals.quad,
        texts,
        visionMs: t1 - t0,
        ocrMs: t2 - t1
      }
    },
    dispose: () => ocr.dispose()
  }
}

// ---- Report ----

interface Tally {
  frames: number
  read: number
  wrong: number
  /** Wrong reads that are in the catalog. */
  wrongInCatalog: number
  /** Gated: sequences (or stills) that offered the right number, a wrong one, or none. */
  sequences: number
  offeredRight: number
  offeredWrong: number
  visionMs: number[]
  ocrMs: number[]
  /** Synthetic frames whose outline was found right. */
  outlines: number
}

const tally = (): Tally => ({
  frames: 0,
  read: 0,
  wrong: 0,
  wrongInCatalog: 0,
  sequences: 0,
  offeredRight: 0,
  offeredWrong: 0,
  visionMs: [],
  ocrMs: [],
  outlines: 0
})

const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(1)}%)`
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0
const p90 = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] ?? 0

function report(groups: Map<string, Tally>, gated: boolean): void {
  console.table(
    Object.fromEntries(
      [...groups].map(([key, t]) => [
        key,
        {
          ...(gated ? { 'outline right': pct(t.outlines, t.frames) } : {}),
          'frames read right': pct(t.read, t.frames),
          'frames wrong': t.wrong,
          'wrong, in catalog': t.wrongInCatalog,
          ...(gated
            ? {
                'cards offered right': pct(t.offeredRight, t.sequences),
                'offered wrong': t.offeredWrong
              }
            : {}),
          'vision ms (median/p90)': `${median(t.visionMs).toFixed(0)}/${p90(t.visionMs).toFixed(0)}`,
          'OCR ms (median/p90)': `${median(t.ocrMs).toFixed(0)}/${p90(t.ocrMs).toFixed(0)}`
        }
      ])
    )
  )
}

function count(groups: Map<string, Tally>, keys: string[], f: (t: Tally) => void): void {
  for (const k of keys) {
    if (!groups.has(k)) groups.set(k, tally())
    f(groups.get(k)!)
  }
}

/** The number a Bandai render shows, from its file name ("OP05-119_p1.png" is OP05-119). */
const numberOfFile = (file: string): string => basename(file).replace(/(_p\d+)?\.\w+$/, '')

async function synthetic(
  cv: CV,
  read: ReadFrame,
  catalog: ReadonlySet<string>,
  need: number
): Promise<void> {
  const dir = home(option('cards')!)
  const files = readdirSync(dir)
    .filter((n) => /\.png$/i.test(n))
    .sort()
  const bgDir = option('backgrounds')
  const photos = bgDir
    ? readdirSync(home(bgDir))
        .filter((n) => /\.jpe?g$/i.test(n))
        .sort()
        .map((n) => join(home(bgDir), n))
    : []
  const poses = numberOption('poses', 4)
  const frames = numberOption('frames', 4)
  const heights = (option('heights') ?? '1080,2160').split(',').map(Number)
  const save = option('save')
  if (save) mkdirSync(home(save), { recursive: true })
  const rnd = random(numberOption('seed', 1))
  const groups = new Map<string, Tally>()
  const wrongs: string[] = []
  for (const file of files) {
    const truth = numberOfFile(file)
    const card = loadImage(join(dir, file))
    for (const height of heights) {
      for (let p = 0; p < poses; p++) {
        const pose = randomPose(rnd, process.argv.includes('--mild'))
        const gate = createNumberGate(need)
        let offered: string | null = null
        const keys = ['all', `${height}p`, pose.thumb ? 'thumb' : 'no thumb']
        if (pose.glare) keys.push('glare')
        for (let f = 0; f < frames; f++) {
          const { img, corners } = render(
            cv,
            card,
            f === 0 ? pose : shaken(pose, rnd),
            height,
            photos,
            rnd
          )
          if (save)
            writeFileSync(
              join(home(save), `${truth}_${height}_${p}_${f}.jpg`),
              jpeg.encode({ ...img, data: Buffer.from(img.data.buffer) }, 85).data
            )
          const r = await read(img)
          const outline = outlineRight(r.quad, corners)
          const passed = gate.push(r.number)
          if (!offered && passed && catalog.has(passed)) offered = passed
          count(groups, keys, (t) => {
            t.frames++
            if (outline) t.outlines++
            if (r.number === truth) t.read++
            else if (r.number) {
              t.wrong++
              if (catalog.has(r.number)) t.wrongInCatalog++
            }
            t.visionMs.push(r.visionMs)
            t.ocrMs.push(r.ocrMs)
          })
          if (r.number && r.number !== truth)
            wrongs.push(
              `${file} ${height}p pose ${p} frame ${f}: ${r.number} ${JSON.stringify(r.texts)}`
            )
        }
        count(groups, keys, (t) => {
          t.sequences++
          if (offered === truth) t.offeredRight++
          else if (offered) t.offeredWrong++
        })
      }
    }
    process.stdout.write('.')
  }
  console.log()
  report(groups, true)
  if (wrongs.length) console.log(`Wrong reads:\n  ${wrongs.join('\n  ')}`)
}

interface TruthRow {
  file: string
  sourceId: string | null
  holder: string
}

async function real(read: ReadFrame, catalog: ReadonlySet<string>): Promise<void> {
  const dir = home(option('real')!)
  const truth = JSON.parse(readFileSync(join(dir, 'op-truth.json'), 'utf8')) as TruthRow[]
  const groups = new Map<string, Tally>()
  const wrongs: string[] = []
  for (const row of truth) {
    const number = row.sourceId?.split('/').slice(1).join('/') ?? null
    if (!number) continue
    const r = await read(appFrame(loadImage(join(dir, row.file))))
    count(groups, ['all', row.holder], (t) => {
      t.frames++
      t.sequences++
      if (r.number === number) t.read++
      else if (r.number) {
        t.wrong++
        if (catalog.has(r.number)) t.wrongInCatalog++
      }
      t.visionMs.push(r.visionMs)
      t.ocrMs.push(r.ocrMs)
    })
    if (r.number && r.number !== number)
      wrongs.push(`${row.file} (${number}, ${row.holder}): ${r.number} ${JSON.stringify(r.texts)}`)
    process.stdout.write('.')
  }
  console.log()
  // A still can't show two tries in a row: the live gate is the frames-in-a-row rate, squared at best.
  report(groups, false)
  if (wrongs.length) console.log(`Wrong reads:\n  ${wrongs.join('\n  ')}`)
}

async function main(): Promise<void> {
  if (!option('cards') && !option('real')) throw new Error('Pass --cards <dir> or --real <dir>')
  const catalogFile = option('catalog')
  const numbers = catalogFile
    ? readFileSync(home(catalogFile), 'utf8').split(/\s+/).filter(Boolean)
    : standInCatalog()
  const catalog = new Set(numbers)
  const prefixes = prefixesOf(numbers)
  const band = option('band')
  const base = scanProfile('op')
  const profile: ScanProfile = {
    ...base,
    ...(band
      ? { codeBands: band.split(';').map((b) => b.split(',').map(Number) as unknown as Box) }
      : {}),
    ...(option('reach') ? { codeReach: Number(option('reach')) } : {}),
    ...(option('gray') ? { codeGray: option('gray') === 'on' } : {})
  }
  console.log(
    `Number band ${JSON.stringify(profile.codeBands)}, ${profile.codeGray ? 'gray' : 'ink'} bands, reach ${profile.codeReach ?? 0}, ${catalog.size} catalog numbers`
  )
  const cv = await loadCv()
  const { read, dispose } = await reader(cv, profile, prefixes)
  try {
    if (option('real')) await real(read, catalog)
    else await synthetic(cv, read, catalog, numberOption('need', 2))
  } finally {
    await dispose()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
