import { useCallback, useSyncExternalStore } from 'react'
import { isLanguage, type Language, type LanguageFilter } from '@shared/languages'

const KEY = 'language.filter'

/** What the filter starts as, and what clearing the filters returns it to. */
export const DEFAULT_LANGUAGE: LanguageFilter = 'en'

// Set only when localStorage rejects a write, so the choice still holds for the session.
let memoryFallback: LanguageFilter | null = null

function read(): LanguageFilter {
  if (memoryFallback !== null) return memoryFallback
  try {
    const v = localStorage.getItem(KEY)
    return v === 'all' || isLanguage(v) ? v : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

// localStorage is the source of truth (re-read on every snapshot); the listeners just wake
// every mounted consumer so the Collection and Sets pages agree without a remount.
const listeners = new Set<() => void>()
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function write(f: LanguageFilter): void {
  try {
    localStorage.setItem(KEY, f)
    memoryFallback = null
  } catch {
    memoryFallback = f // storage unavailable: remembered for this session only
  }
  listeners.forEach((cb) => cb())
}

/** The shared language filter, remembered in localStorage; defaults to English. */
export function useLanguageFilter(): [LanguageFilter, (f: LanguageFilter) => void] {
  const filter = useSyncExternalStore(subscribe, read)
  const set = useCallback((f: LanguageFilter) => write(f), [])
  return [filter, set]
}

export function matchesLanguage(filter: LanguageFilter, language: Language): boolean {
  return filter === 'all' || filter === language
}
