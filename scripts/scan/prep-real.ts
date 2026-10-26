// Downloads the cropped artwork the real-photo scan test (tests/main/scan-real.test.ts) matches
// against: every artwork of every card in SCAN_REAL_DIR/truth.json plus a fixed random sample of
// distractors, into SCAN_REAL_DIR/cropped/ with cropped/index.json ({ imageId, cardId, frameType }[]).
// Run from the repo root: SCAN_REAL_DIR=<dir> node --experimental-strip-types scripts/scan/prep-real.ts
// Re-runnable: files already in cropped/ are kept. SCAN_ART_CACHE (colon-separated folders of
// <imageId>.jpg) is checked before downloading, so a second folder can reuse the first one's art.
// The photos are the owner's and stay out of the repo; so does everything this writes.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Node's type stripping can't resolve extensionless imports, so the app module is loaded by URL.
const { imageUrl } = (await import(
  new URL('../../src/shared/imageSources.ts', import.meta.url).href
)) as typeof import('../../src/shared/imageSources')

interface TruthEntry {
  file: string
  name: string | null
  cardId: number | null
  imageId: number | null
  imageCandidates?: number[]
}

interface CardInfo {
  id: number
  name: string
  frameType: string
  card_images: { id: number }[]
}

const DISTRACTORS = 1000
const SEED = 6

const DIR = process.env.SCAN_REAL_DIR
if (!DIR) throw new Error('Set SCAN_REAL_DIR to a folder holding truth.json and shot_*.jpg')
const OUT = join(DIR, 'cropped')
const CACHES = (process.env.SCAN_ART_CACHE ?? '').split(':').filter(Boolean)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** GET with a polite delay; backs off on 429/5xx and gives up after a few tries. */
async function get(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await sleep(120)
    const res = await fetch(url)
    if (res.ok || res.status === 404) return res
    await res.body?.cancel()
    if ((res.status !== 429 && res.status < 500) || attempt >= 5)
      throw new Error(`HTTP ${res.status} ${url}`)
    await sleep(2000 * 2 ** attempt)
  }
}

/** Seeded PRNG (mulberry32) so every run picks the same distractors. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

mkdirSync(OUT, { recursive: true })
const truth = JSON.parse(readFileSync(join(DIR, 'truth.json'), 'utf8')) as TruthEntry[]

const cardsFile = join(OUT, 'cardinfo.json')
if (!existsSync(cardsFile)) {
  console.log('Fetching the card list')
  const res = await get('https://db.ygoprodeck.com/api/v7/cardinfo.php')
  if (!res.ok) throw new Error(`Card list: HTTP ${res.status}`)
  writeFileSync(cardsFile, Buffer.from(await res.arrayBuffer()))
}
const cards = (JSON.parse(readFileSync(cardsFile, 'utf8')) as { data: CardInfo[] }).data
const byId = new Map(cards.map((c) => [c.id, c]))
const byName = new Map(cards.map((c) => [c.name.toLowerCase(), c]))
const byImage = new Map(cards.flatMap((c) => c.card_images.map((i) => [i.id, c] as const)))

// Every artwork of every truth card, plus any image the labels name directly.
const wanted = new Map<number, CardInfo>()
for (const t of truth) {
  const card =
    (t.cardId !== null ? byId.get(t.cardId) : undefined) ??
    (t.name !== null ? byName.get(t.name.toLowerCase()) : undefined)
  if (t.name !== null && !card) console.warn(`${t.file}: no card named ${t.name}`)
  if (card && t.cardId !== null && card.id !== t.cardId)
    console.warn(`${t.file}: ${t.name} is card ${card.id}, truth says ${t.cardId}`)
  if (card) for (const i of card.card_images) wanted.set(i.id, card)
  for (const id of [t.imageId, ...(t.imageCandidates ?? [])]) {
    const owner = id !== null ? byImage.get(id) : undefined
    if (owner) wanted.set(id!, owner)
  }
}
const targets = wanted.size
const truthImages = new Set(wanted.keys())
const rand = rng(SEED)
const pool = cards.filter((c) => c.frameType !== 'skill' && !wanted.has(c.card_images[0].id))
while (wanted.size < targets + DISTRACTORS && pool.length) {
  const [card] = pool.splice(Math.floor(rand() * pool.length), 1)
  wanted.set(card.card_images[0].id, card)
}

const index: { imageId: number; cardId: number; frameType: string }[] = []
let downloaded = 0
let missing = 0
for (const [imageId, card] of wanted) {
  const path = join(OUT, `${imageId}.jpg`)
  if (!existsSync(path)) {
    const cached = CACHES.map((d) => join(d, `${imageId}.jpg`)).find((p) => existsSync(p))
    if (cached) copyFileSync(cached, path)
    else {
      const res = await get(imageUrl('cropped', imageId))
      if (res.status === 404) {
        if (truthImages.has(imageId))
          console.warn(`No cropped art for ${card.name} (image ${imageId}); its shots can't match`)
        missing++
        continue
      }
      writeFileSync(path, Buffer.from(await res.arrayBuffer()))
      if (++downloaded % 100 === 0) console.log(`${downloaded} downloaded`)
    }
  }
  index.push({ imageId, cardId: card.id, frameType: card.frameType })
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index))
console.log(
  `${index.length} artworks (${targets} for truth cards), ${downloaded} downloaded, ${missing} missing`
)
