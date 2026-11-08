import { chaseTier } from '@shared/chaseRarity'
import type { GameId } from '@shared/games'
import { formatUsd } from '@/lib/format'
import { listValue, photoFor, priceOf, printingOf } from '../scanLook'
import { plural } from '../scanText'
import type { ScanRow } from '../session'

/** Anything under a dollar is bulk: it never makes a replay. */
export const REPLAY_MIN_PRICE = 1
/** A replay shows this many pulls at most, the dearest ones. */
export const REPLAY_MAX_PULLS = 8

/** One pull a replay shows. `price` is one copy's: null, or under $1, for a pull its rarity earned. */
export interface ReplayPull {
  key: string
  name: string
  imageId: number
  photoId: number | null
  rarity: string | null
  setCode: string | null
  price: number | null
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

/** What the replay's pulls are worth: the priced ones, every copy. */
export const replayValue = (pulls: ReplayPull[]): number =>
  pulls.reduce(
    (n, p) => n + (p.price !== null && p.price >= REPLAY_MIN_PRICE ? p.price * p.quantity : 0),
    0
  )

const toPull = (c: PullCandidate): ReplayPull => ({
  key: c.key,
  name: c.name,
  imageId: c.imageId,
  photoId: c.photoId,
  rarity: c.rarity,
  setCode: c.setCode,
  price: c.price,
  quantity: c.quantity,
  addedAt: c.addedAt
})

/**
 * The pulls a replay shows. First by price: every one at $1.00 or more that is known to be in
 * hand, the dearest 8 at most. Places left over go to chase rarities with no price, or under $1
 * (a Secret Rare, an overframe, an ex), the top rarities first, then the earliest pulled. In play
 * order: the rarity pulls first, then the priced ones cheapest first, so the dearest comes last.
 * Equal prices play in the order they were pulled.
 */
export function choosePulls(candidates: PullCandidate[], game?: GameId): ReplayPull[] {
  const known = candidates.filter((c) => !c.guess)
  const priced = known.filter((c) => c.price !== null && c.price >= REPLAY_MIN_PRICE)
  // Dearest first to keep the best 8, earlier pulls first among equals; then turned for play.
  priced.sort((a, b) => (b.price ?? 0) - (a.price ?? 0) || b.addedAt - a.addedAt)
  const kept = priced.slice(0, REPLAY_MAX_PULLS).reverse()
  const room = REPLAY_MAX_PULLS - kept.length
  if (room <= 0) return kept.map(toPull)
  const rare = known
    .filter((c) => c.price === null || c.price < REPLAY_MIN_PRICE)
    .map((c) => ({ c, tier: chaseTier(game, c.rarity, c.name) }))
    .filter((r) => r.tier > 0)
  rare.sort((a, b) => b.tier - a.tier || a.c.addedAt - b.c.addedAt)
  const rarest = rare
    .slice(0, room)
    .reverse()
    .map((r) => r.c)
  return [...rarest, ...kept].map(toPull)
}

/** The session's pulls for a replay (see `choosePulls`). */
export function pickReplayPulls(rows: ScanRow[]): ReplayPull[] {
  const candidates: PullCandidate[] = []
  for (const row of rows) {
    // No printing yet (a version still to pick): nothing known to show, price or rarity.
    if (printingOf(row) === null) continue
    const price = priceOf(row) ?? null
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
  return choosePulls(candidates, rows[0]?.game ?? 'ygo')
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
