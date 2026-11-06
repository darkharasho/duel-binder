import { useCallback, useState } from 'react'

type Seen = 'fresh' | 'instant'

/**
 * Images that have loaded once this session. A page switch unmounts every tile, so without this a
 * page shimmered and faded its art in again on every visit, even with the image in memory.
 */
const loadedOnce = new Set<string>()
/**
 * The last images loaded, held so Chromium keeps them in its memory cache: once no element shows
 * an image it may drop it, and the next visit asks main for it again. Small tiles, so a few hundred
 * is a few tens of MB at most.
 */
const KEEP = 400
const kept = new Map<string, HTMLImageElement>()

function remember(src: string): void {
  if (loadedOnce.has(src) && kept.has(src)) return
  loadedOnce.add(src)
  if (typeof Image === 'undefined') return
  kept.delete(src)
  const img = new Image()
  img.src = src
  kept.set(src, img)
  if (kept.size > KEEP) kept.delete(kept.keys().next().value!)
}

/** Whether `src` has loaded before this session, so it shows at once with no shimmer or fade. */
export const artLoadedOnce = (src: string): boolean => loadedOnce.has(src)

/** Records that `src` has loaded (for images that don't go through useArtLoad). */
export const markArtLoaded = remember

/** Tests: forget every loaded image. */
export function resetArtLoaded(): void {
  loadedOnce.clear()
  kept.clear()
}

export interface ArtLoad {
  /** Whether the image at `src` has loaded. */
  loaded(src: string): boolean
  /**
   * Classes for the image (or the frame it fills): a shimmer while it downloads, a fade once it
   * arrives, and nothing when it was already in memory (no fade every time a row remounts).
   */
  className(src: string): string
  /** Spread onto the `<img>` showing `src`. */
  bind(src: string): { onLoad: () => void; ref: (el: HTMLImageElement | null) => void }
  /** `lazy` unless the image has loaded before; that one loads at once, from memory. */
  loading(src: string, fallback?: 'lazy' | 'eager'): 'lazy' | 'eager'
}

/** Tracks which of a component's images have loaded, by src, for the skeleton-then-fade look. */
export function useArtLoad(): ArtLoad {
  const [seen, setSeen] = useState<Record<string, Seen>>({})
  const mark = useCallback((src: string, how: Seen) => {
    // Shown at once from memory: a load event after that mustn't start the fade.
    const was: Seen = loadedOnce.has(src) ? 'instant' : how
    remember(src)
    setSeen((s) => (s[src] ? s : { ...s, [src]: was }))
  }, [])
  const how = (src: string): Seen | undefined =>
    seen[src] ?? (loadedOnce.has(src) ? 'instant' : undefined)
  return {
    loaded: (src) => how(src) !== undefined,
    className: (src) => {
      const h = how(src)
      return h === 'instant' ? '' : h === 'fresh' ? 'art-reveal' : 'art-loading'
    },
    bind: (src) => ({
      onLoad: () => mark(src, 'fresh'),
      ref: (el) => {
        if (el?.complete && el.naturalWidth > 0) mark(src, 'instant')
      }
    }),
    loading: (src, fallback = 'lazy') => (loadedOnce.has(src) ? 'eager' : fallback)
  }
}
