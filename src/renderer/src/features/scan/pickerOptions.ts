import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isLanguage, LANGUAGES, languageInfo, type Language } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import { englishSetName, setNameTooltip } from '@shared/setNames'
import { setPrefix } from '@shared/sets'
import {
  isPokemonLanguage,
  liveLanguage,
  POKEMON_LANGUAGES,
  scanSetKey as setKeyOf,
  type ScanSet as PickedSet
} from '@shared/scanWindow'
import { api, queryKeys } from '@/lib/api'
import { useGame } from '@/lib/game'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { setLabel } from '@/lib/setLabels'
import { useScanHub } from './ScanHub'
import type { PickerOption } from './SearchPicker'

const ANY = 'any'
const AUTO = 'auto'
export const RARITY_OPTIONS: PickerOption[] = [
  { key: AUTO, label: 'Auto' },
  ...RARITY_TIERS.map((r) => ({ key: r, label: r }))
]

/** "MAMO - Magnificent Monsters", with the language tag when sets of every language are listed. */
function pickedLabel(s: PickedSet & { setCode?: string }, withTag: boolean): string {
  const name = setLabel(s.setName, s.setCode)
  return withTag ? `${name} · ${languageInfo(s.language).tag}` : name
}

/**
 * The language the scanner is set to, which narrows each scanned row's printing dropdown: the
 * Language picked on the Scan page, or under "All languages" the picked sets' language; null
 * under "All languages" with any set, or with sets of more than one language, when every
 * language is listed.
 */
export function useScanLanguage(): Language | null {
  const { settings } = useScanHub()
  const [language] = useLanguageFilter()
  const { game } = useGame()
  if (game === 'pkm') return liveLanguage(settings)
  if (language !== 'all') return language
  const languages = new Set(settings.sets.map((s) => s.language))
  return languages.size === 1 ? [...languages][0] : null
}

/** One SearchPicker's value, options and pick handler. */
export interface PickerProps {
  value: string
  options: readonly PickerOption[]
  onPick: (key: string) => void
}

/** A MultiSearchPicker's picked keys, options and handlers. */
export interface MultiPickerProps {
  values: readonly string[]
  options: readonly PickerOption[]
  /** Adds the option, or takes it away when it's already picked. */
  onToggle: (key: string) => void
  onClear: () => void
}

/**
 * The scan "Language", "Set" and "New scans as" pickers. The language is the app's shared
 * language filter and narrows the sets listed; the sets and rarity are the scan hub's settings.
 * The same for the desktop Scan page and the phone scanner. Live Pokémon scanning has to be told
 * its language, so there it's the scan's own setting, with no "All languages".
 *
 * `sets` picks several sets (the desktop Scan page); `set` picks one, replacing whatever was
 * picked (the phone's chip). "Any set" is no set picked.
 */
export function useScanPickers(): {
  language: PickerProps
  set: PickerProps
  sets: MultiPickerProps
  rarity: PickerProps
} {
  const { settings, setSettings } = useScanHub()
  const [shared, setLanguage] = useLanguageFilter()
  const { game } = useGame()
  const pokemon = game === 'pkm'
  const language = pokemon ? liveLanguage(settings) : shared
  const picked = settings.sets
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
          byName(englishSetName(a.setName), englishSetName(b.setName)) ||
          (order.get(a.language) ?? 0) - (order.get(b.language) ?? 0)
      )
    const options: PickerOption[] = [{ key: ANY, label: 'Any set' }]
    const byKey = new Map<string, PickedSet>()
    for (const s of sorted) {
      const key = setKeyOf(s)
      const label = pickedLabel(s, withTag)
      byKey.set(key, { setName: s.setName, language: s.language })
      options.push({
        key,
        label,
        search: `${label} ${s.setName}`.toLowerCase(),
        badge: s.setCode ? setPrefix(s.setCode) : undefined,
        title: setNameTooltip(s.setName, s.setCode),
        note: withTag ? languageInfo(s.language).tag : undefined
      })
    }
    return { options, byKey }
  }, [sets.data, language, withTag])

  const languageOptions = useMemo(() => {
    const present = new Set((sets.data ?? []).map((s) => s.language))
    const listed = LANGUAGES.filter((l) =>
      pokemon
        ? (POKEMON_LANGUAGES as readonly string[]).includes(l.code)
        : l.code === language || present.has(l.code)
    ).map((l) => ({
      key: l.code,
      label: l.label,
      search: `${l.label} ${l.tag}`.toLowerCase(),
      badge: l.tag
    }))
    return pokemon ? listed : [{ key: 'all', label: 'All languages' }, ...listed]
  }, [sets.data, language, pokemon])

  const { byKey } = setOptions
  // Remembered sets missing from the list (still loading, say) still show as picked.
  const pickedSetOptions = useMemo(() => {
    const missing = picked.filter((p) => !byKey.has(setKeyOf(p)))
    return missing.length
      ? [
          ...setOptions.options,
          ...missing.map((p) => ({
            key: setKeyOf(p),
            label: pickedLabel(p, withTag || !matchesLanguage(language, p.language))
          }))
        ]
      : setOptions.options
  }, [picked, byKey, setOptions.options, withTag, language])
  const setOf = useCallback(
    (key: string): PickedSet | null =>
      byKey.get(key) ?? picked.find((p) => setKeyOf(p) === key) ?? null,
    [byKey, picked]
  )
  const pickSet = useCallback(
    (key: string): void => {
      const set = setOf(key)
      setSettings({ sets: set ? [set] : [] })
    },
    [setOf, setSettings]
  )
  const toggleSet = useCallback(
    (key: string): void => {
      if (key === ANY) return setSettings({ sets: [] })
      if (picked.some((p) => setKeyOf(p) === key))
        return setSettings({ sets: picked.filter((p) => setKeyOf(p) !== key) })
      const set = setOf(key)
      if (set) setSettings({ sets: [...picked, set] })
    },
    [picked, setOf, setSettings]
  )
  const clearSets = useCallback((): void => setSettings({ sets: [] }), [setSettings])

  // Picked sets follow to the new language where that language has them; the rest are dropped.
  const pickLanguage = useCallback(
    (key: string): void => {
      if (key !== 'all' && !isLanguage(key)) return
      if (pokemon) {
        if (isPokemonLanguage(key)) setSettings({ scanLanguage: key })
      } else {
        setLanguage(key)
      }
      if (!picked.length || key === 'all' || picked.every((p) => p.language === key)) return
      const moved: PickedSet[] = []
      for (const p of picked) {
        const same =
          p.language === key
            ? p
            : (sets.data ?? []).find((s) => s.language === key && s.setName === p.setName)
        const next = same && { setName: same.setName, language: same.language }
        if (next && !moved.some((m) => setKeyOf(m) === setKeyOf(next))) moved.push(next)
      }
      setSettings({ sets: moved })
    },
    [picked, sets.data, pokemon, setLanguage, setSettings]
  )

  const pickRarity = useCallback(
    (value: string): void => {
      setSettings({ defaultRarity: value === AUTO ? null : value })
    },
    [setSettings]
  )

  return {
    language: { value: language, options: languageOptions, onPick: pickLanguage },
    set: {
      value: picked.length ? setKeyOf(picked[0]) : ANY,
      options: pickedSetOptions,
      onPick: pickSet
    },
    sets: {
      values: picked.length ? picked.map(setKeyOf) : [ANY],
      // "Any set" stays first: picking it clears the list, which is what any set is.
      options: pickedSetOptions,
      onToggle: toggleSet,
      onClear: clearSets
    },
    rarity: { value: settings.defaultRarity ?? AUTO, options: RARITY_OPTIONS, onPick: pickRarity }
  }
}
