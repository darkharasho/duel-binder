import { useEffect, useState } from 'react'
import type { ImageDownloads } from '@shared/types'
import { api } from '@/lib/api'

/** Fewer downloads than this (a panel's card, a handful of thumbnails) aren't worth a notice. */
export const MIN_SHOWN = 12
/** And none for a burst that's over this quickly. */
export const SHOW_AFTER_MS = 800

const busy = (d: ImageDownloads): boolean => d.cards.total > 0 || d.sets.total > 0

/**
 * The app's art downloads under way, as main reports them, once a burst has run SHOW_AFTER_MS
 * (null otherwise, and once the queue is empty).
 */
export function useImageDownloads(): ImageDownloads | null {
  const [latest, setLatest] = useState<ImageDownloads | null>(null)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.images.onDownloads((d) => {
      setLatest(d)
      if (!busy(d)) {
        if (timer) clearTimeout(timer)
        timer = null
        setSettled(false)
      } else timer ??= setTimeout(() => setSettled(true), SHOW_AFTER_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return settled && latest && busy(latest) ? latest : null
}

/** "card art", "set art" or "card and set art": what's downloading right now. */
export function downloadsLabel(d: ImageDownloads): string {
  const cards = d.cards.total > 0
  const sets = d.sets.total > 0
  return cards && sets ? 'card and set art' : sets ? 'set art' : 'card art'
}
