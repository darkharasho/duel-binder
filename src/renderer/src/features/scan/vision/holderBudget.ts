// How often the live scanner pays for the holder search (candidates.ts lookAgain), and for a
// Pokémon frame the inner frame search and the nudges too. They add seconds to a frame whose
// art matched nothing, and a camera shows such frames continually while no card is held up, so
// only every HOLDER_EVERY'th one in a row gets them. The nudges get the frame after the holder
// search's: together they held a frame up for 5 s, and the next card waited it out.
import { ART_MAX_DISTANCE } from '@shared/scan/thresholds'

export const HOLDER_EVERY = 3

export interface HolderBudget {
  /** Whether the next frame may run the holder search. */
  allow(): boolean
  /** Whether the next frame may nudge its outlines (candidates.ts nudgeOutline). */
  nudge(): boolean
  /** Records the frame just analysed: its closest art distance, or null when it had none. */
  record(distance: number | null): void
}

/**
 * The first unmatched frame after a match (or the start) may search, the second may nudge, and
 * the rest of each HOLDER_EVERY in a row may do neither. A matched frame starts the count over, so a card put down and another
 * held up is looked for at once.
 */
export function holderBudget(): HolderBudget {
  let unmatched = 0
  return {
    allow: () => unmatched % HOLDER_EVERY === 0,
    nudge: () => unmatched % HOLDER_EVERY === 1,
    record(distance) {
      unmatched = distance !== null && distance <= ART_MAX_DISTANCE ? 0 : unmatched + 1
    }
  }
}
