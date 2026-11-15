import type { GameId } from '@shared/games'
import { cardImageSrc } from '@/lib/images'
import { type RGB, lch, toOklab, unlch } from './color'
import { FRAME, type Families, familiesFromPixels } from './families'

export interface WashCard {
  imageId: number
  frameType?: string
}

export interface ArtBox {
  x: number
  y: number
  w: number
  h: number
}

const CARD_ART: ArtBox = { x: 0.08, y: 0.1, w: 0.84, h: 0.45 }
/** Fractions of the small image holding the art. Yu-Gi-Oh! reads `cropped`, which is all art. */
export const ART_BOX: Record<GameId, ArtBox> = {
  ygo: { x: 0, y: 0, w: 1, h: 1 },
  pkm: CARD_ART,
  op: CARD_ART,
  mtg: CARD_ART
}

const SIZE = 32

/** How long one image read may take before it counts as a miss. */
export const READ_TIMEOUT_MS = 4000

/** The box of an image as SIZE x SIZE pixels; null if it won't load, times out or the canvas is tainted. */
export function readPixels(
  src: string,
  box: ArtBox,
  timeoutMs = READ_TIMEOUT_MS
): Promise<RGB[] | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => {
      img.onload = img.onerror = null
      img.src = ''
      resolve(null)
    }, timeoutMs)
    const done = resolve
    resolve = (v) => {
      clearTimeout(timer)
      done(v)
    }
    img.crossOrigin = 'anonymous'
    img.onerror = () => resolve(null)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        const w = img.naturalWidth
        const h = img.naturalHeight
        ctx.drawImage(img, box.x * w, box.y * h, box.w * w, box.h * h, 0, 0, SIZE, SIZE)
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
        const out: RGB[] = []
        for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]])
        resolve(out)
      } catch {
        resolve(null)
      }
    }
    img.src = src
  })
}

const MAX_KEYS = 600
const INDEX_KEY = 'wash:v1:index'
const keyOf = (game: GameId, id: number): string => `wash:v1:${game}:${id}`
const missKeyOf = (game: GameId, id: number): string => `wash:v1:miss:${game}:${id}`
/** A card whose image could not be read is left alone for this long. */
export const MISS_TTL_MS = 24 * 60 * 60 * 1000

/** Sampled cards this session; localStorage keeps them between runs. */
export const sampleMemory = new Map<string, Families>()

function stored(key: string): Families | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const f = JSON.parse(raw) as Families
    return Array.isArray(f?.fams) && f.fams.length > 0 && Array.isArray(f.dark) ? f : null
  } catch {
    return null
  }
}

/** Failed reads this session (key to when), so a visit does not ask again. */
const missMemory = new Map<string, number>()

function recentlyMissed(key: string): boolean {
  let at = missMemory.get(key)
  if (at === undefined) {
    try {
      at = Number(localStorage.getItem(key))
    } catch {
      at = 0
    }
    if (at) missMemory.set(key, at)
  }
  return !!at && Date.now() - at < MISS_TTL_MS
}

/** Forgets failed reads (tests). */
export const clearMisses = (): void => missMemory.clear()

/** Saves an entry, oldest first out past MAX_KEYS. Storage errors (private mode, quota) are ignored. */
function store(key: string, value: unknown): void {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]')
    // A corrupt index (not a list) starts over rather than switching saving off for good.
    const index = (Array.isArray(parsed) ? (parsed as string[]) : []).filter((k) => k !== key)
    index.push(key)
    while (index.length > MAX_KEYS) localStorage.removeItem(index.shift()!)
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    /* the memory cache still has it */
  }
}

/**
 * A random card of this game read on an earlier visit (this run or a past one), for a page with no
 * cards of its own. Skips grey art. Null when none is remembered.
 */
export function rememberedCard(
  game: GameId,
  rand: () => number
): { imageId: number; families: Families } | null {
  const prefix = keyOf(game, 0).slice(0, -1)
  const keys = new Set([...sampleMemory.keys()].filter((k) => k.startsWith(prefix)))
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]')
    if (Array.isArray(parsed))
      for (const k of parsed) if (typeof k === 'string' && k.startsWith(prefix)) keys.add(k)
  } catch {
    /* memory only */
  }
  const pool = [...keys]
  for (let tries = 0; tries < 8 && pool.length > 0; tries++) {
    const key = pool.splice(Math.floor(rand() * pool.length), 1)[0]
    const imageId = Number(key.slice(prefix.length))
    const families = sampleMemory.get(key) ?? stored(key)
    if (families && !families.greyArt && Number.isFinite(imageId)) return { imageId, families }
  }
  return null
}

/** The colour families of a card's art, or null if its image can't be read. */
export async function sampleCard(
  card: WashCard,
  game: GameId,
  read: typeof readPixels = readPixels
): Promise<Families | null> {
  const key = keyOf(game, card.imageId)
  const hit = sampleMemory.get(key) ?? stored(key)
  if (hit) {
    sampleMemory.set(key, hit)
    return hit
  }
  const missKey = missKeyOf(game, card.imageId)
  if (recentlyMissed(missKey)) return null
  const miss = (): null => {
    const at = Date.now()
    missMemory.set(missKey, at)
    store(missKey, at)
    return null
  }
  try {
    const pixels = await read(sampleSrc(game, card.imageId), ART_BOX[game])
    if (!pixels || pixels.length === 0) return miss()
    let f = familiesFromPixels(pixels, card.frameType)
    // Grey art with no frame colour to lead (other games, unknown frames): the game's glow colours.
    if (f.greyArt && !(card.frameType && Object.hasOwn(FRAME, card.frameType)))
      f = { ...f, fams: gameFallback(game).fams }
    sampleMemory.set(key, f)
    store(key, f)
    return f
  } catch {
    return miss()
  }
}

/**
 * The art to read. Desktop asks ahead of the download queue (`?now`; the protocol sends CORS headers).
 * Elsewhere the read adds `?wash`: the grid shows the same image as a plain `<img>`, and a CORS
 * request must not be answered from that no-CORS copy in the HTTP cache (it would fail the check).
 */
function sampleSrc(game: GameId, imageId: number): string {
  const src = cardImageSrc(game === 'ygo' ? 'cropped' : 'small', imageId, { now: true })
  return src.includes('?') ? src : `${src}?wash`
}

/** The first two colours of each game's glow (from ArtWash), for where there is no art to read. */
const GAME_COLOURS: Record<GameId, [RGB, RGB]> = {
  ygo: [
    [139, 92, 246],
    [245, 158, 11]
  ],
  pkm: [
    [37, 99, 235],
    [250, 204, 21]
  ],
  op: [
    [59, 130, 196],
    [234, 179, 8]
  ],
  mtg: [
    [194, 65, 12],
    [245, 158, 11]
  ]
}

/**
 * The game's colours as a wash. With `rand`, both colours are turned round the colour wheel by the
 * same random amount, keeping their lightness, strength and the gap between them: for an empty page
 * with no card to read, so it isn't the same colour every time.
 */
export function gameFallback(game: GameId, rand?: () => number): Families {
  const turn = rand ? rand() * 360 : 0
  const [a, b] = GAME_COLOURS[game].map((rgb) => {
    const [L, C, H] = lch(toOklab(rgb))
    return unlch([L, C, (H + turn) % 360])
  })
  const [, c, h] = lch(a)
  return {
    fams: [
      { lab: a, share: 0.65 },
      { lab: b, share: 0.35 }
    ],
    dark: unlch([0.22, c * 0.4, h]),
    vivid: (c + lch(b)[1]) / 2,
    greyArt: false
  }
}
