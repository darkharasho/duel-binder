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
  // Another window, such as the scan window, sharing this localStorage changed it.
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
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

/**
 * The language the filter says cards are in. English is left out: it's only the filter's default,
 * so it says nothing about a card in hand.
 */
export function printedLanguage(filter: LanguageFilter): Language | null {
  return filter === 'all' || filter === 'en' ? null : filter
}

export function matchesLanguage(filter: LanguageFilter, language: Language): boolean {
  return filter === 'all' || filter === language
}

interface InLanguage {
  setName: string
  language: Language
}

/**
 * Which of these sets (or printings) the filter lists. English also takes the Asian-English sets
 * that never came out in English, such as Essential Selection 01: their cards are printed in
 * English. An Asian-English set sharing an English set's name is that set's Asian printing, so it
 * stays under Asian-English alone.
 */
export function setLanguageMatcher(
  filter: LanguageFilter,
  sets: readonly InLanguage[]
): (s: InLanguage) => boolean {
  if (filter !== 'en') return (s) => matchesLanguage(filter, s.language)
  const english = new Set(sets.filter((s) => s.language === 'en').map((s) => s.setName))
  return (s) => s.language === 'en' || (s.language === 'ae' && !english.has(s.setName))
}
