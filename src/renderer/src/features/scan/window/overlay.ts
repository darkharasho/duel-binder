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
  /** Its printings' price range, under the assumed price when the printing isn't certain. */
  range: { low: number; high: number } | null
  hit: boolean
}

/** The lowest and highest of the options' prices, when they differ. */
function rangeOf(d: ScanDraft): Pull['range'] {
  // Rows saved before prices existed have no `price` key at all.
  const prices = d.options.flatMap((o) => (o.price == null ? [] : [o.price]))
  if (!prices.length) return null
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  return low === high ? null : { low, high }
}

/**
 * A pull shows the drafted printing's price. A draft whose printing or rarity isn't certain also
 * shows its options' price range; a Pick printing draft shows no set or rarity and is never a hit.
 */
export function pullOf(d: ScanDraft, hitPrice: number, key: number): Pull {
  const price = d.options.find((o) => o.printingId === d.printingId)?.price ?? null
  const range = d.flag === 'pick-printing' || d.flag === 'check-rarity' ? rangeOf(d) : null
  const base = { key, name: d.name, imageId: d.imageId, price, range }
  if (d.flag === 'pick-printing') return { ...base, setCode: null, rarity: null, hit: false }
  return {
    ...base,
    setCode: d.setCode,
    rarity: d.rarity,
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
  return {
    showing: p,
    until: now + (p.hit ? HIT_MS : NORMAL_MS),
    pending: p.hit ? s.pending : null
  }
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
