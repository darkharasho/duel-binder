import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isLanguage, LANGUAGES, languageInfo, type Language } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import { setPrefix } from '@shared/sets'
import { api, queryKeys } from '@/lib/api'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { useScanHub } from './ScanHub'
import type { PickerOption } from './SearchPicker'

const ANY = 'any'
const AUTO = 'auto'
export const RARITY_OPTIONS: PickerOption[] = [
  { key: AUTO, label: 'Auto' },
  ...RARITY_TIERS.map((r) => ({ key: r, label: r }))
]

interface PickedSet {
  setName: string
  language: Language
}

const setKeyOf = (s: PickedSet): string => `${s.language}|${s.setName}`

/** "MAMO - Magnificent Monsters", with the language tag when sets of every language are listed. */
function setLabel(s: PickedSet & { setCode?: string }, withTag: boolean): string {
  const code = s.setCode ? setPrefix(s.setCode) : ''
  const name = code ? `${code} - ${s.setName}` : s.setName
  return withTag ? `${name} · ${languageInfo(s.language).tag}` : name
}

/** One SearchPicker's value, options and pick handler. */
export interface PickerProps {
  value: string
  options: readonly PickerOption[]
  onPick: (key: string) => void
}

/**
 * The scan "Language", "Set" and "New scans as" pickers. The language is the app's shared
 * language filter and narrows the sets listed; the set and rarity are the scan hub's settings.
 * The same for the desktop Scan page and the phone scanner.
 */
export function useScanPickers(): {
  language: PickerProps
  set: PickerProps
  rarity: PickerProps
} {
  const { settings, setSettings } = useScanHub()
  const [language, setLanguage] = useLanguageFilter()
  const picked = settings.set
  const withTag = language === 'all'

  // Not refetched while scanning (focus or staleness); data-changed events still invalidate it.
  const sets = useQuery({
    queryKey: queryKeys.setsList,
    queryFn: () => api.sets.list(),
    staleTime: Infinity,
    refetchOnWindowFocus: false
  })
  const setOptions = useMemo(() => {
    const order = new Map(LANGUAGES.map((l, i) => [l.code, i]))
    const byName = new Intl.Collator('en').compare
    const sorted = (sets.data ?? [])
      .filter((s) => matchesLanguage(language, s.language))
      .sort(
        (a, b) =>
          byName(a.setName, b.setName) ||
          (order.get(a.language) ?? 0) - (order.get(b.language) ?? 0)
      )
    const options: PickerOption[] = [{ key: ANY, label: 'Any set' }]
    const byKey = new Map<string, PickedSet>()
    for (const s of sorted) {
      const key = setKeyOf(s)
      const label = setLabel(s, withTag)
      byKey.set(key, { setName: s.setName, language: s.language })
      options.push({ key, label, search: label.toLowerCase() })
    }
    return { options, byKey }
  }, [sets.data, language, withTag])

  const languageOptions = useMemo(() => {
    const present = new Set((sets.data ?? []).map((s) => s.language))
    return [
      { key: 'all', label: 'All languages' },
      ...LANGUAGES.filter((l) => l.code === language || present.has(l.code)).map((l) => ({
        key: l.code,
        label: l.label,
        search: `${l.label} ${l.tag}`.toLowerCase()
      }))
    ]
  }, [sets.data, language])

  const { byKey } = setOptions
  // A remembered set missing from the list (still loading, say) still shows as picked.
  const pickedSetOptions = useMemo(
    () =>
      picked && !byKey.has(setKeyOf(picked))
        ? [
            ...setOptions.options,
            {
              key: setKeyOf(picked),
              label: setLabel(picked, withTag || !matchesLanguage(language, picked.language))
            }
          ]
        : setOptions.options,
    [picked, byKey, setOptions.options, withTag, language]
  )
  const pickSet = useCallback(
    (key: string): void => {
      setSettings({
        set: byKey.get(key) ?? (picked && key === setKeyOf(picked) ? picked : null)
      })
    },
    [byKey, picked, setSettings]
  )

  // A picked set follows to the new language where that language has it, else it's cleared.
  const pickLanguage = useCallback(
    (key: string): void => {
      if (key !== 'all' && !isLanguage(key)) return
      setLanguage(key)
      if (!picked || key === 'all' || key === picked.language) return
      const same = (sets.data ?? []).find((s) => s.language === key && s.setName === picked.setName)
      setSettings({ set: same ? { setName: same.setName, language: same.language } : null })
    },
    [picked, sets.data, setLanguage, setSettings]
  )

  const pickRarity = useCallback(
    (value: string): void => {
      setSettings({ defaultRarity: value === AUTO ? null : value })
    },
    [setSettings]
  )

  return {
    language: { value: language, options: languageOptions, onPick: pickLanguage },
    set: { value: picked ? setKeyOf(picked) : ANY, options: pickedSetOptions, onPick: pickSet },
    rarity: { value: settings.defaultRarity ?? AUTO, options: RARITY_OPTIONS, onPick: pickRarity }
  }
}
