import { formatUsd } from '@/lib/format'
import { listValue, photoFor, priceOf } from '../scanLook'
import { plural } from '../scanText'
import type { ScanRow } from '../session'

/** Anything under a dollar is bulk: it never makes a replay. */
export const REPLAY_MIN_PRICE = 1
/** A replay shows this many pulls at most, the dearest ones. */
export const REPLAY_MAX_PULLS = 8

/** One pull a replay shows. `price` is one copy's. */
export interface ReplayPull {
  key: string
  name: string
  imageId: number
  photoId: number | null
  rarity: string | null
  setCode: string | null
  price: number
  quantity: number
  addedAt: number
}

/** What a replay is made from: the pulls to show and the line under the logo. */
export interface ReplaySource {
  pulls: ReplayPull[]
  header: string
}

/** A pull before the choosing: `guess` marks one not known to be in hand. */
export interface PullCandidate extends ReplayPull {
  guess: boolean
}

/** The rarity to caption: the printing's as printed (a Pokémon card's), else the row's. */
export function rarityOf(row: ScanRow): string | null {
  const own = row.options.find((o) => o.printingId === row.printingId)
  return own?.printedRarity ?? row.rarity
}

/**
 * The pulls a replay shows, by price alone: every one at $1.00 or more that is known to be in
 * hand, the dearest 8 at most, in play order (cheapest first, so the best comes last). Equal
 * prices play in the order they were pulled.
 */
export function choosePulls(candidates: PullCandidate[]): ReplayPull[] {
  const pulls = candidates
    .filter((c) => !c.guess && c.price >= REPLAY_MIN_PRICE)
    .map((c): ReplayPull => ({
      key: c.key,
      name: c.name,
      imageId: c.imageId,
      photoId: c.photoId,
      rarity: c.rarity,
      setCode: c.setCode,
      price: c.price,
      quantity: c.quantity,
      addedAt: c.addedAt
    }))
  // Dearest first to keep the best 8, earlier pulls first among equals; then turned for play.
  pulls.sort((a, b) => b.price - a.price || b.addedAt - a.addedAt)
  return pulls.slice(0, REPLAY_MAX_PULLS).reverse()
}

/** The session's pulls for a replay (see `choosePulls`). */
export function pickReplayPulls(rows: ScanRow[]): ReplayPull[] {
  const candidates: PullCandidate[] = []
  for (const row of rows) {
    const price = priceOf(row)
    if (price == null) continue
    candidates.push({
      key: row.key,
      name: row.name,
      imageId: row.imageId,
      photoId: photoFor(row),
      rarity: rarityOf(row),
      setCode: row.setCode,
      price,
      quantity: row.quantity,
      addedAt: row.addedAt,
      guess: row.guess === true
    })
  }
  return choosePulls(candidates)
}

/** "Nov 4 · 142 cards · $310.00": the newest row's date, the cards and the list's value. */
export function replayHeader(rows: ScanRow[]): string {
  const newest = rows.reduce((t, r) => Math.max(t, r.addedAt), 0)
  const date = new Date(newest || Date.now()).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
  const cards = rows.reduce((n, r) => n + r.quantity, 0)
  return `${date} · ${plural(cards, 'card', 'cards')} · ${formatUsd(listValue(rows).value)}`
}

/** A replay source from the live scan list. */
export function replaySourceOfRows(rows: ScanRow[]): ReplaySource {
  return { pulls: pickReplayPulls(rows), header: replayHeader(rows) }
}
