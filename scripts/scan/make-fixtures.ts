// Generates the scan test fixtures in tests/fixtures/scan: three synthetic webcam shots per target
// card, 128x128 cropped-art thumbnails (targets plus distractors) and manifest.json.
// Run from the repo root: node --experimental-strip-types scripts/scan/make-fixtures.ts
// With --game pkm it makes tests/fixtures/scan-pkm instead: shots of TCGdex's card renders, the
// low.jpg reference images the nightly Pokémon fingerprints are built from (full/) and
// manifest.json.
// Downloads are cached in node_modules/.cache/scan-fixtures, so a re-run only regenerates.
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import type { Mat } from '@techstark/opencv-js'

// Node's type stripping can't resolve extensionless imports, so the app modules are loaded by URL.
const appModule = (rel: string): string => new URL(`../../src/${rel}`, import.meta.url).href
const { loadCv } = (await import(
  appModule('renderer/src/features/scan/vision/cv.ts')
)) as typeof import('../../src/renderer/src/features/scan/vision/cv')
const { ART_BOXES, CODE_BANDS, crop } = (await import(
  appModule('shared/scan/regions.ts')
)) as typeof import('../../src/shared/scan/regions')
const { artHash, fingerprintSource, hamming } = (await import(
  appModule('shared/scan/fingerprint.ts')
)) as typeof import('../../src/shared/scan/fingerprint')
const { imageUrl } = (await import(
  appModule('shared/imageSources.ts')
)) as typeof import('../../src/shared/imageSources')
const { pokemonId } = (await import(
  appModule('shared/games/ids.ts')
)) as typeof import('../../src/shared/games/ids')
const { variantLabel } = (await import(
  new URL('../catalog/pokemon/versions.ts', import.meta.url).href
)) as typeof import('../catalog/pokemon/versions')

const gameArg = process.argv.indexOf('--game')
const GAME = gameArg === -1 ? 'ygo' : process.argv[gameArg + 1]
if (GAME !== 'ygo' && GAME !== 'pkm') throw new Error(`Unknown game ${GAME}`)

type Frame = 'normal' | 'pendulum' | 'link'

interface Target {
  imageId: number
  name: string
}

interface CardInfo {
  id: number
  name: string
  frameType: string
  archetype?: string
  card_images: { id: number }[]
  card_sets?: { set_code: string }[]
}

const TARGETS: Target[] = [
  { imageId: 46986414, name: 'Dark Magician' },
  { imageId: 46986415, name: 'Dark Magician (alt art)' },
  { imageId: 89631139, name: 'Blue-Eyes White Dragon' },
  { imageId: 40640057, name: 'Kuriboh' },
  { imageId: 55144522, name: 'Pot of Greed' },
  { imageId: 44095762, name: 'Mirror Force' },
  { imageId: 16178681, name: 'Odd-Eyes Pendulum Dragon' },
  { imageId: 1861629, name: 'Decode Talker' },
  { imageId: 84013237, name: 'Number 39: Utopia' },
  { imageId: 5405694, name: 'Black Luster Soldier' },
  { imageId: 14558127, name: 'Ash Blossom' },
  { imageId: 12580477, name: 'Raigeki' },
  { imageId: 83764718, name: 'Monster Reborn' },
  { imageId: 44508094, name: 'Stardust Dragon' },
  { imageId: 20409757, name: 'Timegazer Magician' },
  { imageId: 86066372, name: 'Accesscode Talker' }
]
/** Spares tried in order when a target 404s, by frame. */
const SPARES: Record<Frame, number[]> = {
  normal: [38033121, 70781052, 74677422],
  pendulum: [73941492, 94415058],
  link: [5043010, 21887175]
}
const DISTRACTOR_ARCHETYPES = ['Dark Magician', 'Blue-Eyes', 'Code Talker', 'Magician']
const DISTRACTORS = 30
const SHOTS = 3

const OUT = 'tests/fixtures/scan'
const CACHE = 'node_modules/.cache/scan-fixtures'
const FRAME_W = 1280
const FRAME_H = 720
const CARD_W = 842
const CARD_H = 1228
/** The card face inside YGOPRODeck's 813x1185 renders, which pad it with a blurred shadow. */
const FACE = { x0: 26, y0: 26, x1: 786, y1: 1158 }
const JPEG_QUALITY = 80
/** Art distance above which a render's artwork isn't the one its cropped art shows. */
const ART_MISMATCH = 80

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let throttled = 0
/** GET with a polite delay; retries 429/5xx a few times and gives up after repeated 429s. */
async function get(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await sleep(120)
    const res = await fetch(url)
    if (res.ok || res.status === 404) {
      throttled = 0
      return res
    }
    await res.body?.cancel()
    if (res.status === 429 && ++throttled >= 5)
      throw new Error(`${new URL(url).host} keeps rate limiting`)
    if ((res.status !== 429 && res.status < 500) || attempt >= 3)
      throw new Error(`HTTP ${res.status} ${url}`)
    await sleep(2000 * (attempt + 1))
  }
}

async function cached(file: string, url: string): Promise<Buffer | null> {
  const path = join(CACHE, file)
  if (existsSync(path)) return readFileSync(path)
  const res = await get(url)
  if (res.status === 404) return null
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, buf)
  return buf
}

async function api(query: string): Promise<CardInfo[]> {
  const buf = await cached(
    `api/${query.replace(/[^a-z0-9]+/gi, '_')}.json`,
    `https://db.ygoprodeck.com/api/v7/cardinfo.php?${query}`
  )
  return buf ? (JSON.parse(buf.toString()) as { data: CardInfo[] }).data : []
}

function frameOf(frameType: string): Frame {
  if (frameType.includes('pendulum')) return 'pendulum'
  if (frameType === 'link') return 'link'
  return 'normal'
}

/** First English set code in the modern `ABCD-EN123` form. */
function englishCode(card: CardInfo): string {
  const code = card.card_sets?.map((s) => s.set_code).find((c) => /^[A-Z0-9]+-EN\d{3}$/.test(c))
  if (!code) throw new Error(`No English set code for ${card.name}`)
  return code
}

/** Seeded PRNG (mulberry32) so a re-run makes the same shots. */
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

const cv = await loadCv()

function decodeMat(buf: Buffer): Mat {
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  const mat = new cv.Mat(img.height, img.width, cv.CV_8UC4)
  mat.data.set(img.data)
  return mat
}

function writeJpeg(path: string, mat: Mat, quality = JPEG_QUALITY): void {
  const data = new Uint8Array(mat.data)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const out = jpeg.encode({ width: mat.cols, height: mat.rows, data }, quality)
  writeFileSync(path, out.data)
}

/**
 * The card face, stretched to the straightened size, with its set code printed on it. When the
 * render shows a different artwork from the cropped art (YGOPRODeck has a few mismatched alt
 * arts), the cropped art is pasted into the art window so the card matches its image id.
 */
function cardFace(
  full: Buffer,
  cropped: Buffer,
  setCode: string,
  frame: Frame
): { card: Mat; artPasted: boolean } {
  const src = decodeMat(full)
  const sx = src.cols / 813
  const sy = src.rows / 1185
  const rect = new cv.Rect(
    Math.round(FACE.x0 * sx),
    Math.round(FACE.y0 * sy),
    Math.round((FACE.x1 - FACE.x0) * sx),
    Math.round((FACE.y1 - FACE.y0) * sy)
  )
  const roi = src.roi(rect)
  const card = new cv.Mat()
  cv.resize(roi, card, new cv.Size(CARD_W, CARD_H), 0, 0, cv.INTER_CUBIC)
  roi.delete()
  src.delete()

  const art = decodeMat(cropped)
  const box = ART_BOXES[frame === 'pendulum' ? 'pendulum' : 'normal']
  const asImage = (m: Mat): { width: number; height: number; data: Uint8Array } => ({
    width: m.cols,
    height: m.rows,
    data: m.data
  })
  const artPasted =
    hamming(
      artHash(crop(asImage(card), box)),
      0,
      artHash(fingerprintSource(asImage(art), frame)),
      0
    ) > ART_MISMATCH
  if (artPasted) {
    if (frame === 'pendulum') throw new Error(`Render and cropped art differ for ${setCode}`)
    const window = new cv.Rect(
      Math.round(box[0] * CARD_W),
      Math.round(box[1] * CARD_H),
      Math.round((box[2] - box[0]) * CARD_W),
      Math.round((box[3] - box[1]) * CARD_H)
    )
    const resized = new cv.Mat()
    cv.resize(art, resized, new cv.Size(window.width, window.height), 0, 0, cv.INTER_AREA)
    const target = card.roi(window)
    resized.copyTo(target)
    target.delete()
    resized.delete()
  }
  art.delete()

  const scale = 0.95
  const thickness = 2
  // opencv.js has no getTextSize, so measure the text on a scratch strip.
  const scratch = cv.Mat.zeros(60, CARD_W, cv.CV_8UC1)
  cv.putText(
    scratch,
    setCode,
    new cv.Point(0, 40),
    cv.FONT_HERSHEY_SIMPLEX,
    scale,
    new cv.Scalar(255),
    thickness,
    cv.LINE_AA
  )
  let textW = 0
  for (let x = CARD_W - 1; x >= 0 && !textW; x--) {
    for (let y = 0; y < 60; y++) if (scratch.ucharAt(y, x)) textW = x + 1
  }
  scratch.delete()

  const band = frame === 'pendulum' ? CODE_BANDS[1] : CODE_BANDS[0]
  const baseline = Math.round(((band[1] + band[3]) / 2) * CARD_H + 4)
  // Pendulum cards print the code lower left; the rest print it on the right under the art.
  const x =
    frame === 'pendulum' ? Math.round((band[0] + 0.03) * CARD_W) : Math.round(0.9 * CARD_W) - textW
  cv.putText(
    card,
    setCode,
    new cv.Point(x, baseline),
    cv.FONT_HERSHEY_SIMPLEX,
    scale,
    new cv.Scalar(0, 0, 0, 255),
    thickness,
    cv.LINE_AA
  )
  return { card, artPasted }
}

/** A desk-like background: a few octaves of smooth noise over a base colour, plus grain. */
function background(rand: () => number): Mat {
  const base = [30 + rand() * 120, 30 + rand() * 120, 30 + rand() * 120]
  const field = new Float32Array(FRAME_W * FRAME_H)
  for (const [cells, amp] of [
    [4, 40],
    [16, 18],
    [64, 8]
  ]) {
    const small = new cv.Mat(Math.ceil((cells * FRAME_H) / FRAME_W) + 1, cells + 1, cv.CV_32FC1)
    for (let i = 0; i < small.data32F.length; i++) small.data32F[i] = (rand() - 0.5) * 2 * amp
    const big = new cv.Mat()
    cv.resize(small, big, new cv.Size(FRAME_W, FRAME_H), 0, 0, cv.INTER_CUBIC)
    for (let i = 0; i < field.length; i++) field[i] += big.data32F[i]
    small.delete()
    big.delete()
  }
  const mat = new cv.Mat(FRAME_H, FRAME_W, cv.CV_8UC4)
  const d = mat.data
  for (let i = 0; i < field.length; i++) {
    const grain = (rand() - 0.5) * 12
    for (let c = 0; c < 3; c++)
      d[i * 4 + c] = Math.max(0, Math.min(255, base[c] + field[i] + grain))
    d[i * 4 + 3] = 255
  }
  return mat
}

type Point = [number, number]

/** Card corners (clockwise from top-left) after a random 3D tilt, placed at a random spot. */
function randomQuad(rand: () => number): Point[] {
  const deg = (max: number): number => ((rand() * 2 - 1) * max * Math.PI) / 180
  const ax = deg(12)
  const ay = deg(12)
  const az = deg(8)
  const w = CARD_W / CARD_H
  const pts = [
    [-w / 2, -0.5],
    [w / 2, -0.5],
    [w / 2, 0.5],
    [-w / 2, 0.5]
  ].map(([x0, y0]) => {
    // Rotate about x, then y, then z, and project from 2.5 card heights away.
    const y1 = y0 * Math.cos(ax)
    const z1 = y0 * Math.sin(ax)
    const x2 = x0 * Math.cos(ay) + z1 * Math.sin(ay)
    const z2 = -x0 * Math.sin(ay) + z1 * Math.cos(ay)
    const x3 = x2 * Math.cos(az) - y1 * Math.sin(az)
    const y3 = x2 * Math.sin(az) + y1 * Math.cos(az)
    const z = 2.5 + z2
    return [x3 / z, y3 / z] as Point
  })
  const ys = pts.map((p) => p[1])
  const xs = pts.map((p) => p[0])
  const s = ((0.45 + rand() * 0.3) * FRAME_H) / (Math.max(...ys) - Math.min(...ys))
  const spanX = (Math.max(...xs) - Math.min(...xs)) * s
  const spanY = (Math.max(...ys) - Math.min(...ys)) * s
  const left = 10 + rand() * (FRAME_W - 20 - spanX)
  const top = 10 + rand() * (FRAME_H - 20 - spanY)
  return pts.map(([x, y]) => [
    Math.round(((x - Math.min(...xs)) * s + left) * 10) / 10,
    Math.round(((y - Math.min(...ys)) * s + top) * 10) / 10
  ])
}

/** Warps the card onto the background along quad, blending its anti-aliased edges. */
function composite(bg: Mat, card: Mat, quad: Point[]): void {
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CARD_W, 0, CARD_W, CARD_H, 0, CARD_H])
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat())
  const m = cv.getPerspectiveTransform(src, dst)
  const warped = new cv.Mat()
  cv.warpPerspective(
    card,
    warped,
    m,
    new cv.Size(FRAME_W, FRAME_H),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(0, 0, 0, 0)
  )
  const b = bg.data
  const w = warped.data
  for (let i = 0; i < b.length; i += 4) {
    const a = w[i + 3] / 255
    if (!a) continue
    for (let c = 0; c < 3; c++) b[i + c] = b[i + c] * (1 - a) + w[i + c] * a
  }
  for (const mat of [src, dst, m, warped]) mat.delete()
}

/** Shot 0 blurs, shot 1 changes brightness, shot 2 adds a glare blob over the card. */
function degrade(frame: Mat, shot: number, quad: Point[], rand: () => number): string {
  if (shot === 0) {
    const sigma = rand() * 1.5
    if (sigma > 0.05) cv.GaussianBlur(frame, frame, new cv.Size(0, 0), sigma, sigma)
    return `blur σ${sigma.toFixed(2)}`
  }
  if (shot === 1) {
    const gain = 0.6 + rand() * 0.6
    const d = frame.data
    for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = Math.min(255, d[i] * gain)
    return `brightness ×${gain.toFixed(2)}`
  }
  const t = rand()
  const u = rand()
  const cx =
    quad[0][0] * (1 - t) * (1 - u) +
    quad[1][0] * t * (1 - u) +
    quad[2][0] * t * u +
    quad[3][0] * (1 - t) * u
  const cy =
    quad[0][1] * (1 - t) * (1 - u) +
    quad[1][1] * t * (1 - u) +
    quad[2][1] * t * u +
    quad[3][1] * (1 - t) * u
  const radius = 50 + rand() * 90
  const peak = 0.45 + rand() * 0.35
  const d = frame.data
  for (
    let y = Math.max(0, Math.floor(cy - 3 * radius));
    y < Math.min(FRAME_H, cy + 3 * radius);
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(cx - 3 * radius));
      x < Math.min(FRAME_W, cx + 3 * radius);
      x++
    ) {
      const a = peak * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * radius * radius))
      const o = (y * FRAME_W + x) * 4
      for (let c = 0; c < 3; c++) d[o + c] = d[o + c] + (255 - d[o + c]) * a
    }
  }
  return `glare r${radius.toFixed(0)} α${peak.toFixed(2)}`
}

function thumbnail(buf: Buffer, path: string): void {
  const src = decodeMat(buf)
  const out = new cv.Mat()
  cv.resize(src, out, new cv.Size(128, 128), 0, 0, cv.INTER_AREA)
  writeJpeg(path, out)
  src.delete()
  out.delete()
}

/** The Yu-Gi-Oh fixtures in tests/fixtures/scan. */
async function makeYugioh(): Promise<void> {
  // ---- Resolve targets ----

  const swapped: { requested: number; used: number; reason: string }[] = []
  const targets: { imageId: number; card: CardInfo; frame: Frame }[] = []
  const allTargetCards = await api(`id=${TARGETS.map((t) => t.imageId).join(',')}`)
  const cardFor = (imageId: number, cards: CardInfo[]): CardInfo | undefined =>
    cards.find((c) => c.card_images.some((i) => i.id === imageId))

  for (const t of TARGETS) {
    let card = cardFor(t.imageId, allTargetCards)
    let imageId = t.imageId
    if (!card || !(await cached(`full/${imageId}.jpg`, imageUrl('full', imageId)))) {
      const frame = card ? frameOf(card.frameType) : 'normal'
      for (const spare of SPARES[frame]) {
        const [c] = await api(`id=${spare}`)
        if (c && !targets.some((x) => x.imageId === spare)) {
          swapped.push({ requested: t.imageId, used: spare, reason: 'not found on YGOPRODeck' })
          card = c
          imageId = spare
          break
        }
      }
      if (!card) throw new Error(`No replacement for ${t.name}`)
    }
    targets.push({ imageId, card, frame: frameOf(card.frameType) })
  }

  // ---- Distractors: other artworks from the same archetypes ----

  const targetIds = new Set(targets.map((t) => t.imageId))
  const pools: { imageId: number; card: CardInfo }[][] = []
  for (const archetype of DISTRACTOR_ARCHETYPES) {
    const cards = await api(`archetype=${encodeURIComponent(archetype)}`)
    pools.push(
      cards
        .flatMap((card) => card.card_images.map((i) => ({ imageId: i.id, card })))
        .filter((d) => !targetIds.has(d.imageId))
        .sort((a, b) => a.imageId - b.imageId)
    )
  }
  const distractors: { imageId: number; card: CardInfo }[] = []
  for (let i = 0; distractors.length < DISTRACTORS && pools.some((p) => i < p.length); i++) {
    for (const pool of pools) {
      const d = pool[i]
      if (
        d &&
        distractors.length < DISTRACTORS &&
        !distractors.some((x) => x.imageId === d.imageId)
      )
        distractors.push(d)
    }
  }

  // ---- Write fixtures ----

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, 'cropped'), { recursive: true })

  const thumbs: number[] = []
  for (const { imageId, card } of [...targets, ...distractors]) {
    const buf = await cached(`cropped/${imageId}.jpg`, imageUrl('cropped', imageId))
    if (!buf) {
      console.warn(`no cropped art for ${card.name} (${imageId}), skipped`)
      continue
    }
    thumbnail(buf, join(OUT, 'cropped', `${imageId}.jpg`))
    thumbs.push(imageId)
  }
  const missingTarget = targets.find((t) => !thumbs.includes(t.imageId))
  if (missingTarget) throw new Error(`No cropped art for target ${missingTarget.imageId}`)

  const shots: object[] = []
  for (const { imageId, card, frame } of targets) {
    const full = await cached(`full/${imageId}.jpg`, imageUrl('full', imageId))
    if (!full) throw new Error(`No full image for ${imageId}`)
    const cropped = await cached(`cropped/${imageId}.jpg`, imageUrl('cropped', imageId))
    const setCode = englishCode(card)
    const { card: face, artPasted } = cardFace(full, cropped!, setCode, frame)
    if (artPasted) console.log(`${card.name} (${imageId}): render art differs, pasted cropped art`)
    for (let shot = 0; shot < SHOTS; shot++) {
      const rand = rng(imageId * 10 + shot)
      const img = background(rand)
      const quad = randomQuad(rand)
      composite(img, face, quad)
      const effect = degrade(img, shot, quad, rand)
      const file = `${imageId}-${shot}.jpg`
      writeJpeg(join(OUT, file), img)
      img.delete()
      shots.push({
        file,
        imageId,
        cardId: card.id,
        name: card.name,
        setCode,
        frame,
        quad,
        effect,
        ...(artPasted && { artPasted })
      })
    }
    face.delete()
  }

  writeFileSync(
    join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        shots,
        distractors: distractors
          .filter((d) => thumbs.includes(d.imageId))
          .map((d) => ({
            imageId: d.imageId,
            cardId: d.card.id,
            name: d.card.name,
            frame: frameOf(d.card.frameType)
          })),
        swapped
      },
      null,
      2
    ) + '\n'
  )
  console.log(`${shots.length} shots, ${thumbs.length} thumbnails, ${swapped.length} swapped`)
}

// ---- Pokémon ----

type PkmLang = 'en' | 'ja'
type PkmKind = 'pokemon' | 'trainer' | 'energy' | 'full-art'

interface PkmTarget {
  lang: PkmLang
  /** TCGdex card id. */
  id: string
  kind: PkmKind
}

/**
 * Eight English and eight Japanese cards: four en/ja twin pairs (Pikachu, Bulbasaur and Charizard
 * ex from 151, and its Special Illustration Rare, the full arts), cards with a Reverse Holofoil
 * version (Pikachu, Bulbasaur, Lapras, Youngster, Reversal Energy, Paras), Trainers, an Energy,
 * base set Charizard (four versions, three of them stamped) and Scarlet & Violet and Sword &
 * Shield era Japanese cards.
 */
const PKM_TARGETS: PkmTarget[] = [
  { lang: 'en', id: 'sv03.5-025', kind: 'pokemon' },
  { lang: 'en', id: 'sv03.5-001', kind: 'pokemon' },
  { lang: 'en', id: 'sv03.5-006', kind: 'pokemon' },
  { lang: 'en', id: 'sv03.5-199', kind: 'full-art' },
  { lang: 'en', id: 'sv03-045', kind: 'pokemon' },
  { lang: 'en', id: 'sv01-198', kind: 'trainer' },
  { lang: 'en', id: 'sv02-192', kind: 'energy' },
  { lang: 'en', id: 'base1-4', kind: 'pokemon' },
  { lang: 'ja', id: 'SV2a-025', kind: 'pokemon' },
  { lang: 'ja', id: 'SV2a-001', kind: 'pokemon' },
  { lang: 'ja', id: 'SV2a-006', kind: 'pokemon' },
  { lang: 'ja', id: 'SV2a-201', kind: 'full-art' },
  { lang: 'ja', id: 'SV1S-077', kind: 'trainer' },
  { lang: 'ja', id: 'SV1S-001', kind: 'pokemon' },
  { lang: 'ja', id: 'SV1V-001', kind: 'pokemon' },
  { lang: 'ja', id: 'S12a-001', kind: 'pokemon' }
]
/**
 * Other artworks of the same Pokémon and sets: their evolutions, other Pikachu and Charizard
 * cards, base set neighbours and the Japanese twins of English distractors.
 */
const PKM_DISTRACTORS: { lang: PkmLang; id: string }[] = [
  { lang: 'en', id: 'sv03.5-002' },
  { lang: 'en', id: 'sv03.5-004' },
  { lang: 'en', id: 'sv03.5-005' },
  { lang: 'en', id: 'sv03.5-026' },
  { lang: 'en', id: 'sv03.5-166' },
  { lang: 'en', id: 'sv03.5-173' },
  { lang: 'en', id: 'sv03-125' },
  { lang: 'en', id: 'sv03-215' },
  { lang: 'en', id: 'sv03-046' },
  { lang: 'en', id: 'sv01-001' },
  { lang: 'en', id: 'sv01-196' },
  { lang: 'en', id: 'swsh1-180' },
  { lang: 'en', id: 'base1-58' },
  { lang: 'en', id: 'base1-2' },
  { lang: 'ja', id: 'SV2a-002' },
  { lang: 'ja', id: 'SV2a-004' },
  { lang: 'ja', id: 'SV2a-026' },
  { lang: 'ja', id: 'SV2a-166' },
  { lang: 'ja', id: 'SV2a-173' },
  { lang: 'ja', id: 'SV2a-185' },
  { lang: 'ja', id: 'SV1S-002' },
  { lang: 'ja', id: 'SV1S-076' },
  { lang: 'ja', id: 'SV1V-002' },
  { lang: 'ja', id: 'S12a-002' }
]
const PKM_OUT = 'tests/fixtures/scan-pkm'
/** A little under Yu-Gi-Oh's, so the shots and references keep under 6 MB. */
const PKM_JPEG_QUALITY = 72
/** The share of a card's width its corners are rounded by (about 3 mm of 63). */
const CORNER = 0.048

interface TdCardInfo {
  id: string
  localId: string
  name: string
  category?: string
  image?: string
  variants_detailed?: { type: string; subtype?: string; stamp?: string[] }[]
  set: { id: string }
}

interface TdSetInfo {
  id: string
  abbreviation?: { official?: string }
  cardCount?: { official?: number }
}

const tcgdex = async <T>(lang: PkmLang, path: string): Promise<T> => {
  const buf = await cached(
    `pkm/api/${lang}_${path.replace(/[^a-z0-9.]+/gi, '_')}.json`,
    `https://api.tcgdex.net/v2/${lang}/${path}`
  )
  if (!buf) throw new Error(`TCGdex has no ${lang}/${path}`)
  return JSON.parse(buf.toString()) as T
}

/** An art's catalog keys, as the nightly Pokémon step writes them, and what the gate needs. */
interface PkmArt {
  imageId: number
  cardId: number
  sourceId: string
  name: string
  language: PkmLang
  setCode: string
  versions: string[]
  /** TCGdex's image base URL. */
  image: string
}

async function pokemonArt(lang: PkmLang, id: string): Promise<PkmArt> {
  const card = await tcgdex<TdCardInfo>(lang, `cards/${encodeURIComponent(id)}`)
  if (!card.image) throw new Error(`No image for ${lang}/${id}`)
  const set = await tcgdex<TdSetInfo>(lang, `sets/${encodeURIComponent(card.set.id)}`)
  // As scripts/catalog/pokemon/write.ts numbers a printing and labels its versions (TCGplayer's
  // prices may add more there; the gate only scores a version the catalog has more than one of).
  const abbrev = set.abbreviation?.official?.trim() || set.id.toUpperCase()
  const official = set.cardCount?.official
  const sourceId = `${lang}/${card.id}`
  const versions = [...new Set((card.variants_detailed ?? []).map(variantLabel))].sort()
  return {
    imageId: pokemonId(`${sourceId}#img`),
    cardId: pokemonId(sourceId),
    sourceId,
    name: card.name,
    language: lang,
    setCode: official ? `${abbrev} ${card.localId}/${official}` : `${abbrev} ${card.localId}`,
    versions: versions.length ? versions : ['Normal'],
    image: card.image
  }
}

/** A TCGdex render stretched to the straightened size, its corners rounded off as a card's are. */
function pokemonFace(high: Buffer): Mat {
  const src = decodeMat(high)
  const card = new cv.Mat()
  cv.resize(src, card, new cv.Size(CARD_W, CARD_H), 0, 0, cv.INTER_CUBIC)
  src.delete()
  const r = Math.round(CORNER * CARD_W)
  const d = card.data
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < r; x++) {
      if ((r - x - 0.5) ** 2 + (r - y - 0.5) ** 2 <= r * r) continue
      for (const [cx, cy] of [
        [x, y],
        [CARD_W - 1 - x, y],
        [x, CARD_H - 1 - y],
        [CARD_W - 1 - x, CARD_H - 1 - y]
      ])
        d[(cy * CARD_W + cx) * 4 + 3] = 0
    }
  }
  return card
}

/** The Pokémon fixtures in tests/fixtures/scan-pkm. */
async function makePokemon(): Promise<void> {
  const targets: (PkmArt & { kind: PkmKind })[] = []
  for (const t of PKM_TARGETS) targets.push({ ...(await pokemonArt(t.lang, t.id)), kind: t.kind })
  const distractors: PkmArt[] = []
  for (const d of PKM_DISTRACTORS) distractors.push(await pokemonArt(d.lang, d.id))

  rmSync(PKM_OUT, { recursive: true, force: true })
  mkdirSync(join(PKM_OUT, 'full'), { recursive: true })
  // The references are TCGdex's own bytes, as the nightly job downloads them.
  for (const a of [...targets, ...distractors]) {
    const low = await cached(`pkm/low/${a.sourceId}.jpg`, `${a.image}/low.jpg`)
    if (!low) throw new Error(`No low.jpg for ${a.sourceId}`)
    writeFileSync(join(PKM_OUT, 'full', `${a.imageId}.jpg`), low)
  }

  const shots: object[] = []
  for (const { image, kind, ...art } of targets) {
    const high = await cached(`pkm/high/${art.sourceId}.jpg`, `${image}/high.jpg`)
    if (!high) throw new Error(`No high.jpg for ${art.sourceId}`)
    const face = pokemonFace(high)
    for (let shot = 0; shot < SHOTS; shot++) {
      // Image ids are past 2^32, so the seed takes their low bits.
      const rand = rng((art.imageId % 2 ** 31) * 10 + shot)
      const img = background(rand)
      const quad = randomQuad(rand)
      composite(img, face, quad)
      const effect = degrade(img, shot, quad, rand)
      const file = `${art.imageId}-${shot}.jpg`
      writeJpeg(join(PKM_OUT, file), img, PKM_JPEG_QUALITY)
      img.delete()
      shots.push({
        file,
        ...art,
        // The version the shot is when the catalog can only have one; else not told.
        version: art.versions.length === 1 ? art.versions[0] : null,
        kind,
        quad,
        effect
      })
    }
    face.delete()
  }

  writeFileSync(
    join(PKM_OUT, 'manifest.json'),
    JSON.stringify({ shots, distractors: distractors.map(({ image, ...d }) => d) }, null, 2) + '\n'
  )
  console.log(`${shots.length} shots, ${targets.length + distractors.length} reference images`)
}

if (GAME === 'pkm') await makePokemon()
else await makeYugioh()
