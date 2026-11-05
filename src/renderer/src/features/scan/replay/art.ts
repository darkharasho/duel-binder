import logoSrc from '@/assets/logo.svg'
import { cardImageSrc, printingImageSrc } from '@/lib/images'
import type { ReplayPull } from './pulls'

/** The owner's own photo of the printing where there is one (desktop only), else the card's art. */
export function replayArtSrc(pull: ReplayPull): string {
  const photo = pull.photoId === null ? null : printingImageSrc(pull.photoId)
  return photo ?? cardImageSrc('full', pull.imageId)
}

/**
 * Fetched and decoded, never through an <img>: an image without CORS would taint the canvas, and a
 * tainted canvas records nothing.
 */
async function fetchBitmap(src: string): Promise<ImageBitmap> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Art ${res.status}`)
  return createImageBitmap(await res.blob())
}

/** Each pull's art, loaded together. A pull whose art won't load is dropped; the order holds. */
export async function loadReplayArt(
  pulls: ReplayPull[],
  load: (src: string) => Promise<ImageBitmap> = fetchBitmap
): Promise<{ pulls: ReplayPull[]; art: ImageBitmap[] }> {
  const results = await Promise.allSettled(pulls.map((p) => load(replayArtSrc(p))))
  const out: { pulls: ReplayPull[]; art: ImageBitmap[] } = { pulls: [], art: [] }
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    out.pulls.push(pulls[i])
    out.art.push(r.value)
  })
  return out
}

/** The logo's size in pixels, twice what the replay draws it at so it stays sharp. */
const LOGO_PX = 52

/**
 * The SVG drawn onto a canvas at a set size: the file has only a viewBox, which some browsers won't
 * decode to a bitmap. It's the app's own file, so the canvas stays clean.
 */
async function rasterLogo(src: string): Promise<CanvasImageSource> {
  const img = new Image(LOGO_PX, LOGO_PX)
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = LOGO_PX
  canvas.height = LOGO_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Couldn't draw the logo")
  ctx.drawImage(img, 0, 0, LOGO_PX, LOGO_PX)
  return canvas
}

/** The app's logo for the watermark; nothing if it won't load, and the replay goes on without it. */
export async function loadReplayLogo(
  load: (src: string) => Promise<CanvasImageSource> = rasterLogo
): Promise<CanvasImageSource | undefined> {
  return load(logoSrc).catch(() => undefined)
}
