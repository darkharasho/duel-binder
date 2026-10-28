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
 * card is in view. A card whose art matches poorly (a holo, a full-art print, a case's glare)
 * flickers between recognized and far-art `none` frames, so one far-art `none` right after a
 * recognized frame counts as unsure; a second in a row is a real `none`.
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
  // A card was recognized, and no `none` frame has come since.
  let justSeen = false

  const clearStreak = (): void => {
    streakOf = null
    streak = 0
  }

  return {
    push(now, outcome) {
      if (outcome.kind === 'none' && outcome.far && justSeen) {
        justSeen = false
        absentSince = null
        return null
      }
      if (outcome.kind === 'unsure') {
        absentSince = null
        return null
      }
      if (outcome.kind === 'none') {
        justSeen = false
        clearStreak()
        absentSince ??= now
        if (now - absentSince >= absentMs) shown = null
        return null
      }
      absentSince = null
      justSeen = true
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
      justSeen = false
      shown = null
      absentSince = null
    }
  }
}
