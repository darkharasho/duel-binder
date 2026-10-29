import type { SqlDb } from '../db/sql'
import { isLanguage } from '../../shared/languages'
import type { YugipediaClient } from './client'
import { choosePrintingFile } from './printingArt'

const BATCH = 50
const BATCH_WAIT_MS = 40
/** A printing with no scan is looked up again after this long. */
const RETRY_MISSING_MS = 30 * 24 * 60 * 60 * 1000

export interface PrintingArtResolver {
  /** URL of this printing's own photo (TCGplayer's or Yugipedia's scan), or null when there is none (yet). Never rejects. */
  url(printingId: number): Promise<string | null>
}

interface PrintingInfo {
  id: number
  name: string
  set_code: string
  language: string
  set_rarity: string
  set_rarity_code: string
  set_name: string
  variant: string | null
}

/**
 * Finds each printing's own scan on its card's Yugipedia gallery page. Lookups arriving together
 * are batched (50 cards per request) and run one batch at a time; answers are stored in
 * printing_art, misses included, so each printing is looked up once.
 */
export function createPrintingArtResolver(opts: {
  db: SqlDb
  client: YugipediaClient
  now?: () => Date
  batchWaitMs?: number
  /** A photo found without asking Yugipedia (TCGplayer's, for English printings); checked first. */
  quickUrl?: (printingId: number) => string | null
}): PrintingArtResolver {
  const { db, client } = opts
  const now = opts.now ?? (() => new Date())
  const waiting = new Map<number, ((url: string | null) => void)[]>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> = Promise.resolve()
  const inBatch = new Set<number>()

  const stored = db.prepare('SELECT url, checked_at FROM printing_art WHERE printing_id = ?')
  const info = db.prepare(
    `SELECT p.id, c.name, p.set_code, p.language, p.set_rarity, p.set_rarity_code, p.set_name, p.variant
     FROM card_printings p JOIN cards c ON c.id = p.card_id WHERE p.id = ?`
  )
  const siblingCodes = db.prepare(
    "SELECT set_code FROM card_printings WHERE game = 'ygo' AND language = ? AND set_name = ? AND set_code <> ''"
  )
  /** An uncoded printing's set prefix: the most common one among its set's coded printings. */
  const setPrefix = (p: PrintingInfo): string => {
    const counts = new Map<string, number>()
    for (const { set_code } of siblingCodes.all(p.language, p.set_name) as { set_code: string }[]) {
      const prefix = set_code.split('-')[0]
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
    let best = ''
    for (const [prefix, n] of counts) if (n > (counts.get(best) ?? 0)) best = prefix
    return best
  }
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
                setCode: p.set_code || setPrefix(p),
                language: p.language,
                rarity: p.set_rarity,
                rarityCode: p.set_rarity_code,
                variant: p.variant
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
        const quick = opts.quickUrl?.(printingId)
        if (quick) return Promise.resolve(quick)
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
