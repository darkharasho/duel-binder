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
