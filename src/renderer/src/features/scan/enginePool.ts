import type { ScanEngine } from './engine'

/**
 * Several scan engines, each with its own vision worker, run as one: live frames go to the one
 * with the fewest frames in hand, so a slow phone matches two frames' art at once. `lanes` is how
 * many there are; the scan loop keeps that many frames in the workers.
 *
 * The first engine is the main one: it alone keeps frames for the tilt reading (a frame sent
 * with `tilt` always goes to it), and answers artDistance and tiltReading. A frame is analysed by
 * exactly one engine, so its timings and signals are as one engine's.
 */
export function createEnginePool(engines: ScanEngine[]): ScanEngine & { lanes: number } {
  if (!engines.length) throw new Error('An engine pool needs an engine')
  const [main] = engines
  const busy = engines.map(() => 0)

  const pick = (): number => {
    let best = 0
    for (let i = 1; i < engines.length; i++) if (busy[i] < busy[best]) best = i
    return best
  }

  return {
    lanes: engines.length,

    init(fp, refs) {
      // Each worker is handed its own copy: the buffer is transferred, not shared.
      const copies = engines.map((_, i) => (fp && i > 0 ? fp.slice(0) : fp))
      return Promise.all(engines.map((e, i) => e.init(copies[i], refs))).then(() => {})
    },

    async analyze(frame, opts) {
      const i = opts.tilt ? 0 : pick()
      busy[i]++
      try {
        return await engines[i].analyze(frame, opts)
      } finally {
        busy[i]--
      }
    },

    scope(imageIds) {
      for (const e of engines) e.scope(imageIds)
    },

    ...(main.artDistance ? { artDistance: (a, b) => main.artDistance!(a, b) } : {}),
    ...(main.tiltReading ? { tiltReading: (game, now) => main.tiltReading!(game, now) } : {}),
    ...(main.tiltReset ? { tiltReset: () => main.tiltReset!() } : {}),

    dispose() {
      for (const e of engines) e.dispose()
    }
  }
}
