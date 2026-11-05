import { formatUsd } from '@/lib/format'
import { plural } from '../scanText'
import type { ReplayPull } from './pulls'
import { frameAt, SLIDE_MS, type ReplayTimeline } from './timeline'

/** The replay's frame: 4:5, large in Discord on a phone and on a desktop. */
export const REPLAY_W = 720
export const REPLAY_H = 900

/** Everything a frame is drawn from. `art[i]` is `pulls[i]`'s; the two always line up. */
export interface ReplayScene {
  pulls: ReplayPull[]
  art: ImageBitmap[]
  header: string
  timeline: ReplayTimeline
}

const WATERMARK = 'DUEL BINDER · RIP REPLAY'
const FONT = 'system-ui, sans-serif'
const GOLD = '#ffd77a'
const CARD_ASPECT = 88 / 63
const SHEEN_MS = 2200
const FLASH_MS = 250

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const easeOut = (n: number): number => 1 - (1 - n) ** 3

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

/** Text centred at x, shrunk until it fits `maxWidth`. */
function centredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  weight: number,
  size: number,
  maxWidth: number
): void {
  let px = size
  ctx.font = `${weight} ${px}px ${FONT}`
  while (px > 12 && ctx.measureText(text).width > maxWidth) {
    px -= 2
    ctx.font = `${weight} ${px}px ${FONT}`
  }
  ctx.textAlign = 'center'
  ctx.fillText(text, x, y)
}

function backdrop(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(
    REPLAY_W / 2,
    REPLAY_H * 0.3,
    0,
    REPLAY_W / 2,
    REPLAY_H * 0.3,
    REPLAY_H * 0.8
  )
  g.addColorStop(0, '#2a1e4a')
  g.addColorStop(1, '#0d0a18')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, REPLAY_W, REPLAY_H)
}

/** A card's art with its glow and the sweeping sheen, centred on (cx, cy). */
function card(
  ctx: CanvasRenderingContext2D,
  art: ImageBitmap,
  cx: number,
  cy: number,
  width: number,
  t: number
): void {
  const w = width
  const h = w * CARD_ASPECT
  const x = cx - w / 2
  const y = cy - h / 2
  ctx.save()
  ctx.shadowColor = 'rgba(224, 86, 155, 0.55)'
  ctx.shadowBlur = 60
  ctx.fillStyle = '#000'
  roundedRect(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundedRect(ctx, x, y, w, h, 8)
  ctx.clip()
  ctx.drawImage(art, x, y, w, h)
  // The sheen: a white band crossing the card every SHEEN_MS.
  const p = (t % SHEEN_MS) / SHEEN_MS
  const bandX = x - w + p * w * 3
  const g = ctx.createLinearGradient(bandX, y, bandX + w * 0.6, y + h)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.5
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

function chip(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.font = `600 22px ${FONT}`
  const w = ctx.measureText(text).width + 36
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  roundedRect(ctx, 24, 24, w, 44, 22)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.fillText(text, 42, 54)
}

function watermark(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 0.38
  ctx.fillStyle = '#fff'
  ctx.font = `600 18px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(WATERMARK, REPLAY_W / 2, REPLAY_H - 22)
  ctx.globalAlpha = 1
}

function pullFrame(
  ctx: CanvasRenderingContext2D,
  scene: ReplayScene,
  index: number,
  rank: number,
  of: number,
  local: number,
  length: number,
  t: number
): void {
  const pull = scene.pulls[index]
  const inP = easeOut(clamp01(local / SLIDE_MS))
  const outP = clamp01((local - (length - SLIDE_MS)) / SLIDE_MS)
  const alpha = Math.min(inP, 1 - outP)
  const rise = (1 - inP) * 60 - outP * 40
  const scale = 0.8 + 0.2 * inP - 0.1 * outP

  ctx.fillStyle = 'rgba(255,255,255,0.56)'
  ctx.font = `600 22px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(`#${rank} of ${of}`, REPLAY_W - 28, 54)

  ctx.save()
  ctx.globalAlpha = alpha
  card(ctx, scene.art[index], REPLAY_W / 2, REPLAY_H * 0.44 + rise, REPLAY_W * 0.46 * scale, t)

  let y = REPLAY_H * 0.78 + rise
  if (pull.rarity) {
    ctx.fillStyle = GOLD
    centredText(ctx, pull.rarity.toUpperCase(), REPLAY_W / 2, y, 700, 22, REPLAY_W - 80)
    y += 42
  }
  ctx.fillStyle = '#fff'
  centredText(ctx, pull.name, REPLAY_W / 2, y, 700, 36, REPLAY_W - 80)
  y += 36
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  const price = formatUsd(pull.price) + (pull.quantity > 1 ? ` · ×${pull.quantity}` : '')
  centredText(ctx, price, REPLAY_W / 2, y, 500, 24, REPLAY_W - 80)
  ctx.restore()

  // The best pull lands with a flash.
  if (rank === 1 && local < FLASH_MS) {
    ctx.globalAlpha = 0.6 * (1 - local / FLASH_MS)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, REPLAY_W, REPLAY_H)
    ctx.globalAlpha = 1
  }
}

function endFrame(
  ctx: CanvasRenderingContext2D,
  scene: ReplayScene,
  local: number,
  t: number
): void {
  const best = scene.pulls.length - 1
  const inP = easeOut(clamp01(local / SLIDE_MS))
  ctx.save()
  ctx.globalAlpha = inP
  card(ctx, scene.art[best], REPLAY_W / 2, REPLAY_H * 0.42, REPLAY_W * 0.42, t)
  const hits = scene.pulls.length
  const total = scene.pulls.reduce((n, p) => n + p.price * p.quantity, 0)
  ctx.fillStyle = '#fff'
  centredText(
    ctx,
    `${plural(hits, 'hit', 'hits')} · ${formatUsd(total)}`,
    REPLAY_W / 2,
    REPLAY_H * 0.82,
    700,
    36,
    REPLAY_W - 80
  )
  ctx.restore()
}

/** Paints the replay at `t` ms. Same inputs, same picture: no clock, no randomness. */
export function drawReplayFrame(
  ctx: CanvasRenderingContext2D,
  scene: ReplayScene,
  t: number
): void {
  const { segment, progress } = frameAt(scene.timeline, t)
  const length = segment.end - segment.start
  const local = progress * length
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  backdrop(ctx)
  chip(ctx, scene.header)
  if (segment.kind === 'pull')
    pullFrame(ctx, scene, segment.index, segment.rank, segment.of, local, length, t)
  else endFrame(ctx, scene, local, t)
  watermark(ctx)
}
