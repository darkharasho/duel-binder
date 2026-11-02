// Times the background rarity read's two costs, after a warm-up pass so the JIT has settled:
// shrinkCard on each kept frame (what the scan worker adds per live frame while a read is on) and
// tiltFeatures on each reading (TILT_MIN_FRAMES..frames on the runtime grid). Prints the median and
// p90 in ms over every clip.
//
//   node out/rarity/bench-read.mjs <frames dir> [clips=20] [game=pkm]
//
// The frames dir holds one directory per clip: frames.jsonl (one line per extracted frame: n, good)
// and f<nnn>.jpg, the straightened card of each good frame, as fit-tilt reads them.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameId } from '@shared/games/types'
import { shrinkCard, tiltFeatures } from '@shared/scan/tiltFeatures'
import { TILT_MIN_FRAMES } from '@shared/scan/thresholds'
import { loadImage } from './load'

const [dir, count, gameArg] = process.argv.slice(2)
if (!dir) throw new Error('usage: bench-read.mjs <frames dir> [clips=20] [game=pkm]')
const game = (gameArg ?? 'pkm') as GameId
const clips = readdirSync(dir)
  .filter((c) => existsSync(join(dir, c, 'frames.jsonl')))
  .sort()
  .slice(0, Number(count ?? 20))

const frameFile = (clip: string, n: number): string =>
  join(dir, clip, `f${String(n).padStart(3, '0')}.jpg`)
const good = (clip: string): number[] =>
  readFileSync(join(dir, clip, 'frames.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { n: number; good: boolean })
    .filter((f) => f.good && existsSync(frameFile(clip, f.n)))
    .map((f) => f.n)

// A reading on the live grid has about TILT_MS / TILT_FRAME_MS kept frames; use the first
// TILT_MIN_FRAMES + 2 good frames of each clip, the size a usable reading has.
const PER_READING = TILT_MIN_FRAMES + 2
const cards = clips.map((c) => good(c).slice(0, PER_READING).map((n) => loadImage(frameFile(c, n))))

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const round = (x: number): number => Math.round(x * 100) / 100

const shrinkMs: number[] = []
const readMs: number[] = []
for (let pass = 0; pass < 2; pass++) {
  for (const frames of cards) {
    const small: Uint8Array[] = []
    for (const f of frames) {
      const t0 = performance.now()
      small.push(shrinkCard(f))
      if (pass) shrinkMs.push(performance.now() - t0)
    }
    if (small.length < TILT_MIN_FRAMES) continue
    const t0 = performance.now()
    tiltFeatures(small, game)
    if (pass) readMs.push(performance.now() - t0)
  }
}

console.log(`clips ${cards.length}, kept frames ${shrinkMs.length}, readings ${readMs.length}`)
console.log(`per kept frame (shrinkCard): median ${round(pct(shrinkMs, 0.5))} ms, p90 ${round(pct(shrinkMs, 0.9))} ms`)
console.log(`per reading (tiltFeatures): median ${round(pct(readMs, 0.5))} ms, p90 ${round(pct(readMs, 0.9))} ms`)
