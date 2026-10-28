// Times the per-frame rarity work on upright cards, after a warm-up pass so the JIT has settled:
// rarityCues as the scan worker runs it, its parts, and the look model's features on top.
//
//   node out/rarity/bench.mjs <items.json> [count=200]
import { readFileSync } from 'node:fs'
import { findTextLine } from '../../../src/renderer/src/features/scan/vision/bands'
import { surface } from '../../../src/renderer/src/features/scan/vision/foil'
import { rarityCues, rarityLook } from '../../../src/renderer/src/features/scan/vision/rarityCues'
import { rarityFeatures } from '../../../src/renderer/src/features/scan/vision/rarityFeatures'
import { crop, NAME_BAND } from '../../../src/renderer/src/features/scan/vision/regions'
import { loadImage } from './load'

const [path, count] = process.argv.slice(2)
const items = (JSON.parse(readFileSync(path, 'utf8')) as { upright: string }[]).slice(
  0,
  Number(count ?? 200)
)
const cards = items.map((i) => loadImage(i.upright))
const time = (f: (c: (typeof cards)[number]) => unknown): number => {
  const t0 = performance.now()
  for (const c of cards) f(c)
  return (performance.now() - t0) / cards.length
}
const runs: Record<string, (c: (typeof cards)[number]) => unknown> = {
  'rarityCues (the scan worker)': rarityCues,
  'rarityCues with look features': (c) => rarityLook(c, true),
  'name line': (c) => findTextLine(c, NAME_BAND, 1),
  'surface (round 1)': surface,
  'look features': (c) => rarityFeatures(c, findTextLine(c, NAME_BAND, 1), crop(c, NAME_BAND))
}
for (const f of Object.values(runs)) time(f)
for (const [name, f] of Object.entries(runs))
  console.log(`${name}: ${Math.min(time(f), time(f), time(f)).toFixed(2)} ms per card`)
