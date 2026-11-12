/**
 * Measuring aid for MTG_PROFILE (src/shared/scan/profiles.ts); not shipped. Picks a few printings
 * of each Magic layout from a Scryfall bulk file, downloads their `large` images and draws the
 * profile's boxes on each, one PNG per card, to check every box is true on every card it covers.
 *
 *   node scripts/scan/mtg-regions.ts <out-dir> [all-cards.jsonl.gz]
 *
 * The bulk file is one Scryfall card object per line (default /var/tmp/scry/all-cards.jsonl.gz).
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

type Box = readonly [number, number, number, number]

/** scryfallArtUrl(id, 'full') (src/shared/imageSources.ts), inlined: Node's type stripping can't load extensionless imports. */
const scryfallLarge = (id: string): string => `https://cards.scryfall.io/large/front/${id[0]}/${id[1]}/${id}.jpg`

interface ScryCard {
  id: string
  set: string
  collector_number: string
  lang: string
  frame: string
  border_color: string
  full_art: boolean
  frame_effects?: string[]
  type_line?: string
  layout: string
  highres_image: boolean
  image_uris?: unknown
}

/** What to look for: a name for the sheet and a test on the card. */
const WANTED: [string, (c: ScryCard) => boolean][] = [
  ['2015 creature', (c) => c.frame === '2015' && isPlain(c) && /Creature/.test(c.type_line ?? '')],
  ['2015 instant', (c) => c.frame === '2015' && isPlain(c) && /^Instant/.test(c.type_line ?? '')],
  ['2015 planeswalker', (c) => c.frame === '2015' && isPlain(c) && /Planeswalker/.test(c.type_line ?? '')],
  ['2015 saga', (c) => c.frame === '2015' && c.layout === 'saga' && !c.frame_effects?.length],
  ['2015 borderless', (c) => c.frame === '2015' && c.border_color === 'borderless' && /Creature/.test(c.type_line ?? '')],
  ['2015 extended art', (c) => c.frame === '2015' && (c.frame_effects ?? []).includes('extendedart')],
  ['2015 full-art land', (c) => c.frame === '2015' && c.full_art && /Basic Land/.test(c.type_line ?? '')],
  ['2003', (c) => c.frame === '2003' && isPlain(c) && /Creature/.test(c.type_line ?? '')],
  ['1997', (c) => c.frame === '1997' && isPlain(c) && /Creature/.test(c.type_line ?? '')]
]

function isPlain(c: ScryCard): boolean {
  return c.layout === 'normal' && c.border_color === 'black' && !c.full_art && !c.frame_effects?.length
}

/** The boxes to check, with a colour each (RGB). */
const BOXES: [string, Box, [number, number, number]][] = [
  ['art', [0.11, 0.12, 0.89, 0.49], [255, 0, 0]],
  ['window 2015/2003', [0.075, 0.105, 0.925, 0.553], [0, 200, 0]],
  ['window planeswalker', [0.075, 0.1, 0.925, 0.497], [0, 120, 255]],
  ['window 1997', [0.104, 0.096, 0.9, 0.54], [255, 0, 255]],
  ['code info line', [0.025, 0.925, 0.5, 0.99], [255, 160, 0]],
  ['code copyright line', [0.2, 0.915, 0.85, 0.99], [0, 220, 220]],
  ['name', [0.06, 0.035, 0.7, 0.105], [255, 255, 0]],
  ['text', [0.08, 0.62, 0.92, 0.9], [160, 0, 255]],
  ['text frame', [0.067, 0.6, 0.933, 0.915], [255, 255, 255]]
]

async function pick(bulk: string): Promise<[string, ScryCard][]> {
  const found = new Map<string, ScryCard>()
  const lines = createInterface({ input: createReadStream(bulk).pipe(createGunzip()) })
  for await (const line of lines) {
    const text = line.replace(/,\s*$/, '')
    if (!text.startsWith('{')) continue
    const c = JSON.parse(text) as ScryCard
    if (c.lang !== 'en' || !c.highres_image || !c.image_uris) continue
    for (const [name, test] of WANTED) if (!found.has(name) && test(c)) found.set(name, c)
    if (found.size === WANTED.length) break
  }
  lines.close()
  return WANTED.flatMap(([name]) => (found.has(name) ? [[name, found.get(name)!] as [string, ScryCard]] : []))
}

function draw(img: { width: number; height: number; data: Uint8Array }, box: Box, rgb: number[]): void {
  const [x0, y0, x1, y1] = [box[0] * img.width, box[1] * img.height, box[2] * img.width, box[3] * img.height].map(Math.round)
  const put = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
    const i = (y * img.width + x) * 4
    img.data[i] = rgb[0]
    img.data[i + 1] = rgb[1]
    img.data[i + 2] = rgb[2]
  }
  for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) put(x, y)
  for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) put(x, y)
}

async function main(): Promise<void> {
  const [out, bulk = '/var/tmp/scry/all-cards.jsonl.gz'] = process.argv.slice(2)
  if (!out) throw new Error('usage: mtg-regions.ts <out-dir> [all-cards.jsonl.gz]')
  mkdirSync(out, { recursive: true })
  for (const [name, card] of await pick(bulk)) {
    const url = scryfallLarge(card.id)
    const res = await fetch(url, { headers: { 'User-Agent': 'DuelBinder/dev' } })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    const img = jpeg.decode(new Uint8Array(await res.arrayBuffer()), { useTArray: true })
    for (const [, box, rgb] of BOXES) draw(img, box, rgb)
    const png = new PNG({ width: img.width, height: img.height })
    png.data = Buffer.from(img.data)
    const file = join(out, `${name.replace(/\W+/g, '-')}-${card.set}-${card.collector_number}.png`)
    writeFileSync(file, PNG.sync.write(png))
    console.log(`${name}: ${card.set.toUpperCase()} ${card.collector_number} → ${file}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
