import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LANGUAGES, languageInfo, type Language } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import { api, queryKeys } from '@/lib/api'
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

/** One SearchPicker's value, options and pick handler. */
export interface PickerProps {
  value: string
  options: readonly PickerOption[]
  onPick: (key: string) => void
}

/**
 * The scan "Set" and "New scans as" pickers, read from and written to the scan hub's settings.
 * The same for the desktop Scan page and the phone scanner.
 */
export function useScanPickers(): { set: PickerProps; rarity: PickerProps } {
  const { settings, setSettings } = useScanHub()
  const picked = settings.set

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
      .map((s) => ({ setName: s.setName, language: s.language }))
      .sort(
        (a, b) =>
          byName(a.setName, b.setName) ||
          (order.get(a.language) ?? 0) - (order.get(b.language) ?? 0)
      )
    const options: PickerOption[] = [{ key: ANY, label: 'Any set' }]
    const byKey = new Map<string, PickedSet>()
    for (const s of sorted) {
      const key = setKeyOf(s)
      const label = `${s.setName} · ${languageInfo(s.language).tag}`
      byKey.set(key, s)
      options.push({ key, label, search: label.toLowerCase() })
    }
    return { options, byKey }
  }, [sets.data])

  const { byKey } = setOptions
  // A remembered set missing from the list (still loading, say) still shows as picked.
  const pickedSetOptions = useMemo(
    () =>
      picked && !byKey.has(setKeyOf(picked))
        ? [
            ...setOptions.options,
            {
              key: setKeyOf(picked),
              label: `${picked.setName} · ${languageInfo(picked.language).tag}`
            }
          ]
        : setOptions.options,
    [picked, byKey, setOptions.options]
  )
  const pickSet = useCallback(
    (key: string): void => {
      setSettings({
        set: byKey.get(key) ?? (picked && key === setKeyOf(picked) ? picked : null)
      })
    },
    [byKey, picked, setSettings]
  )

  const pickRarity = useCallback(
    (value: string): void => {
      setSettings({ defaultRarity: value === AUTO ? null : value })
    },
    [setSettings]
  )

  return {
    set: { value: picked ? setKeyOf(picked) : ANY, options: pickedSetOptions, onPick: pickSet },
    rarity: { value: settings.defaultRarity ?? AUTO, options: RARITY_OPTIONS, onPick: pickRarity }
  }
}
