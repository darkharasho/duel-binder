import type { FilterDef, GameDef } from '@shared/games'
import type { CollectionFilters } from '@shared/types'
import { RANGE_FIELDS, rangeFilters } from '@/lib/rangeFilters'

type GameKey =
  'cardTypes' | 'attributes' | 'archetypes' | 'pkmCategories' | 'pkmTypes' | 'pkmStages' | 'pkmRarities'
export type ListKey = GameKey | 'setNames' | 'rarities'

const GAME_KEYS: readonly string[] = [
  'cardTypes',
  'attributes',
  'archetypes',
  'pkmCategories',
  'pkmTypes',
  'pkmStages',
  'pkmRarities'
] satisfies GameKey[]

/** The collection's own names for some of the games' filters. */
const LABELS: Partial<Record<GameKey, string>> = { cardTypes: 'Card type' }

/**
 * The game's list filters the collection has (no Race), then Set and the game's word for rarity,
 * in the order their menus show.
 */
export function facetsFor(def: GameDef): { key: ListKey; label: string }[] {
  return [
    ...def.filters
      .filter(
        (f): f is FilterDef & { key: GameKey } => f.kind === 'multi' && GAME_KEYS.includes(f.key)
      )
      .map((f) => ({ key: f.key, label: LABELS[f.key] ?? f.label })),
    { key: 'setNames', label: 'Set' },
    { key: 'rarities', label: def.vocab.rarity }
  ]
}

/** How many facet values and range filters are set (search and sort aside). */
export function activeFilterCount(f: CollectionFilters, def: GameDef): number {
  return (
    facetsFor(def).reduce((n, { key }) => n + (f[key]?.length ?? 0), 0) +
    rangeFilters(def.filters).filter(
      ({ key }) => f[RANGE_FIELDS[key].min] !== undefined || f[RANGE_FIELDS[key].max] !== undefined
    ).length
  )
}
