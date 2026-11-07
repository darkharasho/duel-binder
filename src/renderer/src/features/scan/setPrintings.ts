import { useCallback } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { ScanPrinting } from '@shared/scan/types'
import { scanSetKey, type ScanSet } from '@shared/scanWindow'
import { api } from '@/lib/api'

const ANY = 'any'

/** What the scan loop is given for the picked sets. */
export interface ScanSetInputs {
  /** Changes only when the sets scanned do, whatever order they were picked in. */
  setKey: string
  /** Every scanned set's printings, each once; null for any set, undefined while they load. */
  setPrintings: ScanPrinting[] | null | undefined
  /** No picked set's printings could be read, so cards are matched against every set. */
  setUnreadable: boolean
  /** Picked sets left out because their printings couldn't be read, while others scan. */
  setsSkipped: ScanSet[]
}

/**
 * The picked sets as the scan loop takes them: one list of printings, deduplicated by printing
 * (a card can't be in two sets, but a set listed twice shouldn't count its cards twice). A set
 * whose printings can't be read is skipped rather than turning the whole scan into any set; only
 * when none of them can be read does it scan as any set, so it still scans at all.
 */
export function scanSetInputs(
  sets: readonly ScanSet[],
  results: readonly { data?: ScanPrinting[]; isError: boolean }[]
): ScanSetInputs {
  if (!sets.length)
    return { setKey: ANY, setPrintings: null, setUnreadable: false, setsSkipped: [] }
  const read = sets.filter((_, i) => !results[i]?.isError)
  if (!read.length) return { setKey: ANY, setPrintings: null, setUnreadable: true, setsSkipped: [] }
  const setsSkipped = sets.filter((_, i) => results[i]?.isError)
  const setKey = [...new Set(read.map(scanSetKey))].sort().join('\n')
  // Waits for every set still loading, so the first frames aren't matched against part of them.
  const loading = sets.some((_, i) => !results[i]?.isError && results[i]?.data === undefined)
  if (loading) return { setKey, setPrintings: undefined, setUnreadable: false, setsSkipped }
  const seen = new Set<number>()
  const setPrintings: ScanPrinting[] = []
  for (const r of results.slice(0, sets.length)) {
    for (const p of r.data ?? []) {
      if (seen.has(p.printingId)) continue
      seen.add(p.printingId)
      setPrintings.push(p)
    }
  }
  return { setKey, setPrintings, setUnreadable: false, setsSkipped }
}

/**
 * Reads each picked set's printings (each cached on its own, so adding a set doesn't read the
 * others again) and joins them for the scan loop (scanSetInputs).
 */
export function useScanSets(sets: readonly ScanSet[]): ScanSetInputs {
  // By value: the scan window is sent new settings with every message, and a joined list that
  // changed only in identity would have the loop work out its candidates again. useQueries only
  // runs `combine` again when it or a result changes, so a stable one keeps the list.
  const picked = JSON.stringify(sets.map((s) => ({ setName: s.setName, language: s.language })))
  const combine = useCallback(
    (results: { data?: ScanPrinting[]; isError: boolean }[]) =>
      scanSetInputs(JSON.parse(picked) as ScanSet[], results),
    [picked]
  )
  return useQueries({
    queries: sets.map((s) => ({
      queryKey: ['scan', 'setPrintings', s.setName, s.language],
      queryFn: () => api.scan.printingsForSet(s.setName, s.language),
      staleTime: Infinity,
      refetchOnWindowFocus: false
    })),
    combine
  })
}
