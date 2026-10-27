import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language, LanguageFilter } from '@shared/languages'
import { setPrefix } from '@shared/sets'
import { api, queryKeys } from '@/lib/api'
import { matchesLanguage } from '@/lib/languageFilter'

/** "MAMO - Magnificent Monsters", or the bare name when the set's code isn't known. */
export function setLabel(setName: string, setCode: string | null | undefined): string {
  const code = setCode ? setPrefix(setCode) : ''
  return code ? `${code} - ${setName}` : setName
}

/**
 * Set names as the app shows them: labelled with their code, and narrowed to the sets the
 * language filter takes in. Names not in the sets list (still loading, say) pass and show bare.
 */
export function useSetNames(language: LanguageFilter): {
  labelOf: (setName: string) => string
  inLanguage: (setName: string) => boolean
} {
  const sets = useQuery({ queryKey: queryKeys.setsList, queryFn: () => api.sets.list() })
  return useMemo(() => {
    // Each name's code from the chosen language's set, else English's, else any language's.
    const rank = (l: Language): number => (matchesLanguage(language, l) ? 0 : l === 'en' ? 1 : 2)
    const codes = new Map<string, { code: string; rank: number }>()
    const languages = new Map<string, Set<Language>>()
    for (const s of sets.data ?? []) {
      const best = codes.get(s.setName)
      if (s.setCode && (!best || rank(s.language) < best.rank)) {
        codes.set(s.setName, { code: s.setCode, rank: rank(s.language) })
      }
      let langs = languages.get(s.setName)
      if (!langs) languages.set(s.setName, (langs = new Set()))
      langs.add(s.language)
    }
    return {
      labelOf: (name) => setLabel(name, codes.get(name)?.code),
      inLanguage: (name) => {
        const langs = languages.get(name)
        return !langs || language === 'all' || langs.has(language)
      }
    }
  }, [sets.data, language])
}
