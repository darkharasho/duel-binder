import { LANGUAGES, type LanguageFilter } from '@shared/languages'
import type { FilterDef, GameDef } from '@shared/games'
import { englishSetName } from '@shared/setNames'
import { DEFAULT_LANGUAGE } from '@/lib/languageFilter'
import { RANGE_FIELDS, type RangeField, type RangeKey } from '@/lib/rangeFilters'

type GameKey =
  | 'cardTypes'
  | 'attributes'
  | 'races'
  | 'archetypes'
  | 'pkmCategories'
  | 'pkmTypes'
  | 'pkmStages'
  | 'pkmRarities'
export type ListKey = GameKey | 'setNames' | 'rarities'

/** The part of a page's filters the card facets and ranges read and write. */
export type CardFilterValues = Partial<Record<ListKey, string[]>> &
  Partial<Record<RangeField, number>>

const GAME_KEYS: readonly string[] = [
  'cardTypes',
  'attributes',
  'races',
  'archetypes',
  'pkmCategories',
  'pkmTypes',
  'pkmStages',
  'pkmRarities'
] satisfies GameKey[]

/** The pages' own names for some of the games' filters. */
const LABELS: Partial<Record<GameKey, string>> = {
  cardTypes: 'Card type',
  races: 'Monster/Spell type'
}

export type FacetScope = 'collection' | 'browse'

/**
 * The game's list filters, then Set and the game's word for rarity, in the order they show. The
 * collection has no Race facet; Browse does.
 */
export function facetsFor(
  def: GameDef,
  scope: FacetScope = 'collection'
): { key: ListKey; label: string }[] {
  return [
    ...def.filters
      .filter(
        (f): f is FilterDef & { key: GameKey } =>
          f.kind === 'multi' &&
          GAME_KEYS.includes(f.key) &&
          (scope === 'browse' || f.key !== 'races')
      )
      .map((f) => ({ key: f.key, label: LABELS[f.key] ?? f.label })),
    { key: 'setNames', label: 'Set' },
    { key: 'rarities', label: def.vocab.rarity }
  ]
}

/** One removable filter under the search row. A bar's active count is how many of these it has. */
export interface ActiveChip {
  key: string
  label: string
  onRemove: () => void
}

/** A chip per facet value and per set range. */
export function cardFilterChips(
  filters: CardFilterValues,
  facets: { key: ListKey }[],
  ranges: (FilterDef & { key: RangeKey })[],
  setLabelOf: (setName: string) => string,
  onChange: (patch: CardFilterValues) => void
): ActiveChip[] {
  const values = facets.flatMap(({ key }) =>
    (filters[key] ?? []).map((v) => ({
      key: `${key}:${v}`,
      label: key === 'setNames' ? setLabelOf(v) : v,
      onRemove: () => {
        const next = (filters[key] ?? []).filter((x) => x !== v)
        onChange({ [key]: next.length > 0 ? next : undefined })
      }
    }))
  )
  const bounds = ranges.flatMap((f) => {
    const { min, max } = RANGE_FIELDS[f.key]
    if (filters[min] === undefined && filters[max] === undefined) return []
    return [
      {
        key: f.key,
        label: `${f.label} ${filters[min] ?? ''}–${filters[max] ?? ''}`,
        onRemove: () => onChange({ [min]: undefined, [max]: undefined })
      }
    ]
  })
  return [...values, ...bounds]
}

/** The language's chip: none on the default, which isn't a filter; removing it goes back there. */
export function languageChip(
  language: LanguageFilter,
  setLanguage: (l: LanguageFilter) => void
): ActiveChip[] {
  if (language === DEFAULT_LANGUAGE) return []
  const label =
    language === 'all'
      ? 'All languages'
      : (LANGUAGES.find((l) => l.code === language)?.label ?? language)
  return [{ key: 'language', label, onRemove: () => setLanguage(DEFAULT_LANGUAGE) }]
}

/** `defaults` with the search and sort of `filters`: what Clear all leaves on every page. */
export function clearedFilters<F extends { q?: string; sort: unknown; dir: unknown }>(
  filters: F,
  defaults: F
): F {
  return { ...defaults, q: filters.q, sort: filters.sort, dir: filters.dir }
}

export interface SortOption<T extends string> {
  value: T
  dir: 'asc' | 'desc'
  label: string
}

const SORT_WORDS = {
  text: { asc: 'A to Z', desc: 'Z to A' },
  number: { asc: 'low to high', desc: 'high to low' },
  date: { asc: 'oldest first', desc: 'newest first' }
} as const

/** Each sort both ways, the way it starts in first: "Price: high to low", "Price: low to high". */
export function sortOptions<T extends string>(
  sorts: readonly { value: T; label: string; kind: keyof typeof SORT_WORDS; dir: 'asc' | 'desc' }[]
): SortOption<T>[] {
  return sorts.flatMap(({ value, label, kind, dir }) =>
    ([dir, dir === 'asc' ? 'desc' : 'asc'] as const).map((d) => ({
      value,
      dir: d,
      label: `${label}: ${SORT_WORDS[kind][d]}`
    }))
  )
}

/** Whether a set matches a search: its name, its English name or its code. */
export function matchesSetSearch(s: { setName: string; setCode: string }, q: string): boolean {
  const needle = q.trim().toLowerCase()
  return (
    !needle ||
    s.setName.toLowerCase().includes(needle) ||
    englishSetName(s.setName, s.setCode).toLowerCase().includes(needle) ||
    s.setCode.toLowerCase().includes(needle)
  )
}
