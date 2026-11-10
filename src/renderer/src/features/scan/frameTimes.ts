/**
 * Where a live frame's time goes, in ms, for the phone's timing readout. `grab`: copying the
 * preview's crop off the camera (createImageBitmap). `pixels`: the worker reading the bitmap's
 * pixels back. `vision`: finding the card and matching its art. `ocr`: reading its text, on frames
 * that read any. `wait`: the rest of the trip to the worker and back (queueing, transfer). `lookup`:
 * naming the card from what was seen (resolveSignals). `outline`: grab start to the outline drawn.
 * `every`: one frame's start to the next's.
 */
export interface FrameTiming {
  grab: number
  pixels: number
  vision: number
  ocr: number
  wait: number
  lookup: number
  outline: number
  every: number
}

/** Frames the readout's medians are taken over: about two seconds of scanning. */
const WINDOW = 10

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Keeps the last WINDOW frames' times; `push` returns each part's median over them, rounded. */
export function createFrameTimes(): { push: (t: FrameTiming) => FrameTiming } {
  let frames: FrameTiming[] = []
  return {
    push(t) {
      frames = [...frames, t].slice(-WINDOW)
      const out = {} as FrameTiming
      for (const key of Object.keys(t) as (keyof FrameTiming)[])
        out[key] = Math.round(median(frames.map((f) => f[key])))
      return out
    }
  }
}
