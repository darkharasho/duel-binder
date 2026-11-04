import { useEffect } from 'react'
import { cardImageSrc, printingImageSrc } from '@/lib/images'
import { isPhone } from '@/lib/platform'
import { gameOfId } from '@shared/games'
import { phonePrintingPhotoSrcs } from '@/lib/printingPhotos'

/** Art downloads the prefetcher keeps going at once; the page's own visible art isn't counted. */
const CONCURRENCY = 6
/** A page's art past this many tiles waits for the page to scroll to it, as before. */
const MAX_PREFETCH = 400

export interface PrefetchTile {
  imageId: number | null | undefined
  /** The tile's printing, whose photo replaces the card art where there is one. */
  printingId?: number | null
}

let queue: string[] = []
let running = 0
/** Each art asked for once per session: the browser's (or the desktop's) cache has it after. */
const fetched = new Set<string>()

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const src = queue.shift()!
    if (fetched.has(src)) continue
    fetched.add(src)
    running++
    const img = new Image()
    img.decoding = 'async'
    const done = (): void => {
      running--
      pump()
    }
    img.onload = done
    img.onerror = done
    img.src = src
  }
}

/** Replaces what's waiting with `srcs`: the page just opened is the one worth fetching for. */
export function prefetchArt(srcs: readonly string[]): void {
  queue = srcs.filter((s) => !fetched.has(s))
  pump()
}

/** The data saver is on: nothing is fetched ahead. */
const saveData = (): boolean =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true

async function srcsFor(tiles: readonly PrefetchTile[]): Promise<string[]> {
  const shown = tiles.slice(0, MAX_PREFETCH)
  const ygoPrintings = shown
    .filter((t) => t.imageId != null && gameOfId(t.imageId) !== 'pkm' && t.printingId != null)
    .map((t) => t.printingId!)
  // On the phone a photo is named by the server's printing id, looked up in one batch.
  const photos = isPhone()
    ? await phonePrintingPhotoSrcs(ygoPrintings, { small: true })
    : new Map(ygoPrintings.map((id) => [id, printingImageSrc(id, { small: true })]))
  const out: string[] = []
  for (const t of shown) {
    if (t.imageId == null) continue
    out.push(cardImageSrc('small', t.imageId))
    const photo = t.printingId != null ? photos.get(t.printingId) : null
    if (photo) out.push(photo)
  }
  return out
}

/**
 * Fetches a page's tile art in the background, in tile order, a few at a time, once the page is
 * idle: the first visit to a set then fills in ahead of the scroll instead of as each row nears
 * the screen. Leaving the page drops what hadn't started.
 */
export function useArtPrefetch(tiles: readonly PrefetchTile[]): void {
  useEffect(() => {
    if (tiles.length === 0 || saveData()) return
    let cancelled = false
    const start = (): void => {
      void srcsFor(tiles).then((srcs) => {
        if (!cancelled) prefetchArt(srcs)
      })
    }
    const idle = typeof requestIdleCallback === 'function'
    const id = idle ? requestIdleCallback(start, { timeout: 1000 }) : setTimeout(start, 300)
    return () => {
      cancelled = true
      if (idle) cancelIdleCallback(id as number)
      else clearTimeout(id as ReturnType<typeof setTimeout>)
      queue = []
    }
  }, [tiles])
}

/** Forgets what was fetched, for tests. */
export function resetArtPrefetch(): void {
  queue = []
  running = 0
  fetched.clear()
}
