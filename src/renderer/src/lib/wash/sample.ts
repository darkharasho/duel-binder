import type { GameId } from '@shared/games'
import { cardImageSrc } from '@/lib/images'
import { type RGB, lch, toOklab, unlch } from './color'
import { type Families, familiesFromPixels } from './families'

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

/** The box of an image as SIZE x SIZE pixels; null if it won't load or the canvas is tainted. */
export function readPixels(src: string, box: ArtBox): Promise<RGB[] | null> {
  return new Promise((resolve) => {
    const img = new Image()
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

/** Saves a card, oldest first out past MAX_KEYS. Storage errors (private mode, quota) are ignored. */
function store(key: string, f: Families): void {
  try {
    const index = (JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as string[]).filter(
      (k) => k !== key
    )
    index.push(key)
    while (index.length > MAX_KEYS) localStorage.removeItem(index.shift()!)
    localStorage.setItem(key, JSON.stringify(f))
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    /* the memory cache still has it */
  }
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
  try {
    const src = cardImageSrc(game === 'ygo' ? 'cropped' : 'small', card.imageId)
    const pixels = await read(src, ART_BOX[game])
    if (!pixels || pixels.length === 0) return null
    const f = familiesFromPixels(pixels, card.frameType)
    sampleMemory.set(key, f)
    store(key, f)
    return f
  } catch {
    return null
  }
}

/** The first two colours of each game's glow (from ArtWash), for where there is no art to read. */
const GAME_COLOURS: Record<GameId, [RGB, RGB]> = {
  ygo: [[139, 92, 246], [245, 158, 11]],
  pkm: [[37, 99, 235], [250, 204, 21]],
  op: [[59, 130, 196], [234, 179, 8]],
  mtg: [[194, 65, 12], [245, 158, 11]]
}

export function gameFallback(game: GameId): Families {
  const [a, b] = GAME_COLOURS[game].map(toOklab)
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
