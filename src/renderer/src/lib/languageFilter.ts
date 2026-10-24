import { useCallback, useState } from 'react'
import { isLanguage, type Language, type LanguageFilter } from '@shared/languages'

const KEY = 'language.filter'

function read(): LanguageFilter {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'all' || isLanguage(v) ? v : 'en'
  } catch {
    return 'en'
  }
}

/** The shared language filter, remembered in localStorage; defaults to English. */
export function useLanguageFilter(): [LanguageFilter, (f: LanguageFilter) => void] {
  const [filter, setFilter] = useState<LanguageFilter>(read)
  const set = useCallback((f: LanguageFilter) => {
    setFilter(f)
    try {
      localStorage.setItem(KEY, f)
    } catch {
      /* storage unavailable: preference just isn't remembered */
    }
  }, [])
  return [filter, set]
}

export function matchesLanguage(filter: LanguageFilter, language: Language): boolean {
  return filter === 'all' || filter === language
}
