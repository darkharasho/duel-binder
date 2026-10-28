import type Database from 'better-sqlite3'
import { decode as decodeJpeg } from 'jpeg-js'
import { PNG } from 'pngjs'
import { ART_BOXES, crop } from '../../src/renderer/src/features/scan/vision/regions'
import { HASH_WORDS, artHash, hamming } from '../../src/shared/scan/fingerprint'
import type { RgbaImage } from '../../src/shared/scan/types'
import { isLanguage } from '../../src/shared/languages'
import type { YugipediaClient } from '../../src/main/yugipedia/client'
import { choosePrintingFile } from '../../src/main/yugipedia/printingArt'

/** Scans downloaded per run; the rest wait for the next night. */
const DEFAULT_MAX_DOWNLOADS = 600
/** Card gallery pages asked for at once (the API's own limit). */
const GALLERY_BATCH = 50
/** A printing with no scan, or a scan that failed, is tried again after this long. */
const RETRY_MS = 30 * 24 * 60 * 60 * 1000
const RETRY_DELAYS_MS = [1000, 2000]
/** Width over height of a card; a file far from it is art or a photo, not a scan of the card. */
const CARD_RATIO = 59 / 86
const RATIO_TOLERANCE = 0.05

/**
 * Printings whose scans are wanted: English, and Japanese for the OCG-only sets (Limit Over
 * Collection and the like) whose overframe arts and foils have no English printing to stand in.
 */
const REFERENCE_LANGUAGES = ['en', 'ja'] as const
/** Foils whose shine changes how the art looks, so the plain art matches them poorly. */
const FOIL = /^(starlight|ghost|collector's) rare/i
/** Variants that only change the foil colour of the name, not the art. */
const COLOUR = /^(red|blue|green|purple|silver|bronze|gold|yellow|orange|white|pink)$/i

/**
 * Whether a printing looks unlike its card's art from YGOPRODeck: an alternate or overframe art
 * (named in its variant or in brackets after its rarity), or a foil that changes the picture.
 */
export function wantsReference(rarity: string, variant: string | null): boolean {
  if (FOIL.test(rarity.trim())) return true
  const named = variant?.trim() || /\(([^()]+)\)\s*$/.exec(rarity)?.[1]?.trim()
  return !!named && !COLOUR.test(named)
}

export interface ReferenceOptions {
  work: Database.Database
  /** The fingerprint cache: its fp table holds the card art hashes the scans are placed against. */
  cache: Database.Database
  yugipedia: Pick<YugipediaClient, 'listPageImages' | 'fetchImageUrls'>
  /** Downloads the scans; defaults to `fetch`. */
  fetch?: typeof fetch
  userAgent: string
  maxDownloads?: number
  now?: () => Date
  log?: (s: string) => void
}

export interface ReferenceResult {
  entries: { imageId: number; hash: Uint32Array }[]
  fetched: number
  failed: number
}

interface PrintingRow {
  id: number
  card_id: number
  name: string
  frame_type: string
  set_code: string
  language: string
  set_rarity: string
  set_rarity_code: string
  variant: string | null
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Decodes a PNG or JPEG by its first bytes; anything else is null. */
function decodeImage(bytes: Uint8Array): RgbaImage | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const png = PNG.sync.read(Buffer.from(bytes))
    return { width: png.width, height: png.height, data: png.data }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true })
  }
  return null
}

/**
 * The art-box hash of a scan of a whole card, cut where the scanner cuts a photo: the Pendulum box
 * for Pendulum cards, else the normal one. Null when the image isn't shaped like a card.
 */
export function scanHash(img: RgbaImage, frameType: string): Uint32Array | null {
  if (Math.abs(img.width / img.height - CARD_RATIO) > RATIO_TOLERANCE) return null
  return artHash(crop(img, frameType.includes('pendulum') ? ART_BOXES.pendulum : ART_BOXES.normal))
}

/** A scan that isn't there, or isn't one of a card. */
class Missing extends Error {}

async function download(
  fetchFn: typeof fetch,
  url: string,
  userAgent: string
): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, { headers: { 'User-Agent': userAgent } })
    if (res.ok) return new Uint8Array(await res.arrayBuffer())
    await res.body?.cancel()
    const retry = res.status === 429 || res.status >= 500
    if (!retry) throw new Missing(`HTTP ${res.status}`)
    if (attempt >= RETRY_DELAYS_MS.length) throw new Error(`HTTP ${res.status}`)
    await sleep(RETRY_DELAYS_MS[attempt])
  }
}

/**
 * Yugipedia's scans of the printings wantsReference picks, as extra art references: each scan's
 * art-box hash under the image id of its card's closest artwork, so the scanner takes a photo
 * of that printing for its card. Which scan each printing has is looked up once (again after
 * RETRY_MS when it had none), and each scan is downloaded once, up to maxDownloads per run.
 */
export async function buildReferences(opts: ReferenceOptions): Promise<ReferenceResult> {
  const { work, cache, yugipedia } = opts
  const fetchFn = opts.fetch ?? fetch
  const now = opts.now ?? ((): Date => new Date())
  const log = opts.log ?? ((): void => {})
  const retryBefore = new Date(now().getTime() - RETRY_MS).toISOString()
  cache.exec(`
    CREATE TABLE IF NOT EXISTS ref_printing (printing_id INTEGER PRIMARY KEY, file TEXT, checked_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ref_file (file TEXT PRIMARY KEY, hash BLOB, checked_at TEXT NOT NULL);
  `)

  const printings = (
    work
      .prepare(
        `SELECT p.id, p.card_id, c.name, c.frame_type, p.set_code, p.language, p.set_rarity,
           p.set_rarity_code, p.variant
         FROM card_printings p JOIN cards c ON c.id = p.card_id
         WHERE p.language IN (${REFERENCE_LANGUAGES.map((l) => `'${l}'`).join(', ')})
           AND p.set_code <> ''`
      )
      .all() as PrintingRow[]
  ).filter((p) => wantsReference(p.set_rarity, p.variant))

  // Which scan each printing has, from its card's gallery page.
  const known = new Map(
    (
      cache.prepare('SELECT printing_id, file, checked_at FROM ref_printing').all() as {
        printing_id: number
        file: string | null
        checked_at: string
      }[]
    ).map((r) => [r.printing_id, r])
  )
  const lookUp = printings.filter((p) => {
    const row = known.get(p.id)
    return !row || (row.file === null && row.checked_at < retryBefore)
  })
  const saveFile = cache.prepare(
    'INSERT OR REPLACE INTO ref_printing (printing_id, file, checked_at) VALUES (?, ?, ?)'
  )
  const titles = [...new Set(lookUp.map((p) => `Card Gallery:${p.name}`))]
  // A batch at a time, each saved as it comes, so trouble partway keeps what came before.
  for (let i = 0; i < titles.length; i += GALLERY_BATCH) {
    const batch = new Set(titles.slice(i, i + GALLERY_BATCH))
    let galleries: Map<string, string[]>
    try {
      galleries = await yugipedia.listPageImages([...batch])
    } catch (e) {
      log(`Printing scan lookup failed: ${e instanceof Error ? e.message : e}`)
      break
    }
    const at = now().toISOString()
    cache.transaction(() => {
      for (const p of lookUp) {
        const files = galleries.get(`Card Gallery:${p.name}`)
        // A gallery missing from the answer is left to look up again next run.
        if (!batch.has(`Card Gallery:${p.name}`) || !files || !isLanguage(p.language)) continue
        const file = choosePrintingFile(files, {
          setCode: p.set_code,
          language: p.language,
          rarity: p.set_rarity,
          rarityCode: p.set_rarity_code,
          variant: p.variant
        })
        saveFile.run(p.id, file, at)
        known.set(p.id, { printing_id: p.id, file, checked_at: at })
      }
    })()
  }

  // Each scan once: its file, and the card it shows.
  const scans = new Map<string, PrintingRow>()
  for (const p of printings) {
    const file = known.get(p.id)?.file
    if (file && !scans.has(file)) scans.set(file, p)
  }
  const hashed = new Map(
    (
      cache.prepare('SELECT file, hash, checked_at FROM ref_file').all() as {
        file: string
        hash: Buffer | null
        checked_at: string
      }[]
    ).map((r) => [r.file, r])
  )
  const todo = [...scans.keys()]
    .filter((f) => {
      const row = hashed.get(f)
      return !row || (row.hash === null && row.checked_at < retryBefore)
    })
    .slice(0, opts.maxDownloads ?? DEFAULT_MAX_DOWNLOADS)
  let fetched = 0
  let failed = 0
  if (todo.length > 0) {
    let urls: Map<string, string> | null = null
    try {
      urls = await yugipedia.fetchImageUrls(todo)
    } catch (e) {
      log(`Printing scan lookup failed: ${e instanceof Error ? e.message : e}`)
    }
    const save = cache.prepare(
      'INSERT OR REPLACE INTO ref_file (file, hash, checked_at) VALUES (?, ?, ?)'
    )
    for (const file of urls ? todo : []) {
      const url = urls!.get(file)
      let hash: Uint32Array | null = null
      try {
        if (!url) throw new Missing('no such file')
        const img = decodeImage(await download(fetchFn, url, opts.userAgent))
        hash = img && scanHash(img, scans.get(file)!.frame_type)
        if (!hash) throw new Missing('not a card scan')
        fetched++
      } catch (e) {
        failed++
        log(`Printing scan ${file} failed: ${e instanceof Error ? e.message : e}`)
        // Network trouble is tried again next run; a scan that isn't there or isn't usable, later.
        if (!(e instanceof Missing)) continue
      }
      const row = { file, hash: hash && Buffer.from(hash.buffer), checked_at: now().toISOString() }
      save.run(row.file, row.hash, row.checked_at)
      hashed.set(file, row)
    }
  }

  // Each scan goes under its card's closest artwork, so a match shows the art it looks like.
  const artOf = work
    .prepare('SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order, image_id')
    .pluck()
  const artHashOf = cache.prepare('SELECT hash FROM fp WHERE image_id = ?').pluck()
  const entries: ReferenceResult['entries'] = []
  for (const [file, p] of scans) {
    const blob = hashed.get(file)?.hash
    if (!blob || blob.length !== HASH_WORDS * 4) continue
    // Copy: a Buffer's bytes may sit at an unaligned offset in a shared pool.
    const hash = new Uint32Array(new Uint8Array(blob).buffer)
    const images = artOf.all(p.card_id) as number[]
    if (images.length === 0) continue
    let best = images[0]
    let bestDistance = Infinity
    for (const id of images) {
      const art = artHashOf.get(id) as Buffer | undefined
      if (!art || art.length !== HASH_WORDS * 4) continue
      const d = hamming(hash, 0, new Uint32Array(new Uint8Array(art).buffer), 0)
      if (d < bestDistance) [best, bestDistance] = [id, d]
    }
    entries.push({ imageId: best, hash })
  }
  return { entries, fetched, failed }
}
