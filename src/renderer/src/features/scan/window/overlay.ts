import type { ScanDraft } from '../resolve'
import { priceRange, versionToPick } from '../scanLook'

export const NORMAL_MS = 4000
export const HIT_MS = 8000
export const FADE_MS = 250

export interface Pull {
  key: number
  name: string
  imageId: number
  setCode: string | null
  setName: string | null
  rarity: string | null
  price: number | null
  /** Its printings' price range, under the assumed price when the printing isn't certain. */
  range: { low: number; high: number } | null
  /** A graded slab, priced as the raw card. */
  raw: boolean
  hit: boolean
}

/**
 * A pull shows the drafted printing's price. A draft whose printing or rarity isn't certain also
 * shows its options' price range; a Pick printing draft shows no set or rarity and is never a hit.
 * A Pokémon card whose version is unsure shows only the range: its drafted printing is a
 * placeholder, so its price is no one version's.
 */
export function pullOf(d: ScanDraft, hitPrice: number, key: number): Pull {
  const picked = d.options.find((o) => o.printingId === d.printingId)
  const price = versionToPick(d) ? null : (picked?.price ?? null)
  const range = d.flag === 'pick-printing' || d.flag === 'check-rarity' ? priceRange(d) : null
  const base = { key, name: d.name, imageId: d.imageId, price, range, raw: d.slab === true }
  if (d.flag === 'pick-printing')
    return { ...base, setCode: null, setName: null, rarity: null, hit: false }
  return {
    ...base,
    setCode: d.setCode,
    setName: picked?.setName ?? null,
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
