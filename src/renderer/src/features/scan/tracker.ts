import { ABSENT_MS, STABLE_FRAMES } from '@shared/scan/thresholds'
import type { ScanDraft, ScanOutcome } from './resolve'

export interface ShowingTracker {
  /** The draft to count, once per showing of a card, else null. */
  push(now: number, outcome: ScanOutcome): ScanDraft | null
  reset(): void
}

/**
 * Turns per-frame outcomes into counted cards, one per showing. A card counts once it has been
 * recognized in stableFrames frames in a row. Frames are matched by card alone: the same card
 * read by its code in one frame and its art in the next, or matched to another of its artworks,
 * is still one showing, and never counts again while shown. It counts again only after nothing
 * has been in view, in consecutive `none` frames, for absentMs, or once a different card has
 * counted. Unsure frames neither build nor break a streak, but they break an absence, since a
 * card is in view.
 */
export function createShowingTracker(
  opts: { stableFrames?: number; absentMs?: number } = {}
): ShowingTracker {
  const stableFrames = opts.stableFrames ?? STABLE_FRAMES
  const absentMs = opts.absentMs ?? ABSENT_MS
  let streakOf: number | null = null
  let streak = 0
  let shown: number | null = null
  let absentSince: number | null = null

  const clearStreak = (): void => {
    streakOf = null
    streak = 0
  }

  return {
    push(now, outcome) {
      if (outcome.kind === 'unsure') {
        absentSince = null
        return null
      }
      if (outcome.kind === 'none') {
        clearStreak()
        absentSince ??= now
        if (now - absentSince >= absentMs) shown = null
        return null
      }
      absentSince = null
      const { cardId } = outcome.item
      if (cardId === shown) {
        clearStreak()
        return null
      }
      streak = cardId === streakOf ? streak + 1 : 1
      streakOf = cardId
      if (streak < stableFrames) return null
      shown = cardId
      clearStreak()
      return outcome.item
    },

    reset() {
      clearStreak()
      shown = null
      absentSince = null
    }
  }
}
