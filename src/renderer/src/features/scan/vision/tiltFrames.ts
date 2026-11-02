// The frames of a tilted card the scan worker keeps for reading its tilt: each straightened card
// shrunk to tiltFeatures' working size with when it was captured, the newest TILT_MAX_FRAMES of
// them (about 31 MB of RGB), so a long tilt can't grow the worker without bound.
import type { ArtMatch } from '@shared/scan/fingerprintFile'
import type { ScanProfile } from '@shared/scan/profiles'
import { TILT_MAX_ART_DISTANCE, TILT_MAX_FRAMES } from '@shared/scan/thresholds'
import { shrinkCard } from '@shared/scan/tiltFeatures'
import type { RgbaImage } from '@shared/scan/types'

/**
 * A tilted card's kept frames. Times are the scan loop's clock (when it grabbed each frame), not
 * the worker's: a frame that waited behind a reading is still placed when it was seen.
 */
export interface TiltFrames {
  /** Keeps an upright straightened card captured at `at` (ms), dropping the oldest past the cap. */
  keep(card: RgbaImage, at: number): void
  /** The kept frames from the last ms before now, oldest first. */
  latest(ms: number, now: number): Uint8Array[]
  /** Forgets every kept frame. */
  clear(): void
  /** How many frames are kept. */
  readonly size: number
}

/**
 * Whether a frame whose closest artworks are art is kept for a tilt of the images in tilt: its
 * closest must be one of them, within TILT_MAX_ART_DISTANCE.
 */
export function keepsForTilt(art: readonly ArtMatch[], tilt: readonly number[]): boolean {
  const top = art[0]
  return !!top && tilt.includes(top.imageId) && top.distance <= TILT_MAX_ART_DISTANCE
}

/**
 * Whether a frame tries the last frame's outline before searching: always for a profile that keeps
 * it, and for every game on a tilt frame. A held card barely moves, and the search is most of a
 * Yu-Gi-Oh frame's cost, which left too few frames in a tilt's window for a reading.
 */
export function keepsOutline(profile: Pick<ScanProfile, 'keepOutline'>, tilt: boolean): boolean {
  return profile.keepOutline || tilt
}

/** An empty store of at most max frames (TILT_MAX_FRAMES unless given). */
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
