import type { CollectionFilters } from '@shared/types'

type ListKey = 'cardTypes' | 'attributes' | 'archetypes' | 'setNames' | 'rarities'

/** The collection's multi-select facets, in the order their menus show. */
export const FACETS: { key: ListKey; label: string }[] = [
  { key: 'cardTypes', label: 'Card type' },
  { key: 'attributes', label: 'Attribute' },
  { key: 'archetypes', label: 'Archetype' },
  { key: 'setNames', label: 'Set' },
  { key: 'rarities', label: 'Rarity' }
]

/** How many facet values and level bounds are set (search and sort aside). */
export function activeFilterCount(f: CollectionFilters): number {
  return (
    FACETS.reduce((n, { key }) => n + (f[key]?.length ?? 0), 0) +
    (f.levelMin !== undefined || f.levelMax !== undefined ? 1 : 0)
  )
}
