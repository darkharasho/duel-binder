import type { ScanDraft } from '../resolve'

export const NORMAL_MS = 4000
export const HIT_MS = 8000
export const FADE_MS = 250

export interface Pull {
  key: number
  name: string
  imageId: number
  setCode: string | null
  rarity: string | null
  price: number | null
  /** The top of a price range, for a pull whose printing isn't known; null for one price. */
  priceTo: number | null
  hit: boolean
}

/**
 * A Pick printing draft shows its name and the range of its printings' prices, and is never a
 * hit; otherwise the price is the drafted printing's.
 */
export function pullOf(d: ScanDraft, hitPrice: number, key: number): Pull {
  const base = { key, name: d.name, imageId: d.imageId }
  if (d.flag === 'pick-printing') {
    // Rows saved before prices existed have no `price` key at all.
    const prices = d.options.flatMap((o) => (o.price == null ? [] : [o.price]))
    const low = prices.length ? Math.min(...prices) : null
    const high = prices.length ? Math.max(...prices) : null
    return {
      ...base,
      setCode: null,
      rarity: null,
      price: low,
      priceTo: high !== low ? high : null,
      hit: false
    }
  }
  const price = d.options.find((o) => o.printingId === d.printingId)?.price ?? null
  return {
    ...base,
    setCode: d.setCode,
    rarity: d.rarity,
    price,
    priceTo: null,
    hit: price !== null && price >= hitPrice
  }
}

export interface OverlayState {
  showing: Pull | null
  until: number
  pending: Pull | null
}

export const NO_OVERLAY: OverlayState = { showing: null, until: 0, pending: null }

/** A new pull shows at once, except that a normal pull waits (latest only) behind a showing hit. */
export function pushPull(s: OverlayState, p: Pull, now: number): OverlayState {
  if (s.showing?.hit && now < s.until && !p.hit) return { ...s, pending: p }
  return { showing: p, until: now + (p.hit ? HIT_MS : NORMAL_MS), pending: p.hit ? s.pending : null }
}

/**
 * Expires what's showing at `until`. A hit with a normal pull waiting first shows nothing for
 * FADE_MS (so it fades out); the waiting pull then shows for NORMAL_MS from that moment.
 */
export function tickOverlay(s: OverlayState, now: number): OverlayState {
  if (!s.showing) {
    if (!s.pending || now < s.until) return s
    return { showing: s.pending, until: now + NORMAL_MS, pending: null }
  }
  if (now < s.until) return s
  if (s.pending) {
    return s.showing.hit
      ? { showing: null, until: s.until + FADE_MS, pending: s.pending }
      : { showing: s.pending, until: now + NORMAL_MS, pending: null }
  }
  return NO_OVERLAY
}
