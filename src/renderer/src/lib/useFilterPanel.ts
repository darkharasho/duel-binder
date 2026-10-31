import { useCallback, useState, useSyncExternalStore } from 'react'

const KEY = 'filters.panelOpen'
/** From here up the panel sits beside the page; below, it's a bottom sheet (phones, narrow windows). */
const WIDE = '(min-width: 1024px)'

// Set only when localStorage rejects a write, so the choice still holds for the session.
let memoryFallback: boolean | null = null

function readOpen(): boolean {
  if (memoryFallback !== null) return memoryFallback
  try {
    return localStorage.getItem(KEY) === 'open'
  } catch {
    return false
  }
}

const listeners = new Set<() => void>()
const subscribeOpen = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? 'open' : 'closed')
    memoryFallback = null
  } catch {
    memoryFallback = open // storage unavailable: remembered for this session only
  }
  listeners.forEach((cb) => cb())
}

const readWide = (): boolean => window.matchMedia?.(WIDE).matches ?? true
const subscribeWide = (cb: () => void): (() => void) => {
  const query = window.matchMedia?.(WIDE)
  query?.addEventListener?.('change', cb)
  return () => query?.removeEventListener?.('change', cb)
}

/**
 * Whether a page's filter panel is open and how it shows. The side panel stays open from page to
 * page and between runs; a bottom sheet is opened each time and belongs to its page.
 */
export function useFilterPanel(): {
  wide: boolean
  open: boolean
  setOpen: (open: boolean) => void
} {
  const wide = useSyncExternalStore(subscribeWide, readWide)
  const sideOpen = useSyncExternalStore(subscribeOpen, readOpen)
  const [sheetOpen, setSheetOpen] = useState(false)
  const setOpen = useCallback(
    (open: boolean) => (wide ? writeOpen(open) : setSheetOpen(open)),
    [wide]
  )
  return { wide, open: wide ? sideOpen : sheetOpen, setOpen }
}
