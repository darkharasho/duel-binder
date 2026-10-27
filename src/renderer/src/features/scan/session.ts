import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, mutationInvalidationKeys } from '@/lib/api'
import type { ScanDraft } from './resolve'

export interface ScanRow extends ScanDraft {
  key: string
  quantity: number
  addedAt: number
  error?: string
}

const STORAGE_KEY = 'scan.session.v1'

export const rowKey = (d: Pick<ScanDraft, 'printingId' | 'cardId' | 'imageId'>): string =>
  `${d.printingId ?? 'c' + d.cardId}:${d.imageId}`

const isRow = (v: unknown): v is ScanRow => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.key === 'string' &&
    typeof r.cardId === 'number' &&
    typeof r.imageId === 'number' &&
    typeof r.name === 'string' &&
    typeof r.quantity === 'number' &&
    Array.isArray(r.options) &&
    r.options.every((o) => typeof o === 'object' && o !== null)
  )
}

function load(): ScanRow[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRow).map((r) => ({ ...r, key: rowKey(r) })) : []
  } catch {
    return []
  }
}

function save(rows: ScanRow[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } catch {
    // Storage full or unavailable: the list still works for this session. An older saved list
    // mustn't outlive it, or rows added since would come back after a restart.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Unavailable altogether: there is nothing stale to come back.
    }
  }
}

/** Forgets the saved list of unsaved scans (a mounted session keeps its own copy until it changes). */
export function clearSavedScans(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Unavailable storage holds no list.
  }
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : 'Could not add card'

export function useScanSession(): {
  rows: ScanRow[]
  total: number
  committing: boolean
  add(d: ScanDraft): void
  setPrinting(key: string, printingId: number): void
  setQuantity(key: string, q: number): void
  remove(key: string): void
  clear(): void
  /** Rows added and failed, and the cards (copies) the added rows held. */
  commit(): Promise<{ added: number; failed: number; cards: number }>
} {
  const qc = useQueryClient()
  const [rows, setRows] = useState<ScanRow[]>(load)
  // Always the latest list, so back-to-back updates and the async commit never read stale state.
  const ref = useRef(rows)
  const committingRef = useRef(false)
  const [committing, setCommitting] = useState(false)

  const update = useCallback((fn: (rows: ScanRow[]) => ScanRow[]): void => {
    const next = fn(ref.current)
    ref.current = next
    save(next)
    setRows(next)
  }, [])

  const add = useCallback(
    (d: ScanDraft): void =>
      update((list) => {
        const key = rowKey(d)
        const existing = list.find((r) => r.key === key)
        const row: ScanRow = existing
          ? { ...existing, quantity: existing.quantity + 1, addedAt: Date.now(), error: undefined }
          : { ...d, key, quantity: 1, addedAt: Date.now() }
        return [row, ...list.filter((r) => r.key !== key)]
      }),
    [update]
  )

  const setPrinting = useCallback(
    (key: string, printingId: number): void =>
      update((list) => {
        const row = list.find((r) => r.key === key)
        const opt = row?.options.find((o) => o.printingId === printingId)
        if (!row || !opt) return list
        const next: ScanRow = {
          ...row,
          printingId,
          setCode: opt.setCode,
          rarity: opt.rarity,
          flag: null,
          error: undefined
        }
        next.key = rowKey(next)
        if (next.key === key) return list.map((r) => (r.key === key ? next : r))
        const twin = list.find((r) => r.key === next.key)
        if (!twin) return list.map((r) => (r.key === key ? next : r))
        const merged = { ...twin, quantity: twin.quantity + row.quantity }
        return list.filter((r) => r.key !== key).map((r) => (r.key === twin.key ? merged : r))
      }),
    [update]
  )

  const setQuantity = useCallback(
    (key: string, q: number): void =>
      update((list) =>
        !Number.isFinite(q)
          ? list
          : q < 1
            ? list.filter((r) => r.key !== key)
            : list.map((r) => (r.key === key ? { ...r, quantity: Math.floor(q) } : r))
      ),
    [update]
  )

  const remove = useCallback(
    (key: string): void => update((list) => list.filter((r) => r.key !== key)),
    [update]
  )

  const clear = useCallback((): void => update(() => []), [update])

  const commit = useCallback(async (): Promise<{
    added: number
    failed: number
    cards: number
  }> => {
    if (committingRef.current) return { added: 0, failed: 0, cards: 0 }
    committingRef.current = true
    setCommitting(true)
    let added = 0
    let failed = 0
    let cards = 0
    const unaddable = new Set(ref.current.filter((r) => r.printingId === null).map((r) => r.key))
    try {
      for (const row of ref.current.filter((r) => r.printingId !== null)) {
        try {
          await api.collection.add({
            printingId: row.printingId!,
            imageId: row.imageId,
            quantity: row.quantity
          })
          added++
          cards += row.quantity
          // Scans merged in meanwhile stay: take off only what was added.
          update((list) =>
            list.flatMap((r) =>
              r.key !== row.key
                ? [r]
                : r.quantity > row.quantity
                  ? [{ ...r, quantity: r.quantity - row.quantity, error: undefined }]
                  : []
            )
          )
        } catch (err) {
          failed++
          const error = messageOf(err)
          update((list) => list.map((r) => (r.key === row.key ? { ...r, error } : r)))
        }
      }
    } finally {
      committingRef.current = false
      setCommitting(false)
    }
    // A clean Add leaves an empty list: rows with no printing go too. Scans merged in meanwhile stay.
    if (added > 0 && failed === 0) update((list) => list.filter((r) => !unaddable.has(r.key)))
    if (added > 0) {
      for (const queryKey of mutationInvalidationKeys) void qc.invalidateQueries({ queryKey })
    }
    return { added, failed, cards }
  }, [qc, update])

  const total = rows.reduce((n, r) => n + r.quantity, 0)
  return { rows, total, committing, add, setPrinting, setQuantity, remove, clear, commit }
}
