// How often the live scanner pays for the holder search (candidates.ts lookAgain). It adds
// several hundred ms to a frame whose art matched nothing, and a camera shows such frames
// continually while no card is held up, so only every HOLDER_EVERY'th one in a row gets it.
import { ART_MAX_DISTANCE } from '@shared/scan/thresholds'

export const HOLDER_EVERY = 3

export interface HolderBudget {
  /** Whether the next frame may run the holder search. */
  allow(): boolean
  /** Records the frame just analysed: its closest art distance, or null when it had none. */
  record(distance: number | null): void
}

/**
 * The first unmatched frame after a match (or the start) may search; the next HOLDER_EVERY - 1
 * unmatched ones may not. A matched frame starts the count over, so a card put down and another
 * held up is looked for at once.
 */
export function holderBudget(): HolderBudget {
  let unmatched = 0
  return {
    allow: () => unmatched % HOLDER_EVERY === 0,
    record(distance) {
      unmatched = distance !== null && distance <= ART_MAX_DISTANCE ? 0 : unmatched + 1
    }
  }
}
