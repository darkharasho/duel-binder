// The frames of a tilted card the scan worker keeps for reading its tilt: each straightened card
// shrunk to tiltFeatures' working size with when it was seen, the newest TILT_MAX_FRAMES of them
// (about 31 MB of RGB), so a long tilt can't grow the worker without bound.
import { TILT_MAX_FRAMES } from '@shared/scan/thresholds'
import { shrinkCard } from '@shared/scan/tiltFeatures'
import type { RgbaImage } from '@shared/scan/types'

export interface TiltFrames {
  /** Keeps an upright straightened card seen at `at` (ms), dropping the oldest past the cap. */
  keep(card: RgbaImage, at: number): void
  /** The kept frames from the last ms before now, oldest first. */
  latest(ms: number, now: number): Uint8Array[]
  clear(): void
  readonly size: number
}

export function createTiltFrames(max = TILT_MAX_FRAMES): TiltFrames {
  let kept: { at: number; rgb: Uint8Array }[] = []
  return {
    keep(card, at) {
      kept.push({ at, rgb: shrinkCard(card) })
      if (kept.length > max) kept.splice(0, kept.length - max)
    },
    latest(ms, now) {
      return kept.filter((f) => f.at > now - ms && f.at <= now).map((f) => f.rgb)
    },
    clear() {
      kept = []
    },
    get size() {
      return kept.length
    }
  }
}
