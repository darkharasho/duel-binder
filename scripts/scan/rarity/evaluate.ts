// Stage two of the rarity evaluation: reads the upright cards extract.mjs saved, measures the
// scan worker's rarity cues on each and picks a rarity among the card's candidate printings'
// rarities the way the app does. Reports per source and true rarity how often it was picked,
// right or wrong, and how often it was left as "Check rarity", with a confusion matrix.
//
//   node out/rarity/evaluate.mjs [--json out.jsonl] <items.json>...
//
// items.json: [{ key, upright (path to the straightened card), rarity, available, frameType,
// source, photo? }]. Items whose available rarities are all one rarity are skipped: there is
// nothing to detect. A shot is one frame, so its cues are taken as if every frame of the showing
// agreed. eBay items with photo: false (flatbed scans) are reported as their own source.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pickRarityByCues, rarityFamily, type RarityCues } from '@shared/scan/rarity'
import { rarityCues } from '../../../src/renderer/src/features/scan/vision/rarityCues'
import { loadImage } from './load'

interface Item {
  key: string
  upright: string
  rarity: string
  available: string[]
  frameType: string
  source: string
  photo?: boolean | null
}

type Picker = {
  cues: (card: ReturnType<typeof loadImage>) => RarityCues
  pick: typeof pickRarityByCues
}

/** The cues and decision evaluated; evaluate-baseline.ts (local only) swaps in the old ones. */
export const PICKER: Picker = { cues: rarityCues, pick: pickRarityByCues }
export const LABEL = 'CURRENT'

const pad = (s: string | number, n: number): string => String(s).padStart(n)
const ABBREVIATIONS: [string, string][] = [
  ['Quarter Century Secret Rare', 'QCSR'],
  ['Prismatic Secret Rare', 'PScR'],
  ['Platinum Secret Rare', 'PlScR'],
  ["Prismatic Collector's Rare", 'PCR'],
  ['Prismatic Ultimate Rare', 'PUtR'],
  ["Collector's Rare", 'CR'],
  ['Premium Gold Rare', 'PGR'],
  ['Starlight Rare', 'StR'],
  ['Ultimate Rare', 'UtR'],
  ['Secret Rare', 'ScR'],
  ['Ultra Rare', 'UR'],
  ['Super Rare', 'SR'],
  ['Ghost Rare', 'GR'],
  ['Gold Rare', 'GdR'],
  ['Common', 'C'],
  ['Rare', 'R']
]
const short = (r: string): string => ABBREVIATIONS.find(([long]) => long === r)?.[1] ?? r

/** truth -> picked (or "flag") -> count */
type Confusion = Map<string, Map<string, number>>

function report(name: string, confusion: Confusion): void {
  const cols = [...new Set([...confusion.values()].flatMap((r) => [...r.keys()]))].sort((a, b) =>
    a === 'flag' ? 1 : b === 'flag' ? -1 : a.localeCompare(b)
  )
  console.log(`\n## ${name}\ntruth\\picked ${cols.map((c) => pad(c, 6)).join('')}`)
  for (const [truth, row] of [...confusion].sort())
    console.log(`${pad(truth, 12)} ${cols.map((c) => pad(row.get(c) ?? 0, 6)).join('')}`)
  console.log('rarity      n picked right precision flagged')
  let right = 0
  let picked = 0
  let total = 0
  for (const truth of [...confusion.keys()].sort()) {
    const row = confusion.get(truth)!
    const n = [...row.values()].reduce((a, b) => a + b, 0)
    const ok = row.get(truth) ?? 0
    const flagged = row.get('flag') ?? 0
    // Precision of picks *of* this rarity: right picks over every item picked as it.
    const asIt = [...confusion.values()].reduce((s, r) => s + (r.get(truth) ?? 0), 0)
    const precision = asIt ? `${((100 * ok) / asIt).toFixed(0)}% of ${asIt}` : '-'
    console.log(
      `${pad(truth, 6)} ${pad(n, 5)} ${pad(n - flagged, 6)} ${pad(ok, 5)} ${pad(precision, 10)} ${pad(((100 * flagged) / n).toFixed(0) + '%', 7)}`
    )
    right += ok
    picked += n - flagged
    total += n
  }
  console.log(
    `all: picked ${picked}/${total} (${((100 * picked) / (total || 1)).toFixed(0)}%), right ${right}/${picked} (${((100 * right) / (picked || 1)).toFixed(1)}% precision)`
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const jsonAt = args.indexOf('--json')
  const jsonPath = jsonAt === -1 ? null : args[jsonAt + 1]
  const paths = args.filter((a, i) => !a.startsWith('--') && (jsonAt === -1 || i !== jsonAt + 1))
  const picker: Picker = PICKER
  if (jsonPath) writeFileSync(jsonPath, '')
  const bySource = new Map<string, Confusion>()
  let ms = 0
  let measured = 0
  for (const path of paths) {
    const items = (JSON.parse(readFileSync(path, 'utf8')) as Item[]).filter(
      (i) => new Set(i.available.map(rarityFamily)).size > 1
    )
    for (const item of items) {
      const card = loadImage(item.upright)
      const t0 = performance.now()
      const cues = picker.cues(card)
      ms += performance.now() - t0
      measured++
      const { rarity, certain } = picker.pick(item.available, cues, item.frameType)
      const truth = short(rarityFamily(item.rarity))
      const picked = certain ? short(rarityFamily(rarity)) : 'flag'
      const source = item.photo === false ? `${item.source}-scan` : item.source
      const confusion = bySource.get(source) ?? new Map()
      bySource.set(source, confusion)
      const row = confusion.get(truth) ?? new Map<string, number>()
      row.set(picked, (row.get(picked) ?? 0) + 1)
      confusion.set(truth, row)
      if (jsonPath)
        appendFileSync(
          jsonPath,
          JSON.stringify({ ...item, picked: certain ? rarity : null, cues }) + '\n'
        )
    }
  }
  console.log(`${LABEL}: cues ${(ms / (measured || 1)).toFixed(1)} ms per card`)
  for (const [source, confusion] of [...bySource].sort()) report(source, confusion)
}

await main()
