import { ABSENT_MS, STABLE_FRAMES } from '@shared/scan/thresholds'
import type { ScanDraft, ScanOutcome } from './resolve'

export interface ShowingTracker {
  /** The draft to count, once per showing of a card, else null. */
  push(now: number, outcome: ScanOutcome): ScanDraft | null
  reset(): void
}

const identity = (d: ScanDraft): string => `${d.cardId}:${d.imageId}:${d.printingId}`

/**
 * Turns per-frame outcomes into counted cards. A card counts once it has been recognized the same
 * way in stableFrames frames in a row; it counts again only after nothing has been in view for
 * absentMs, or once a different card has counted. Unsure frames are skipped: they neither build
 * nor break a streak, but they do break an absence, since a card is in view.
 */
export function createShowingTracker(
  opts: { stableFrames?: number; absentMs?: number } = {}
): ShowingTracker {
  const stableFrames = opts.stableFrames ?? STABLE_FRAMES
  const absentMs = opts.absentMs ?? ABSENT_MS
  let streakOf: string | null = null
  let streak = 0
  let shown: string | null = null
  let absentSince: number | null = null

  const checkAbsence = (now: number): void => {
    if (absentSince !== null && now - absentSince >= absentMs) shown = null
  }

  return {
    push(now, outcome) {
      if (outcome.kind === 'unsure') {
        absentSince = null
        return null
      }
      if (outcome.kind === 'none') {
        streakOf = null
        streak = 0
        absentSince ??= now
        checkAbsence(now)
        return null
      }
      checkAbsence(now)
      absentSince = null
      const id = identity(outcome.item)
      streak = id === streakOf ? streak + 1 : 1
      streakOf = id
      if (streak < stableFrames || id === shown) return null
      shown = id
      return outcome.item
    },

    reset() {
      streakOf = null
      streak = 0
      shown = null
      absentSince = null
    }
  }
}
