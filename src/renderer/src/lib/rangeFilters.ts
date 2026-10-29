import type { FilterDef } from '@shared/games'

/** The filter fields behind each of the games' range filters (GameDef.filters, kind 'range'). */
export const RANGE_FIELDS = {
  level: { min: 'levelMin', max: 'levelMax' },
  hp: { min: 'hpMin', max: 'hpMax' }
} as const

export type RangeKey = keyof typeof RANGE_FIELDS
export type RangeField = (typeof RANGE_FIELDS)[RangeKey]['min' | 'max']

/** A game's range filters that the page's filters have fields for. */
export const rangeFilters = (filters: FilterDef[]): (FilterDef & { key: RangeKey })[] =>
  filters.filter(
    (f): f is FilterDef & { key: RangeKey } => f.kind === 'range' && f.key in RANGE_FIELDS
  )
