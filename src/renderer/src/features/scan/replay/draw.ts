import { formatUsd } from '@/lib/format'
import { plural } from '../scanText'
import { REPLAY_MIN_PRICE, replayValue, type ReplayPull } from './pulls'
import { frameAt, PULL_MS, type ReplayTimeline } from './timeline'

/** The replay's frame: 4:5, large in Discord on a phone and on a desktop. */
export const REPLAY_W = 720
export const REPLAY_H = 900

/** Everything a frame is drawn from. `art[i]` is `pulls[i]`'s; the two always line up. */
export interface ReplayScene {
  pulls: ReplayPull[]
  art: ImageBitmap[]
  header: string
  timeline: ReplayTimeline
  /** How the blurred art behind the card looks; `bright` (safe with any encoder) when left out. */
  backdrop?: ReplayBackdrop
  /** The app's logo, drawn beside the watermark; just the words without it. */
  logo?: CanvasImageSource
}

const WATERMARK = 'DUEL BINDER · RIP REPLAY'
const FONT = "'IBM Plex Sans', system-ui, sans-serif"

/** The app's own palette (index.css): warm off-white on near-black; colour comes from the art. */
const BG = '#111113'
export const FG = '#ecebe8'
export const MUTED = '#8f8d88'
export const GOLD = '#e8c477'
const GOLD_RGB = '232, 196, 119'

export const CARD_ASPECT = 88 / 63
const CARD_W = REPLAY_W * 0.46
const CARD_Y = REPLAY_H * 0.43
const END_W = REPLAY_W * 0.34
const END_Y = REPLAY_H * 0.35
const THUMB_W = 72

/** A pull's beats, in ms from the start of its segment. */
const DEAL_MS = 520
const FLIP_AT = 420
const BEST_FLIP_AT = 1500
const FLIP_MS = 400
const SHEEN_MS = 900
const LINE_MS = 280
const COUNT_MS = 550
const FLASH_MS = 320
const RING_MS = 750
const PARTICLE_COUNT = 46

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const easeOut = (n: number): number => 1 - (1 - n) ** 3
const easeIn = (n: number): number => n ** 3
const easeInOut = (n: number): number => (n < 0.5 ? 4 * n ** 3 : 1 - (-2 * n + 2) ** 3 / 2)
const easeOutBack = (n: number): number => {
  const c = 1.7
  return 1 + (c + 1) * (n - 1) ** 3 + c * (n - 1) ** 2
}
const ramp = (local: number, from: number, ms: number): number => clamp01((local - from) / ms)

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function setFont(
  ctx: CanvasRenderingContext2D,
  weight: number,
  px: number,
  spacing = 0
): void {
  ctx.font = `${weight} ${px}px ${FONT}`
  ctx.letterSpacing = `${spacing}px`
}

/** Text centred at x, shrunk until it fits `maxWidth`. */
export function centredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  weight: number,
  size: number,
  maxWidth: number,
  spacing = 0
): void {
  let px = size
  setFont(ctx, weight, px, spacing)
  while (px > 12 && ctx.measureText(text).width > maxWidth) {
    px -= 2
    setFont(ctx, weight, px, spacing)
  }
  ctx.textAlign = 'center'
  ctx.fillText(text, x, y)
}

/** A small seeded random: the same particles on every frame and every run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let r = Math.imul(s ^ (s >>> 15), 1 | s)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// --- The art's colour -----------------------------------------------------------------------

/** A card's colour, worked out once: two blurred washes for the backdrop and a glow. */
interface Ambient {
  /** Blurred to a few soft blobs of colour. */
  wash: CanvasImageSource | null
  /** Blurred less: some of the art's shapes still show. */
  detail: CanvasImageSource | null
  glow: string
}

const ambients = new WeakMap<object, Ambient>()
const NEUTRAL: Ambient = { wash: null, detail: null, glow: 'rgba(236, 235, 232, 0.28)' }

/** The art shrunk to `w`×`h` and grown back: a blur that costs nothing per frame. */
function blurred(art: ImageBitmap, w: number, h: number): OffscreenCanvas | null {
  const tiny = new OffscreenCanvas(w, h)
  const tctx = tiny.getContext('2d')
  const out = new OffscreenCanvas(60, 84)
  const octx = out.getContext('2d')
  if (!tctx || !octx) return null
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(art, 0, 0, w, h)
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(tiny, 0, 0, 60, 84)
  return out
}

function ambientOf(art: ImageBitmap): Ambient {
  const known = ambients.get(art)
  if (known) return known
  let ambient = NEUTRAL
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const wash = blurred(art, 5, 7)
      const detail = blurred(art, 12, 17)
      const one = new OffscreenCanvas(1, 1)
      const octx = one.getContext('2d', { willReadFrequently: true })
      if (wash && detail && octx) {
        octx.drawImage(wash, 0, 0, 1, 1)
        const [r, g, b] = octx.getImageData(0, 0, 1, 1).data
        // Brightened to a glow: the strongest channel up to 235, the others with it.
        const k = 235 / Math.max(r, g, b, 1)
        const c = (n: number): number => Math.round(Math.min(255, n * k))
        ambient = { wash, detail, glow: `rgba(${c(r)}, ${c(g)}, ${c(b)}, 0.6)` }
      }
    } catch {
      ambient = NEUTRAL
    }
  }
  ambients.set(art, ambient)
  return ambient
}

export const glowOf = (art: ImageBitmap): string => ambientOf(art).glow

// --- Backdrop ---------------------------------------------------------------------------------

/**
 * Behind the card, the card's art blurred and glowing through near-black. `deep` is very soft and
 * dark. Software H.264 (Chromium's OpenH264, all Linux has) turns its smooth dark gradients to
 * blocks at any bitrate; `bright` is blurred less and lit more, which that encoder keeps clean.
 */
export type ReplayBackdrop = 'deep' | 'bright'

/** How each backdrop is lit: the wash's strength, then how dark the edges, top and bottom go. */
const LOOKS: Record<
  ReplayBackdrop,
  { gain: number; mid: number; edge: number; top: number; bottom: number }
> = {
  deep: { gain: 1, mid: 0.15, edge: 0.92, top: 0.7, bottom: 0.85 },
  bright: { gain: 1.8, mid: 0, edge: 0.55, top: 0.45, bottom: 0.82 }
}

function washLayer(
  ctx: CanvasRenderingContext2D,
  ambient: Ambient,
  look: ReplayBackdrop,
  alpha: number,
  t: number
): void {
  const image = look === 'deep' ? ambient.wash : ambient.detail
  if (!image || alpha <= 0) return
  // Drifts slowly, larger than the frame so its edges never show.
  const zoom = 1.45 + 0.05 * Math.sin(t / 3100)
  const w = REPLAY_W * zoom
  const h = REPLAY_H * zoom
  const dx = Math.sin(t / 4300) * 30
  const dy = Math.cos(t / 3700) * 24
  ctx.save()
  ctx.globalAlpha = Math.min(1, alpha * LOOKS[look].gain)
  ctx.drawImage(image, (REPLAY_W - w) / 2 + dx, (REPLAY_H - h) / 2 + dy, w, h)
  ctx.restore()
}

/** Near-black, the card's colour glowing through, darker at the edges and under the text. */
export function backdrop(
  ctx: CanvasRenderingContext2D,
  scene: Pick<ReplayScene, 'backdrop'>,
  layers: { art: ImageBitmap; alpha: number }[],
  t: number
): void {
  const look = scene.backdrop ?? 'bright'
  const { mid, edge, top, bottom } = LOOKS[look]
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, REPLAY_W, REPLAY_H)
  for (const l of layers) washLayer(ctx, ambientOf(l.art), look, l.alpha, t)

  const v = ctx.createRadialGradient(
    REPLAY_W / 2,
    CARD_Y,
    REPLAY_W * 0.2,
    REPLAY_W / 2,
    CARD_Y,
    REPLAY_H * 0.78
  )
  v.addColorStop(0, `rgba(17, 17, 19, ${mid})`)
  v.addColorStop(1, `rgba(17, 17, 19, ${edge})`)
  ctx.fillStyle = v
  ctx.fillRect(0, 0, REPLAY_W, REPLAY_H)

  const fade = ctx.createLinearGradient(0, 0, 0, REPLAY_H)
  fade.addColorStop(0, `rgba(17, 17, 19, ${top})`)
  fade.addColorStop(0.16, 'rgba(17, 17, 19, 0)')
  fade.addColorStop(0.68, 'rgba(17, 17, 19, 0)')
  fade.addColorStop(1, `rgba(17, 17, 19, ${bottom})`)
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, REPLAY_W, REPLAY_H)
}

// --- The card ---------------------------------------------------------------------------------

export interface Pose {
  cx: number
  cy: number
  w: number
  rot: number
  /** The flip: 1 flat, 0 edge on. */
  sx: number
  face: boolean
  alpha: number
  glow: string
  glowBlur: number
  /** The sheen's sweep, 0..1, or null for none. */
  sheen: number | null
}

/** The back every card is dealt on: the app's dark cards with the logo's two diamonds. */
function cardBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, y, x + w, y + h)
  g.addColorStop(0, '#3a3a41')
  g.addColorStop(1, '#1c1c20')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  const inset = w * 0.06
  roundedRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, 6)
  ctx.strokeStyle = 'rgba(236, 235, 232, 0.24)'
  ctx.lineWidth = 2
  ctx.stroke()
  const s = w * 0.15
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.strokeStyle = 'rgba(236, 235, 232, 0.75)'
  ctx.lineWidth = w * 0.022
  ctx.lineJoin = 'round'
  for (const off of [-s / 3, s / 3]) {
    ctx.beginPath()
    ctx.moveTo(cx + off, cy - s)
    ctx.lineTo(cx + off + s, cy)
    ctx.lineTo(cx + off, cy + s)
    ctx.lineTo(cx + off - s, cy)
    ctx.closePath()
    ctx.stroke()
  }
}

export function drawCard(
  ctx: CanvasRenderingContext2D,
  art: ImageBitmap,
  p: Pose,
  k: number
): void {
  if (p.alpha <= 0) return
  const w = p.w
  const h = w * CARD_ASPECT
  const x = -w / 2
  const y = -h / 2
  ctx.save()
  ctx.globalAlpha *= p.alpha
  ctx.translate(p.cx, p.cy)
  ctx.rotate(p.rot)
  ctx.scale(Math.max(p.sx, 0.002), 1)

  // Shadows don't scale with the transform: `k` keeps them the same size in a smaller GIF.
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 40 * k
  ctx.shadowOffsetY = 22 * k
  ctx.fillStyle = '#000'
  roundedRect(ctx, x, y, w, h, 10)
  ctx.fill()
  ctx.shadowColor = p.glow
  ctx.shadowBlur = p.glowBlur * k
  ctx.shadowOffsetY = 0
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundedRect(ctx, x, y, w, h, 10)
  ctx.clip()
  if (p.face) ctx.drawImage(art, x, y, w, h)
  else cardBack(ctx, x, y, w, h)
  if (p.face && p.sheen !== null) {
    const bandX = x - w + p.sheen * w * 2.6
    const g = ctx.createLinearGradient(bandX, y, bandX + w * 0.7, y + h)
    g.addColorStop(0, 'rgba(255, 255, 255, 0)')
    g.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)')
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha *= 0.45
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    ctx.globalCompositeOperation = 'source-over'
  }
  // Edge on, the card falls into shadow.
  if (p.sx < 1) {
    ctx.globalAlpha = 0.45 * (1 - p.sx)
    ctx.fillStyle = '#000'
    ctx.fillRect(x, y, w, h)
  }
  ctx.restore()

  roundedRect(ctx, x, y, w, h, 10)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

// --- The best pull's moment -------------------------------------------------------------------

function rays(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  alpha: number,
  t: number
): void {
  if (alpha <= 0) return
  const r = REPLAY_H * 0.8
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'lighter'
  ctx.translate(cx, cy)
  ctx.rotate(t * 0.00012)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  g.addColorStop(0, `rgba(${GOLD_RGB}, 0.7)`)
  g.addColorStop(0.7, `rgba(${GOLD_RGB}, 0.12)`)
  g.addColorStop(1, `rgba(${GOLD_RGB}, 0)`)
  ctx.fillStyle = g
  const count = 10
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, r, a - 0.11, a + 0.11)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: number): void {
  if (p <= 0 || p >= 1) return
  ctx.save()
  ctx.globalAlpha = 0.85 * (1 - p)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 3 + 14 * (1 - p)
  ctx.beginPath()
  ctx.arc(cx, cy, 60 + easeOut(p) * REPLAY_W * 0.7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Sparks thrown out from the card as it turns over, falling as they fade. */
function sparks(ctx: CanvasRenderingContext2D, cx: number, cy: number, since: number): void {
  if (since < 0) return
  const rand = seeded(7)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = rand() * Math.PI * 2
    const speed = 0.25 + rand() * 0.55
    const life = 900 + rand() * 1300
    const size = 2 + rand() * 4
    const gold = rand() < 0.7
    const tau = since - rand() * 120
    if (tau < 0 || tau > life) continue
    const x = cx + Math.cos(angle) * speed * tau
    const y = cy + Math.sin(angle) * speed * tau + 0.00022 * tau * tau
    ctx.globalAlpha = (1 - tau / life) ** 1.5
    ctx.fillStyle = gold ? GOLD : FG
    ctx.beginPath()
    ctx.arc(x, y, size * (1 - (0.5 * tau) / life), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// --- Text -------------------------------------------------------------------------------------

/** A line coming up into place: its alpha and how far it still has to rise. */
const lineIn = (local: number, at: number): { a: number; dy: number } => {
  const p = easeOut(ramp(local, at, LINE_MS))
  return { a: p, dy: (1 - p) * 18 }
}

export function rarityPill(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  setFont(ctx, 600, 17, 2)
  const w = Math.min(REPLAY_W - 80, ctx.measureText(text).width + 30)
  ctx.save()
  roundedRect(ctx, (REPLAY_W - w) / 2, y - 24, w, 36, 18)
  ctx.fillStyle = `rgba(${GOLD_RGB}, 0.1)`
  ctx.fill()
  ctx.strokeStyle = `rgba(${GOLD_RGB}, 0.45)`
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = GOLD
  centredText(ctx, text, REPLAY_W / 2, y, 600, 17, w - 24, 2)
}

/** Rarity, name and price, each rising in after the last; the price counts up. */
function pullText(
  ctx: CanvasRenderingContext2D,
  pull: ReplayPull,
  local: number,
  at: number,
  alpha: number
): void {
  if (alpha <= 0 || local < at) return
  let y = REPLAY_H * 0.765
  let delay = at
  ctx.save()
  if (pull.rarity) {
    const l = lineIn(local, delay)
    ctx.globalAlpha = alpha * l.a
    rarityPill(ctx, pull.rarity.toUpperCase(), y + l.dy)
    y += 52
    delay += 80
  }
  const name = lineIn(local, delay)
  ctx.globalAlpha = alpha * name.a
  ctx.fillStyle = FG
  centredText(ctx, pull.name, REPLAY_W / 2, y + name.dy, 700, 36, REPLAY_W - 80)
  y += 42
  delay += 80
  const price = lineIn(local, delay)
  // A pull its rarity earned shows no price: the rarity says what it is.
  const parts = [
    ...(pull.price !== null && pull.price >= REPLAY_MIN_PRICE
      ? [formatUsd(pull.price * easeOut(ramp(local, delay, COUNT_MS)))]
      : []),
    ...(pull.quantity > 1 ? [`×${pull.quantity}`] : [])
  ]
  if (parts.length) {
    ctx.globalAlpha = alpha * price.a
    ctx.fillStyle = MUTED
    centredText(ctx, parts.join(' · '), REPLAY_W / 2, y + price.dy, 500, 26, REPLAY_W - 80)
  }
  ctx.restore()
}

export function chip(ctx: CanvasRenderingContext2D, text: string): void {
  setFont(ctx, 500, 21)
  const w = ctx.measureText(text).width + 36
  roundedRect(ctx, 24, 24, w, 44, 22)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = FG
  ctx.textAlign = 'left'
  ctx.fillText(text, 42, 53)
}

/** "#3 of 8" at the top right; on a new pull the old count lifts away as the new one comes up. */
function countLabel(
  ctx: CanvasRenderingContext2D,
  rank: number,
  of: number,
  local: number,
  index: number
): void {
  if (of <= 1) return
  const p = index === 0 ? 1 : easeOut(ramp(local, 0, 360))
  setFont(ctx, 600, 21, 1)
  ctx.textAlign = 'right'
  ctx.fillStyle = MUTED
  ctx.save()
  if (p < 1) {
    ctx.globalAlpha = 1 - p
    ctx.fillText(`#${rank + 1} of ${of}`, REPLAY_W - 28, 53 - p * 16)
  }
  ctx.globalAlpha = p
  ctx.fillText(`#${rank} of ${of}`, REPLAY_W - 28, 53 + (1 - p) * 16)
  ctx.restore()
}

const LOGO_PX = 26
const LOGO_GAP = 9

/** The words along the bottom, the logo just before them where there is one; the two centred. */
export function watermark(
  ctx: CanvasRenderingContext2D,
  logo: CanvasImageSource | undefined
): void {
  const y = REPLAY_H - 24
  ctx.save()
  ctx.fillStyle = MUTED
  if (!logo) {
    ctx.globalAlpha = 0.55
    centredText(ctx, WATERMARK, REPLAY_W / 2, y, 600, 15, REPLAY_W - 80, 3)
    ctx.restore()
    return
  }
  setFont(ctx, 600, 15, 3)
  const textW = ctx.measureText(WATERMARK).width
  const left = (REPLAY_W - (LOGO_PX + LOGO_GAP + textW)) / 2
  // The logo keeps its own colours, a little brighter than the words beside it.
  ctx.globalAlpha = 0.85
  ctx.drawImage(logo, left, y - LOGO_PX + 5, LOGO_PX, LOGO_PX)
  ctx.globalAlpha = 0.55
  ctx.textAlign = 'left'
  ctx.fillText(WATERMARK, left + LOGO_PX + LOGO_GAP, y)
  ctx.restore()
}

// --- Pulls ------------------------------------------------------------------------------------

const flipAtFor = (rank: number): number => (rank === 1 ? BEST_FLIP_AT : FLIP_AT)
const textAtFor = (rank: number): number => flipAtFor(rank) + FLIP_MS

/** Where a pull's card is `local` ms into its own segment, `t` ms into the replay. */
function pullPose(index: number, rank: number, local: number, t: number, glow: string): Pose {
  const best = rank === 1
  const flipAt = flipAtFor(rank)
  let cx = REPLAY_W / 2
  let cy = CARD_Y + Math.sin(t / 900) * 6
  let rot = Math.sin(t / 1300) * 0.012
  let w = CARD_W

  // Dealt in from the right, face down; the first is already there when the video starts.
  const deal = easeOut(ramp(local, 0, DEAL_MS))
  if (index === 0) w *= 0.94 + 0.06 * deal
  else {
    cx += (1 - deal) * REPLAY_W * 0.95
    rot += (1 - deal) * 0.22
  }

  let glowBlur = 70
  let glowColor = glow
  if (best && local < flipAt) {
    // The build-up: the best card shakes harder and glows brighter until it turns.
    const build = ramp(local, DEAL_MS, flipAt - DEAL_MS)
    const amp = build * build * 7
    cx += Math.sin(local * 0.11) * amp
    cy += Math.cos(local * 0.137) * amp * 0.6
    rot += Math.sin(local * 0.09) * amp * 0.004
    glowColor = `rgba(${GOLD_RGB}, ${0.35 + 0.5 * build})`
    glowBlur = 40 + build * 80 + Math.sin(local * 0.02) * 12 * build
  } else if (local < flipAt + FLIP_MS / 2) {
    glowColor = 'rgba(236, 235, 232, 0.16)'
    glowBlur = 40
  } else if (best) glowBlur = 100

  const flip = easeInOut(ramp(local, flipAt, FLIP_MS))
  const angle = flip * Math.PI
  w *= 1 + Math.sin(angle) * 0.08
  // A small pop as the face lands.
  const pop = ramp(local, flipAt + FLIP_MS, 360)
  w *= 1 + 0.035 * Math.sin(pop * Math.PI)

  const sheenStart = flipAt + FLIP_MS
  const sinceSheen = local - sheenStart
  let sheen: number | null = null
  if (sinceSheen >= 0) {
    const period = best ? 2400 : Infinity
    const phase = sinceSheen % period
    if (phase < SHEEN_MS) sheen = phase / SHEEN_MS
  }

  return {
    cx,
    cy,
    w,
    rot,
    sx: Math.abs(Math.cos(angle)),
    face: flip >= 0.5,
    alpha: 1,
    glow: glowColor,
    glowBlur,
    sheen
  }
}

/** The pull before, thrown off to the left as the next is dealt. */
function exiting(pose: Pose, p: number): Pose {
  const e = easeIn(p)
  return {
    ...pose,
    cx: pose.cx - e * REPLAY_W * 0.95,
    cy: pose.cy + e * 30,
    rot: pose.rot - e * 0.28,
    alpha: 1 - e * 0.4
  }
}

function ghostNumber(
  ctx: CanvasRenderingContext2D,
  rank: number,
  of: number,
  shift: number,
  alpha: number
): void {
  if (of <= 1 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = 0.05 * alpha
  ctx.fillStyle = FG
  setFont(ctx, 700, 560, -20)
  ctx.textAlign = 'center'
  ctx.fillText(String(rank), REPLAY_W / 2 + shift, CARD_Y + 200)
  ctx.restore()
}

function pullFrame(
  ctx: CanvasRenderingContext2D,
  scene: ReplayScene,
  index: number,
  rank: number,
  of: number,
  local: number,
  t: number,
  k: number
): void {
  const pull = scene.pulls[index]
  const art = scene.art[index]
  const best = rank === 1
  const flipAt = flipAtFor(rank)
  const revealed = local - (flipAt + FLIP_MS / 2)
  const prev = index > 0 ? { pull: scene.pulls[index - 1], art: scene.art[index - 1] } : null
  const handoff = prev ? ramp(local, 0, DEAL_MS) : 1

  // The new card's colour comes up through the old one's; brighter once the face is showing.
  const lit = revealed >= 0 ? easeOut(clamp01(revealed / 600)) : 0
  const washAlpha = 0.42 + lit * (best ? 0.3 : 0.14)
  backdrop(
    ctx,
    scene,
    [
      ...(prev && handoff < 1 ? [{ art: prev.art, alpha: 0.56 }] : []),
      { art, alpha: washAlpha * easeInOut(handoff) }
    ],
    t
  )

  const cardCenter = { x: REPLAY_W / 2, y: CARD_Y }
  if (best) rays(ctx, cardCenter.x, cardCenter.y, 0.16 * easeOut(clamp01(revealed / 700)), t)

  const deal = easeOut(ramp(local, 0, DEAL_MS))
  if (prev && handoff < 1)
    ghostNumber(ctx, rank + 1, of, -easeIn(handoff) * REPLAY_W * 0.5, 1 - handoff)
  ghostNumber(ctx, rank, of, index === 0 ? 0 : (1 - deal) * REPLAY_W * 0.5, index === 0 ? 1 : deal)

  if (prev && handoff < 1) {
    // The last pull at the end of its hold, carried on by the clock.
    const prevRank = rank + 1
    const prevLength = PULL_MS
    const pose = pullPose(index - 1, prevRank, prevLength, t, glowOf(prev.art))
    drawCard(ctx, prev.art, exiting(pose, handoff), k)
    pullText(ctx, prev.pull, prevLength, textAtFor(prevRank), 1 - clamp01(handoff * 2.5))
  }

  drawCard(ctx, art, pullPose(index, rank, local, t, glowOf(art)), k)

  if (best) {
    ring(ctx, cardCenter.x, cardCenter.y, revealed / RING_MS)
    sparks(ctx, cardCenter.x, cardCenter.y, revealed)
    const label = lineIn(local, textAtFor(rank))
    if (local >= textAtFor(rank)) {
      ctx.save()
      ctx.globalAlpha = label.a
      ctx.fillStyle = GOLD
      centredText(
        ctx,
        'TOP PULL OF THE SESSION',
        REPLAY_W / 2,
        122 + label.dy,
        700,
        18,
        REPLAY_W - 80,
        4
      )
      ctx.restore()
    }
  }

  pullText(ctx, pull, local, textAtFor(rank) + (best ? 120 : 0), 1)
  countLabel(ctx, rank, of, local, index)

  // The best pull lands with a flash.
  if (best && revealed >= 0 && revealed < FLASH_MS) {
    ctx.save()
    ctx.globalAlpha = 0.7 * (1 - revealed / FLASH_MS) ** 2
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, REPLAY_W, REPLAY_H)
    ctx.restore()
  }
}

// --- The closing card -------------------------------------------------------------------------

function endFrame(
  ctx: CanvasRenderingContext2D,
  scene: ReplayScene,
  local: number,
  t: number,
  k: number
): void {
  const best = scene.pulls.length - 1
  const art = scene.art[best]
  backdrop(ctx, scene, [{ art, alpha: 0.72 }], t)

  // The best card steps back and up to make room for the session's other hits.
  const move = easeInOut(ramp(local, 0, 700))
  const cy = CARD_Y + (END_Y - CARD_Y) * move
  rays(ctx, REPLAY_W / 2, cy, 0.16 * (1 - 0.5 * move), t)
  const held = pullPose(best, 1, 99999, t, glowOf(art))
  drawCard(
    ctx,
    art,
    {
      ...held,
      cy: held.cy + (END_Y - CARD_Y) * move,
      w: CARD_W + (END_W - CARD_W) * move,
      glowBlur: 100,
      sheen: null
    },
    k
  )
  pullText(ctx, scene.pulls[best], 99999, 0, 1 - clamp01(local / 250))

  // The rest fan out below it, one after another, cheapest on the left.
  const others = best
  const gap = 10
  const rowW = others * THUMB_W + (others - 1) * gap
  const mid = (others - 1) / 2
  for (let i = 0; i < others; i++) {
    const p = ramp(local, 380 + i * 70, 380)
    if (p <= 0) continue
    const s = easeOutBack(p)
    drawCard(
      ctx,
      scene.art[i],
      {
        cx: (REPLAY_W - rowW) / 2 + THUMB_W / 2 + i * (THUMB_W + gap),
        cy: REPLAY_H * 0.665 + (i - mid) ** 2 * 2.5 + (1 - p) * 30,
        w: THUMB_W * (0.6 + 0.4 * s),
        rot: (i - mid) * 0.045,
        sx: 1,
        face: true,
        alpha: clamp01(p * 2),
        glow: glowOf(scene.art[i]),
        glowBlur: 18,
        sheen: null
      },
      k
    )
  }

  const hits = scene.pulls.length
  const total = replayValue(scene.pulls)
  const line = lineIn(local, 300)
  if (local >= 300) {
    ctx.save()
    ctx.globalAlpha = line.a
    ctx.fillStyle = FG
    const shown = total * easeOut(ramp(local, 300, 650))
    centredText(
      ctx,
      plural(hits, 'hit', 'hits') + (total > 0 ? ` · ${formatUsd(shown)}` : ''),
      REPLAY_W / 2,
      REPLAY_H * 0.815 + line.dy,
      700,
      40,
      REPLAY_W - 80
    )
    ctx.restore()
  }
}

/** Waits for the app's font so the first frames aren't drawn in a fallback. */
export async function loadReplayFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(
    [500, 600, 700].map((w) => document.fonts.load(`${w} 36px 'IBM Plex Sans'`).catch(() => []))
  )
}

/** Paints the replay at `t` ms. Same inputs, same picture: no clock, no randomness. */
export function drawReplayFrame(
  ctx: CanvasRenderingContext2D,
  scene: ReplayScene,
  t: number
): void {
  const { segment, progress } = frameAt(scene.timeline, t)
  const local = progress * (segment.end - segment.start)
  const k = (typeof ctx.getTransform === 'function' && ctx.getTransform()?.a) || 1
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (segment.kind === 'pull')
    pullFrame(ctx, scene, segment.index, segment.rank, segment.of, local, t, k)
  else endFrame(ctx, scene, local, t, k)
  chip(ctx, scene.header)
  watermark(ctx, scene.logo)
}
