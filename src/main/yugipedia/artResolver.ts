import type Database from 'better-sqlite3'
import { isLanguage } from '../../shared/languages'
import type { YugipediaClient } from './client'
import { choosePrintingFile } from './printingArt'

const BATCH = 50
const BATCH_WAIT_MS = 40
/** A printing with no scan is looked up again after this long. */
const RETRY_MISSING_MS = 30 * 24 * 60 * 60 * 1000

export interface PrintingArtResolver {
  /** URL of the Yugipedia scan of this printing, or null when there is none (yet). Never rejects. */
  url(printingId: number): Promise<string | null>
}

interface PrintingInfo {
  id: number
  name: string
  set_code: string
  language: string
  set_rarity: string
  set_rarity_code: string
}

/**
 * Finds each printing's own scan on its card's Yugipedia gallery page. Lookups arriving together
 * are batched (50 cards per request) and run one batch at a time; answers are stored in
 * printing_art, misses included, so each printing is looked up once.
 */
export function createPrintingArtResolver(opts: {
  db: Database.Database
  client: YugipediaClient
  now?: () => Date
  batchWaitMs?: number
}): PrintingArtResolver {
  const { db, client } = opts
  const now = opts.now ?? (() => new Date())
  const waiting = new Map<number, ((url: string | null) => void)[]>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> = Promise.resolve()
  const inBatch = new Set<number>()

  const stored = db.prepare('SELECT url, checked_at FROM printing_art WHERE printing_id = ?')
  const info = db.prepare(
    `SELECT p.id, c.name, p.set_code, p.language, p.set_rarity, p.set_rarity_code
     FROM card_printings p JOIN cards c ON c.id = p.card_id WHERE p.id = ?`
  )
  const save = db.prepare(
    `INSERT INTO printing_art (printing_id, url, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(printing_id) DO UPDATE SET url = excluded.url, checked_at = excluded.checked_at`
  )

  const finish = (id: number, url: string | null): void => {
    for (const done of waiting.get(id) ?? []) done(url)
    waiting.delete(id)
  }

  async function runBatch(ids: number[]): Promise<void> {
    const printings = ids
      .map((id) => info.get(id) as PrintingInfo | undefined)
      .filter((p): p is PrintingInfo => p !== undefined)
    for (const id of ids) if (!printings.some((p) => p.id === id)) finish(id, null)
    if (printings.length === 0) return
    try {
      const galleries = await client.listPageImages([
        ...new Set(printings.map((p) => `Card Gallery:${p.name}`))
      ])
      const chosen = new Map<number, string | null>()
      for (const p of printings) {
        const files = galleries.get(`Card Gallery:${p.name}`) ?? []
        chosen.set(
          p.id,
          isLanguage(p.language)
            ? choosePrintingFile(files, {
                setCode: p.set_code,
                language: p.language,
                rarity: p.set_rarity,
                rarityCode: p.set_rarity_code
              })
            : null
        )
      }
      const files = [...new Set([...chosen.values()].filter((f): f is string => f !== null))]
      const urls = files.length > 0 ? await client.fetchImageUrls(files) : new Map<string, string>()
      const at = now().toISOString()
      db.transaction(() => {
        for (const [id, file] of chosen) save.run(id, file ? (urls.get(file) ?? null) : null, at)
      })()
      for (const [id, file] of chosen) finish(id, file ? (urls.get(file) ?? null) : null)
    } catch (e) {
      // Offline or Yugipedia trouble: answer "none" for now and store nothing, so it's retried.
      console.warn('Printing art lookup failed:', e instanceof Error ? e.message : String(e))
      for (const p of printings) finish(p.id, null)
    }
  }

  function flush(): void {
    timer = null
    const ids = [...waiting.keys()].filter((id) => !inBatch.has(id)).slice(0, BATCH)
    if (ids.length === 0) return
    for (const id of ids) inBatch.add(id)
    running = running
      .then(() => runBatch(ids))
      .finally(() => {
        for (const id of ids) inBatch.delete(id)
        if ([...waiting.keys()].some((id) => !inBatch.has(id)) && !timer) flush()
      })
  }
  return {
    url(printingId) {
      try {
        const row = stored.get(printingId) as { url: string | null; checked_at: string } | undefined
        if (row?.url) return Promise.resolve(row.url)
        if (row && now().getTime() - Date.parse(row.checked_at) < RETRY_MISSING_MS)
          return Promise.resolve(null)
      } catch {
        return Promise.resolve(null)
      }
      return new Promise((resolve) => {
        const list = waiting.get(printingId)
        if (list) list.push(resolve)
        else waiting.set(printingId, [resolve])
        timer ??= setTimeout(flush, opts.batchWaitMs ?? BATCH_WAIT_MS)
      })
    }
  }
}
