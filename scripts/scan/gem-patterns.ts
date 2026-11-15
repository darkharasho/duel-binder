/**
 * Builds src/shared/scan/gemPatterns.json, the Gem Pack pattern templates (gemPattern.ts): each the
 * average of its labelled photos' windows. Also scores every photo against templates made without
 * its own card's photos, the way a card never seen would be read, and prints what gemPattern names.
 *
 *   vite build --config scripts/catalog/vite.config.ts && node out/catalog/gem-patterns.mjs <labels.json> [--write]
 *
 * Run from the repo root. labels.json lists { "file", "card", "pattern" }: file an upright card PNG
 * (the scan's straightened card, 842x1228), card any id of the card it shows, pattern energy, ball,
 * master, stamp, or anything else for a version no template is made for (it is still scored, as a
 * check against false matches). Files are relative to labels.json. Without --write, nothing is
 * written.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import {
  gemPattern,
  gemScores,
  gemWindows,
  type GemPattern,
  type GemTemplates
} from '../../src/shared/scan/gemPattern'

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
  'src/shared/scan/gemPatterns.json'
)
const PATTERNS: GemPattern[] = ['energy', 'ball', 'master', 'stamp']

interface Label {
  file: string
  card: string
  pattern: string
}

/** The mean of windows, z-normalised again, rounded to 3 places. */
function average(windows: Float32Array[]): number[] {
  const out = new Float64Array(windows[0].length)
  for (const w of windows) for (let i = 0; i < w.length; i++) out[i] += w[i] / windows.length
  let sum = 0
  let sq = 0
  for (const v of out) {
    sum += v
    sq += v * v
  }
  const mean = sum / out.length
  const sd = Math.sqrt(Math.max(1e-9, sq / out.length - mean * mean))
  return [...out].map((v) => Math.round(((v - mean) / sd) * 1000) / 1000)
}

type Shot = Label & {
  img: { width: number; height: number; data: Uint8Array }
  win: ReturnType<typeof gemWindows>
}

function templatesOf(shots: Shot[]): GemTemplates {
  const of = (p: GemPattern): number[] => {
    const own = shots.filter((s) => s.pattern === p)
    if (!own.length) throw new Error(`no photos of ${p}`)
    return average(own.map((s) => (p === 'stamp' ? s.win.stamp : s.win.symbol)))
  }
  return { energy: of('energy'), ball: of('ball'), master: of('master'), stamp: of('stamp') }
}

function main(): void {
  const [labelsPath, flag] = process.argv.slice(2)
  if (!labelsPath) throw new Error('usage: gem-patterns <labels.json> [--write]')
  const base = dirname(resolve(labelsPath))
  const labels = JSON.parse(readFileSync(labelsPath, 'utf8')) as Label[]
  const shots: Shot[] = labels.map((l) => {
    const png = PNG.sync.read(readFileSync(join(base, l.file)))
    const img = { width: png.width, height: png.height, data: png.data }
    return { ...l, img, win: gemWindows(img) }
  })
  const tally: Record<string, { photos: number; named: number; wrong: number }> = {}
  for (const s of shots) {
    const t = templatesOf(shots.filter((o) => o.card !== s.card))
    const scores = gemScores(s.img, t)
    const named = gemPattern(scores)
    const truth = (PATTERNS as string[]).includes(s.pattern) ? s.pattern : 'other'
    const row = (tally[truth] ??= { photos: 0, named: 0, wrong: 0 })
    row.photos++
    if (named === s.pattern) row.named++
    else if (named) row.wrong++
    const mark = named === null ? '-' : named === s.pattern ? 'ok' : 'WRONG'
    console.log(`${s.file}\t${s.pattern}\t${named ?? '-'}\t${mark}\t${JSON.stringify(scores)}`)
  }
  console.table(tally)
  if (flag === '--write') {
    writeFileSync(OUT, JSON.stringify(templatesOf(shots)) + '\n')
    console.log(`wrote ${OUT}`)
  }
}

main()
