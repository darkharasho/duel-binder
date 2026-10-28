// Exploration: dumps texture statistics per card region for every item, for choosing cues.
//   node out/rarity/features.mjs <items.json> <out.jsonl> [shrink=2]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import type { RgbaImage } from '@shared/scan/types'
import { findTextLine } from '../../../src/renderer/src/features/scan/vision/bands'
import { crop, NAME_BAND } from '../../../src/renderer/src/features/scan/vision/regions'
import { rarityCues } from '../../../src/renderer/src/features/scan/vision/rarityCues'
import { planes, regionStats, type Box } from './explore'
import { loadImage } from './load'
import { surface } from '../../../src/renderer/src/features/scan/vision/foil'

const REGIONS: Record<string, Box> = {
  frameL: [0.025, 0.2, 0.085, 0.68],
  frameR: [0.915, 0.2, 0.975, 0.68],
  art: [0.14, 0.2, 0.87, 0.68],
  text: [0.09, 0.78, 0.91, 0.89],
  name: [0.06, 0.045, 0.8, 0.1],
  under: [0.1, 0.72, 0.6, 0.755]
}

/** Mean colour of the name's ink and of the bar around it, plus the ink's colour spread. */
function nameColours(card: RgbaImage): Record<string, number> | null {
  const line = findTextLine(card, NAME_BAND, 1)
  if (!line || line.blobs.length < 5) return null
  const band = crop(card, NAME_BAND)
  const ink = new Set(line.blobs.flatMap((b) => b.pixels))
  const x0 = Math.min(...line.blobs.map((b) => b.x0))
  const x1 = Math.max(...line.blobs.map((b) => b.x1))
  const y0 = Math.min(...line.blobs.map((b) => b.y0))
  const y1 = Math.max(...line.blobs.map((b) => b.y1))
  const s = { i: [0, 0, 0, 0], b: [0, 0, 0, 0] }
  let ich = 0
  let ich2 = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * band.width + x
      const r = band.data[p * 4]
      const g = band.data[p * 4 + 1]
      const b = band.data[p * 4 + 2]
      const t = ink.has(p) ? s.i : s.b
      t[0] += r
      t[1] += g
      t[2] += b
      t[3]++
      if (t === s.i) {
        const c = Math.max(r, g, b) - Math.min(r, g, b)
        ich += c
        ich2 += c * c
      }
    }
  if (!s.i[3] || !s.b[3]) return null
  const m = (a: number[]): number[] => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]
  const [ir, ig, ib] = m(s.i)
  const [br, bg, bb] = m(s.b)
  const L = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b
  const n = s.i[3]
  return {
    sign: line.sign,
    blobs: line.blobs.length,
    rival: line.rivalBlobs,
    inkL: L(ir, ig, ib),
    barL: L(br, bg, bb),
    inkChroma: Math.max(ir, ig, ib) - Math.min(ir, ig, ib),
    barChroma: Math.max(br, bg, bb) - Math.min(br, bg, bb),
    inkPixChroma: ich / n,
    inkPixChromaSd: Math.sqrt(Math.max(0, ich2 / n - (ich / n) ** 2)),
    inkRB: ir - ib,
    barRB: br - bb,
    inkRG: ir - ig,
    barRG: br - bg
  }
}

const [itemsPath, out, shrink] = process.argv.slice(2)
const f = Number(shrink ?? 2)
writeFileSync(out, '')
for (const item of JSON.parse(readFileSync(itemsPath, 'utf8')) as {
  key: string
  upright: string
}[]) {
  const card = loadImage(item.upright)
  const stats =
    f > 0
      ? Object.fromEntries(
          Object.entries(REGIONS).map(([k, b]) => [k, regionStats(planes(card, f), b)])
        )
      : {}
  appendFileSync(
    out,
    JSON.stringify({
      ...item,
      cues: rarityCues(card),
      stats,
      nameC: nameColours(card),
      surface: surface(card)
    }) + '\n'
  )
}
