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

/** The rarity to caption: the printing's as printed (a Pokémon card's), else the row's. */
function rarityOf(row: ScanRow): string | null {
  const own = row.options.find((o) => o.printingId === row.printingId)
  return own?.printedRarity ?? row.rarity
}

/**
 * The night's pulls for a replay, by price alone: every one at $1.00 or more that is known to be
 * in hand, the dearest 8 at most, in play order (cheapest first, so the best comes last). Equal
 * prices play in the order they were pulled.
 */
export function pickReplayPulls(rows: ScanRow[]): ReplayPull[] {
  const pulls: ReplayPull[] = []
  for (const row of rows) {
    const price = priceOf(row)
    if (row.guess || price == null || price < REPLAY_MIN_PRICE) continue
    pulls.push({
      key: row.key,
      name: row.name,
      imageId: row.imageId,
      photoId: photoFor(row),
      rarity: rarityOf(row),
      setCode: row.setCode,
      price,
      quantity: row.quantity,
      addedAt: row.addedAt
    })
  }
  // Dearest first to keep the best 8, earlier pulls first among equals; then turned for play.
  pulls.sort((a, b) => b.price - a.price || b.addedAt - a.addedAt)
  return pulls.slice(0, REPLAY_MAX_PULLS).reverse()
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
