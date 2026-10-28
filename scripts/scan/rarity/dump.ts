// Measures the scan worker's rarity cues and the look model's features on every upright card of
// the items files, once, so the decisions can be fitted and evaluated without decoding images
// again.
//
//   node out/rarity/dump.mjs <out.jsonl> <items.json>...
//
// One line per item: the item plus { cues: RarityCues, features: number[] | null, ms }. Re-runnable: keys
// already in out.jsonl are skipped. Images are decoded one at a time.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { rarityLook } from '../../../src/renderer/src/features/scan/vision/rarityCues'
import { loadImage } from './load'

const [out, ...paths] = process.argv.slice(2)
if (!out || !paths.length) throw new Error('usage: dump.mjs <out.jsonl> <items.json>...')
const done = new Set(
  existsSync(out)
    ? readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(
          (l) =>
            `${(JSON.parse(l) as { source: string }).source}/${(JSON.parse(l) as { key: string }).key}`
        )
    : []
)
let n = 0
let total = 0
for (const path of paths)
  for (const item of JSON.parse(readFileSync(path, 'utf8')) as {
    key: string
    source: string
    upright: string
  }[]) {
    if (done.has(`${item.source}/${item.key}`)) continue
    const card = loadImage(item.upright)
    const t0 = performance.now()
    const { cues, features } = rarityLook(card, true)
    const ms = performance.now() - t0
    total += ms
    const round = (v: number): number => Math.round(v * 1e5) / 1e5
    appendFileSync(
      out,
      JSON.stringify({
        ...item,
        cues,
        features: features?.map(round) ?? null,
        ms: Math.round(ms * 100) / 100
      }) + '\n'
    )
    if (++n % 200 === 0) console.log(`${n} (${(total / n).toFixed(1)} ms per card)`)
  }
console.log(`done ${n}, ${(total / (n || 1)).toFixed(2)} ms per card`)
