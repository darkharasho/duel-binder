import type { CropRect } from '../crop'
import type { Quad } from './detect'

/**
 * Frames in a row whose art matched nothing before the other framing is tried: the centre crop
 * gives way to the whole frame, and the whole frame back to the crop.
 */
export const FRAMING_SWITCH_AFTER = 3

/**
 * Which part of a live frame the worker reads. The centre crop (what the phone's and the
 * desktop's preview show) by default; a webcam whose card is held off to one side, as a stream
 * often is, never fills it, so after FRAMING_SWITCH_AFTER crops in a row that match no art, the
 * whole frame is read instead, and kept while it keeps matching. A crop that matches stays.
 */
export interface Framing {
  /** True when the next frame is read whole. */
  whole(): boolean
  /** How the frame just read went: whether its art matched. */
  record(matched: boolean): void
  /** Starts over at the centre crop (a new game or set). */
  reset(): void
}

export function framing(after = FRAMING_SWITCH_AFTER): Framing {
  let whole = false
  let missed = 0
  return {
    whole: () => whole,
    record(matched) {
      if (matched) {
        missed = 0
        return
      }
      if (++missed < after) return
      whole = !whole
      missed = 0
    },
    reset() {
      whole = false
      missed = 0
    }
  }
}

/** quad moved by (dx, dy). */
export function shiftQuad(quad: Quad, dx: number, dy: number): Quad {
  return quad.map(([x, y]) => [x + dx, y + dy]) as unknown as Quad
}

/**
 * quad, in whole-frame pixels, in region's own pixels; null when any corner falls outside it, as
 * an outline only partly in the crop can't be tried there.
 */
export function quadInRegion(quad: Quad, region: CropRect): Quad | null {
  const inside = quad.every(
    ([x, y]) =>
      x >= region.x &&
      y >= region.y &&
      x <= region.x + region.width &&
      y <= region.y + region.height
  )
  return inside ? shiftQuad(quad, -region.x, -region.y) : null
}
