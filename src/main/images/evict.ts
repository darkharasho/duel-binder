import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SqlDb } from '../db/sql'

/** What everything but owned art may take up, and what a trim brings it down to. */
export const IMAGE_BUDGET_BYTES = 1_000_000_000
export const IMAGE_TRIM_TO_BYTES = 900_000_000
/** The first trim after launch, then one per this many bytes downloaded. */
export const EVICT_FIRST_AFTER_MS = 3 * 60_000
export const EVICT_EVERY_BYTES = 100_000_000

/** Card art sizes kept per image id. */
const ART_DIRS = ['small', 'full', 'cropped']

/**
 * The cache files (relative paths without extension) of every card in the collection, any local
 * owner, tombstones left out: its art by image id (and the art it shows that isn't its own), and
 * its printing's photo and small copy under the photo's key. Throws if a key can't be read, so a trim never runs on a partial list.
 */
export async function ownedImageKeys(
  db: SqlDb,
  printingKey: (printingId: number) => Promise<string | null>
): Promise<Set<string>> {
  const rows = db
    .prepare(
      'SELECT DISTINCT printing_id AS printing, image_id AS image FROM collection_entries WHERE deleted_at IS NULL'
    )
    .all() as { printing: number; image: number }[]
  // Art an owned card shows that isn't its own image: a Pokémon twin's (English, Japanese or
  // Traditional Chinese art a card borrows) and a Magic double-faced card's back.
  const shown = db
    .prepare(
      `SELECT t.image_id AS image FROM collection_entries e
       JOIN card_images i ON i.image_id = e.image_id
       JOIN pokemon_cards p ON p.card_id = i.card_id
       JOIN card_images t ON t.card_id IN (p.art_twin_id, p.traditional_twin_id) AND t.sort_order = 0
       WHERE e.deleted_at IS NULL
       UNION
       SELECT m.back_image_id FROM collection_entries e
       JOIN mtg_images m ON m.image_id = e.image_id
       WHERE e.deleted_at IS NULL AND m.back_image_id IS NOT NULL`
    )
    .all() as { image: number }[]
  const keys = new Set<string>()
  const printings = new Set<number>()
  for (const r of rows) {
    for (const d of ART_DIRS) keys.add(`${d}/${r.image}`)
    printings.add(r.printing)
  }
  for (const r of shown) for (const d of ART_DIRS) keys.add(`${d}/${r.image}`)
  for (const id of printings) {
    const key = await printingKey(id)
    if (key) keys.add(`printings/${key}`).add(`printings-small/${key}`)
  }
  return keys
}

/** One image: every file of its identity (a printing photo may be saved in two formats). */
interface Entry {
  files: { file: string; mtimeMs: number }[]
  size: number
  mtimeMs: number
}

/** A file's cache identity: its path under `dir` without its extension (and without a marker's). */
function identity(rel: string): { id: string; marker: boolean } {
  const posix = rel.split(path.sep).join('/')
  if (posix.endsWith('.brief'))
    return { id: posix.slice(0, -'.brief'.length).replace(/\.[^./]+$/, ''), marker: true }
  if (posix.endsWith('.none')) return { id: posix.slice(0, -'.none'.length), marker: true }
  return { id: posix.replace(/\.[^./]+$/, ''), marker: false }
}

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p, base, out)
    else if (e.isFile()) out.push(path.relative(base, p))
  }
  return out
}

/**
 * Deletes the least recently used images that aren't owned (`keep`) or being written (`busy`,
 * asked before each delete; `.tmp`) once the rest of the folder passes `budget` bytes, until it
 * is at or under `target`. Last use is the file's mtime (the cache refreshes it when it serves an
 * old file); a file used since the scan is spared. A deleted image's `.brief`/`.none` markers go
 * with it.
 */
export async function evictImages(opts: {
  dir: string
  keep: ReadonlySet<string>
  busy: () => ReadonlySet<string>
  budget?: number
  target?: number
}): Promise<{ deleted: number; freed: number }> {
  const budget = opts.budget ?? IMAGE_BUDGET_BYTES
  const target = opts.target ?? IMAGE_TRIM_TO_BYTES
  const images = new Map<string, Entry>()
  const markers = new Map<string, string[]>()
  for (const rel of await walk(opts.dir)) {
    if (rel.endsWith('.tmp')) continue
    const { id, marker } = identity(rel)
    const file = path.join(opts.dir, rel)
    if (marker) {
      markers.set(id, [...(markers.get(id) ?? []), file])
      continue
    }
    if (opts.keep.has(id)) continue
    const st = await fs.stat(file).catch(() => null)
    if (!st) continue
    const e = images.get(id) ?? { files: [], size: 0, mtimeMs: 0 }
    e.files.push({ file, mtimeMs: st.mtimeMs })
    e.size += st.size
    e.mtimeMs = Math.max(e.mtimeMs, st.mtimeMs)
    images.set(id, e)
  }
  let total = 0
  for (const e of images.values()) total += e.size
  if (total <= budget) return { deleted: 0, freed: 0 }
  let deleted = 0
  let freed = 0
  const oldestFirst = [...images.entries()].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs)
  for (const [id, e] of oldestFirst) {
    if (total <= target) break
    if (opts.busy().has(id)) continue
    let gone = 0
    for (const f of e.files) {
      const now = await fs.stat(f.file).catch(() => null)
      // Served (touched) since the scan: in use, so the image stays.
      if (now && now.mtimeMs > f.mtimeMs) continue
      if (!now) continue
      try {
        await fs.rm(f.file)
        gone += now.size
      } catch {
        // already gone or locked; the next trim tries again
      }
    }
    if (gone === 0) continue
    for (const m of markers.get(id) ?? []) await fs.rm(m, { force: true })
    total -= gone
    freed += gone
    deleted++
  }
  return { deleted, freed }
}

/** One trim: reads what's owned, then evicts; logs and skips (null) when owned can't be read. */
export async function runEviction(opts: {
  dir: string
  owned: () => Promise<Set<string>>
  busy: () => ReadonlySet<string>
  budget?: number
  target?: number
}): Promise<{ deleted: number; freed: number } | null> {
  let keep: Set<string>
  try {
    keep = await opts.owned()
  } catch (e) {
    console.warn('Image cache trim skipped: owned cards unreadable', e)
    return null
  }
  return evictImages({ ...opts, keep })
}

/**
 * Runs `run` once `firstAfterMs` after creation, then whenever `everyBytes` more have been
 * downloaded since the last run started; never two at once.
 */
export function createEvictionScheduler(opts: {
  run: () => Promise<unknown>
  firstAfterMs?: number
  everyBytes?: number
}): { downloaded(bytes: number): void; dispose(): void } {
  const everyBytes = opts.everyBytes ?? EVICT_EVERY_BYTES
  let since = 0
  let started = false
  let running = false
  const go = (): void => {
    if (running) return
    running = true
    since = 0
    void opts
      .run()
      .catch((e) => console.warn('Image cache trim failed', e))
      .finally(() => {
        running = false
      })
  }
  const timer = setTimeout(() => {
    started = true
    go()
  }, opts.firstAfterMs ?? EVICT_FIRST_AFTER_MS)
  timer.unref?.()
  return {
    downloaded(bytes) {
      since += bytes
      if (started && !running && since >= everyBytes) go()
    },
    dispose() {
      clearTimeout(timer)
    }
  }
}
