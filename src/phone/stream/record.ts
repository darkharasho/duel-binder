import type { GameId } from '@shared/games/types'
import type { ScanRow } from '@/features/scan/session'

/**
 * What one stream pulled: row snapshots keyed by row.key, newest first. `saved` is the copies
 * saved to the collection per key during this stream.
 */
export interface StreamRecord {
  game: GameId
  rows: ScanRow[]
  saved: Record<string, number>
}

const STORAGE_KEY = 'scan.stream.v1'

export const newStream = (game: GameId): StreamRecord => ({ game, rows: [], saved: {} })

/** Adds a pulled row; a key already there takes the newer row (the list already merged quantity). */
export function recordPull(record: StreamRecord, row: ScanRow): StreamRecord {
  const has = record.rows.some((r) => r.key === row.key)
  return {
    ...record,
    rows: has ? record.rows.map((r) => (r.key === row.key ? row : r)) : [row, ...record.rows]
  }
}

/** Notes copies saved for a row of this stream; any other key is not the stream's. */
export function recordSaved(record: StreamRecord, key: string, quantity: number): StreamRecord {
  if (!record.rows.some((r) => r.key === key)) return record
  return { ...record, saved: { ...record.saved, [key]: (record.saved[key] ?? 0) + quantity } }
}

/**
 * Brings the record in line with the list after edits. A row's quantity is its copies on the list
 * plus the copies saved. A row gone from the list stays only if copies were saved. List rows not
 * pulled on this stream are never added. Returns the same record when nothing changed.
 */
export function reconcile(record: StreamRecord, listRows: ScanRow[]): StreamRecord {
  const onList = new Map(listRows.map((r) => [r.key, r]))
  const rows: ScanRow[] = []
  for (const old of record.rows) {
    const live = onList.get(old.key)
    const saved = record.saved[old.key] ?? 0
    if (!live && saved <= 0) continue
    rows.push({ ...(live ?? old), quantity: (live?.quantity ?? 0) + saved })
  }
  return JSON.stringify(rows) === JSON.stringify(record.rows) ? record : { ...record, rows }
}

export const streamCards = (record: StreamRecord): number =>
  record.rows.reduce((n, r) => n + r.quantity, 0)

export function loadStream(): StreamRecord | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof v !== 'object' || v === null) return null
    const r = v as Record<string, unknown>
    if ((r.game !== 'ygo' && r.game !== 'pkm') || !Array.isArray(r.rows)) return null
    const rows = r.rows.filter(
      (x): x is ScanRow =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as ScanRow).key === 'string' &&
        typeof (x as ScanRow).quantity === 'number'
    )
    const saved: Record<string, number> = {}
    if (typeof r.saved === 'object' && r.saved !== null && !Array.isArray(r.saved)) {
      for (const [key, n] of Object.entries(r.saved)) {
        if (typeof n === 'number' && n > 0) saved[key] = n
      }
    }
    return { game: r.game, rows, saved }
  } catch {
    return null
  }
}

export function saveStream(record: StreamRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Storage full or unavailable: the stream still works until the page closes.
  }
}

export function endStream(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Unavailable storage holds no record.
  }
}
