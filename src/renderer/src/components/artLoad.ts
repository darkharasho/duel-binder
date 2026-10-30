import { useCallback, useState } from 'react'

type Seen = 'fresh' | 'instant'

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
}

/** Tracks which of a component's images have loaded, by src, for the skeleton-then-fade look. */
export function useArtLoad(): ArtLoad {
  const [seen, setSeen] = useState<Record<string, Seen>>({})
  const mark = useCallback(
    (src: string, how: Seen) => setSeen((s) => (s[src] ? s : { ...s, [src]: how })),
    []
  )
  return {
    loaded: (src) => src in seen,
    className: (src) =>
      seen[src] === 'instant' ? '' : seen[src] === 'fresh' ? 'art-reveal' : 'art-loading',
    bind: (src) => ({
      onLoad: () => mark(src, 'fresh'),
      ref: (el) => {
        if (el?.complete && el.naturalWidth > 0) mark(src, 'instant')
      }
    })
  }
}
