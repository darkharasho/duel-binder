import { formatUsd } from '@/lib/format'
import { loadReplayArt, loadReplayLogo } from './art'
import { plural } from '../scanText'
import {
  backdrop,
  CARD_ASPECT,
  chip,
  drawCard,
  FG,
  glowOf,
  loadReplayFonts,
  GOLD,
  rarityPill,
  REPLAY_W,
  setFont,
  watermark,
  type ReplayScene
} from './draw'
import { REPLAY_MIN_PRICE, replayValue, type ReplayPull, type ReplaySource } from './pulls'
import { replayFileName, saveReplay, type SaveResult } from './save'

/** What the still is drawn from: the replay's scene without its timeline. */
export type StillScene = Pick<ReplayScene, 'pulls' | 'art' | 'header' | 'backdrop' | 'logo'>

/** The saved image: the replay's 4:5, half as large again so it stays sharp. */
export const STILL_W = 1080
export const STILL_H = 1350

/** Where one pull's card goes, in the replay's 720×900 frame. `top` is the card's top edge. */
export interface StillSlot {
  index: number
  tier: 'best' | 'side' | 'row'
  cx: number
  top: number
  w: number
}

const BEST_W = 250
const SIDE_W = 165
const ROW_W = 108
const ROW_GAP = 14
const SIDE_OFFSET = 223
const BEST_TOP = 92
const ROW_DROP = 136
/** The sides stand this far above the best card's bottom, so their captions clear its rarity. */
const SIDE_LIFT = 60
const TOTAL_Y = 826
/** With no row under the podium, everything comes down this far so the frame isn't top-heavy. */
const NO_ROW_SHIFT = 100
const NO_ROW_TOTAL_Y = 760

const heightOf = (w: number): number => w * CARD_ASPECT

/**
 * The podium: the dearest pull in the middle, #2 to its left and #3 to its right, standing a
 * little higher so their captions clear its rarity, then the rest in one row below, dearest on
 * the left. Pulls run cheapest first.
 */
export function podiumLayout(n: number): { slots: StillSlot[]; totalY: number } {
  const shift = n <= 3 ? NO_ROW_SHIFT : 0
  const bestTop = BEST_TOP + shift
  const bottom = bestTop + heightOf(BEST_W)
  const slots: StillSlot[] = []
  if (n >= 1) slots.push({ index: n - 1, tier: 'best', cx: REPLAY_W / 2, top: bestTop, w: BEST_W })
  const sideTop = bottom - SIDE_LIFT - heightOf(SIDE_W)
  if (n >= 2)
    slots.push({
      index: n - 2,
      tier: 'side',
      cx: REPLAY_W / 2 - SIDE_OFFSET,
      top: sideTop,
      w: SIDE_W
    })
  if (n >= 3)
    slots.push({
      index: n - 3,
      tier: 'side',
      cx: REPLAY_W / 2 + SIDE_OFFSET,
      top: sideTop,
      w: SIDE_W
    })
  const rest = Math.max(0, n - 3)
  const rowW = rest * ROW_W + (rest - 1) * ROW_GAP
  for (let i = 0; i < rest; i++)
    slots.push({
      index: n - 4 - i,
      tier: 'row',
      cx: (REPLAY_W - rowW) / 2 + ROW_W / 2 + i * (ROW_W + ROW_GAP),
      top: bottom + ROW_DROP,
      w: ROW_W
    })
  return { slots, totalY: n <= 3 ? NO_ROW_TOTAL_Y : TOTAL_Y }
}

/** The text, cut short with … until it fits `maxWidth`. */
export function ellipsize(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text
  let end = text.length
  while (end > 0 && measure(text.slice(0, end).trimEnd() + '…') > maxWidth) end--
  return text.slice(0, end).trimEnd() + '…'
}

/** The line under a card's name: its price and copies, or for a pull its rarity earned, the rarity. */
export function priceLine(pull: ReplayPull): string {
  const parts = [
    ...(pull.price !== null && pull.price >= REPLAY_MIN_PRICE ? [formatUsd(pull.price)] : []),
    ...(pull.quantity > 1 ? [`×${pull.quantity}`] : [])
  ]
  return parts.length ? parts.join(' · ') : (pull.rarity ?? '')
}

/** One line centred at x, cut to fit. */
function line(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  weight: number,
  px: number,
  colour: string,
  maxWidth: number
): void {
  if (!text) return
  setFont(ctx, weight, px)
  ctx.fillStyle = colour
  ctx.textAlign = 'center'
  ctx.fillText(
    ellipsize(text, maxWidth, (s) => ctx.measureText(s).width),
    x,
    y
  )
}

/** Caption sizes per tier: name and price weights and sizes, and how far below the card. */
const CAPTIONS = {
  side: { name: [600, 18], price: [600, 18], nameDy: 26, priceDy: 50, extra: 20 },
  row: { name: [500, 15], price: [600, 16], nameDy: 20, priceDy: 40, extra: 12 }
} as const

/**
 * The session's highlights as one picture: the podium of its best pulls, every one named and
 * priced, the total under them. The caller scales `ctx` to the replay's 720×900.
 */
export function drawHighlights(ctx: CanvasRenderingContext2D, scene: StillScene): void {
  const n = scene.pulls.length
  const { slots, totalY } = podiumLayout(n)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  backdrop(ctx, scene, n ? [{ art: scene.art[n - 1], alpha: 0.72 }] : [], 0)

  for (const s of slots) {
    const art = scene.art[s.index]
    const h = heightOf(s.w)
    const best = s.tier === 'best'
    drawCard(
      ctx,
      art,
      {
        cx: s.cx,
        cy: s.top + h / 2,
        w: s.w,
        rot: 0,
        sx: 1,
        face: true,
        alpha: 1,
        glow: glowOf(art),
        glowBlur: best ? 100 : 18,
        sheen: null
      },
      1.5
    )
  }

  for (const s of slots) {
    const pull = scene.pulls[s.index]
    const bottom = s.top + heightOf(s.w)
    if (s.tier === 'best') {
      let y = bottom + 40
      if (pull.rarity) {
        rarityPill(ctx, pull.rarity.toUpperCase(), y)
        y += 46
      } else y += 6
      line(ctx, pull.name, s.cx, y, 700, 30, FG, 600)
      line(ctx, priceLine(pull), s.cx, y + 34, 600, 26, GOLD, 600)
      continue
    }
    const c = CAPTIONS[s.tier]
    line(ctx, pull.name, s.cx, bottom + c.nameDy, c.name[0], c.name[1], FG, s.w + c.extra)
    line(
      ctx,
      priceLine(pull),
      s.cx,
      bottom + c.priceDy,
      c.price[0],
      c.price[1],
      GOLD,
      s.w + c.extra
    )
  }

  const total = replayValue(scene.pulls)
  line(
    ctx,
    plural(n, 'hit', 'hits') + (total > 0 ? ` · ${formatUsd(total)}` : ''),
    REPLAY_W / 2,
    totalY,
    700,
    36,
    FG,
    REPLAY_W - 80
  )
  chip(ctx, scene.header)
  watermark(ctx, scene.logo)
}

/** Makes the still and puts it on the device, the way a replay is saved. */
export type Still = (source: ReplaySource) => Promise<SaveResult>

/** The highlights still: load the art, draw it once at 1080×1350, save it as a PNG. */
export const makeHighlights: Still = async (source) => {
  const [loaded, logo] = await Promise.all([
    loadReplayArt(source.pulls),
    loadReplayLogo(),
    loadReplayFonts()
  ])
  if (loaded.pulls.length === 0) throw new Error("Couldn't load the card art")
  const canvas = document.createElement('canvas')
  canvas.width = STILL_W
  canvas.height = STILL_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Couldn't save the image")
  ctx.scale(STILL_W / REPLAY_W, STILL_W / REPLAY_W)
  drawHighlights(ctx, { ...loaded, logo, header: source.header, backdrop: 'deep' })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error("Couldn't save the image")
  return saveReplay(blob, replayFileName('png'))
}
