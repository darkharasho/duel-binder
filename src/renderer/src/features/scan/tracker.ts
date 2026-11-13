import {
  ABSENT_MS,
  GUESS_STABLE_FRAMES,
  GUESS_SWAP_FRAMES,
  PHOTO_SETTLE_MS,
  RECENT_CARDS,
  STABLE_FRAMES
} from '@shared/scan/thresholds'
import type { ScanDraft, ScanOutcome } from './resolve'

export interface ShowingTracker {
  /** The draft to count, once per showing of a card, else null. */
  push(now: number, outcome: ScanOutcome): ScanDraft | null
  /**
   * Nothing counts until the view clears, or settleMs pass (a hand swapping cards may never clear
   * it): a card just counted some other way, which live frames may take for its twin. `cardId`,
   * the card that counted, if any, is shown from then on, so it never counts again while held.
   */
  settle(now: number, cardId?: number | null): void
  /**
   * The card last held back as counted lately (on a pile of scanned cards in view, say), until
   * a card counts or the view clears; else null.
   */
  heldBack(): ScanDraft | null
  reset(): void
}

/**
 * Turns per-frame outcomes into counted cards, one per showing. A card counts once it has been
 * recognized in stableFrames frames in a row. Frames are matched by card alone: the same card
 * read by its code in one frame and its art in the next, or matched to another of its artworks,
 * is still one showing, and never counts again while shown. It counts again only after nothing
 * has been in view, in consecutive `none` frames, for absentMs, or once a different card has
 * counted. A card that was one of the last recentCards to count doesn't count again either until
 * the view clears: a pile of scanned cards in view never clears it, and the card on top shows each
 * time the one held over it is lowered. Unsure frames neither build nor break a streak, but they break an absence, since a
 * card is in view. A card whose art matches poorly (a holo, a full-art print, a case's glare)
 * flickers between recognized and far-art `none` frames, so one far-art `none` right after a
 * recognized frame counts as unsure; a second in a row is a real `none`.
 *
 * A best guess has to hold for guessFrames, so the frames that may yet read its language or number
 * come first. As it can't be taken back, it holds for swapFrames while a card shown hasn't cleared:
 * a brief guess of another card there is more likely the same card's twin than a new one, but a
 * hand swapping cards may never empty the view. Any frame of the card shown starts it over.
 */
export function createShowingTracker(
  opts: {
    stableFrames?: number
    guessFrames?: number
    swapFrames?: number
    absentMs?: number
    settleMs?: number
    recentCards?: number
  } = {}
): ShowingTracker {
  const stableFrames = opts.stableFrames ?? STABLE_FRAMES
  const guessFrames = opts.guessFrames ?? GUESS_STABLE_FRAMES
  const swapFrames = opts.swapFrames ?? GUESS_SWAP_FRAMES
  const absentMs = opts.absentMs ?? ABSENT_MS
  const settleMs = opts.settleMs ?? PHOTO_SETTLE_MS
  const recentCards = opts.recentCards ?? RECENT_CARDS
  let streakOf: number | null = null
  let streak = 0
  let shown: number | null = null
  let absentSince: number | null = null
  let settledUntil = 0
  // The cards counted lately, newest first, since the view last cleared.
  let recent: number[] = []
  let held: ScanDraft | null = null
  // A card was recognized, and no `none` frame has come since.
  let justSeen = false

  const clearStreak = (): void => {
    streakOf = null
    streak = 0
  }
  const remember = (cardId: number): void => {
    recent = [cardId, ...recent.filter((id) => id !== cardId)].slice(0, recentCards)
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
        if (now - absentSince >= absentMs) {
          shown = null
          settledUntil = 0
          recent = []
          held = null
        }
        return null
      }
      absentSince = null
      justSeen = true
      if (now < settledUntil) return null
      const { cardId, guess } = outcome.item
      if (cardId === shown) {
        clearStreak()
        return null
      }
      streak = cardId === streakOf ? streak + 1 : 1
      streakOf = cardId
      const needed = !guess ? stableFrames : shown === null ? guessFrames : swapFrames
      if (streak < needed) return null
      clearStreak()
      if (recent.includes(cardId)) {
        held = outcome.item
        return null
      }
      shown = cardId
      held = null
      remember(cardId)
      return outcome.item
    },

    settle(now, cardId = null) {
      clearStreak()
      shown = cardId
      held = null
      if (cardId !== null) remember(cardId)
      settledUntil = now + settleMs
    },

    heldBack() {
      return held
    },

    reset() {
      clearStreak()
      settledUntil = 0
      justSeen = false
      shown = null
      absentSince = null
      recent = []
      held = null
    }
  }
}
