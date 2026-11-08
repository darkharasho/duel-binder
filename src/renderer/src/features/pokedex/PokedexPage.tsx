import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GENERATIONS, POKEDEX_SIZE } from '@shared/pokedex'
import { CardSheet } from '@/components/CardSheet'
import { FilterOptionChip } from '@/components/FilterChip'
import { PageHeader } from '@/components/PageHeader'
import { CardPanel } from '@/features/card/CardPanel'
import { api, queryKeys } from '@/lib/api'
import { DexBar, PokedexGrid } from './PokedexGrid'
import { PokedexPanel } from './PokedexPanel'
import { dexTiles, percentText, progress, visibleTiles, type DexFilter } from './pokedexView'

const FILTERS: { value: DexFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'caught', label: 'Caught' },
  { value: 'missing', label: 'Missing' }
]

const EMPTY = { caught: [] }

/**
 * Every Pokémon by National Dex number, caught once you own any card of it. A tile opens the
 * species' panel; a card there opens its card panel in the same sheet, and closing that goes back.
 */
export function PokedexPage(): React.JSX.Element {
  const summary = useQuery({ queryKey: queryKeys.pokedex, queryFn: () => api.pokedex.summary() })
  const tiles = useMemo(() => dexTiles(summary.data ?? EMPTY), [summary.data])
  const [filter, setFilter] = useState<DexFilter>('all')
  const [gen, setGen] = useState<number | null>(null)
  const visible = useMemo(() => visibleTiles(tiles, filter, gen), [tiles, filter, gen])
  const total = progress(tiles)
  const [open, setOpen] = useState<{ dexNo: number; cardId?: number } | null>(null)
  // Stable, so opening a panel doesn't re-render the 1025 tiles.
  const [openSpecies] = useState(() => (dexNo: number) => setOpen({ dexNo }))
  const close = (): void => setOpen((o) => (o?.cardId !== undefined ? { dexNo: o.dexNo } : null))

  return (
    <div className="space-y-5 p-8 max-md:p-4">
      <PageHeader>
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pokédex</h1>
            <p className="mt-0.5 text-[13px] text-foreground/75 tabular-nums">
              {summary.isSuccess
                ? `${total.caught} / ${POKEDEX_SIZE} caught · ${percentText(total)}%`
                : summary.isError
                  ? "Couldn't load your Pokédex"
                  : 'Loading…'}
            </p>
          </div>
          <DexBar caught={total.caught} total={total.total} className="h-1.5 max-w-md" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <FilterOptionChip
              key={f.value}
              label={f.label}
              selected={filter === f.value}
              onClick={() => setFilter(f.value)}
            />
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
          {GENERATIONS.map((g) => (
            <FilterOptionChip
              key={g.gen}
              label={g.label}
              selected={gen === g.gen}
              onClick={() => setGen((cur) => (cur === g.gen ? null : g.gen))}
            />
          ))}
        </div>
      </PageHeader>

      {summary.isSuccess &&
        (visible.length === 0 ? (
          <p className="py-16 text-lg font-medium">
            {filter === 'caught' ? 'None caught yet' : 'All caught'}
          </p>
        ) : (
          <PokedexGrid all={tiles} tiles={visible} onOpen={openSpecies} />
        ))}

      <p className="pt-4 text-[11px] text-muted-foreground">
        Sprites: PokeAPI and the sprite artists credited there.
      </p>

      {open && (
        <CardSheet onClose={close}>
          {open.cardId !== undefined ? (
            <CardPanel key={open.cardId} cardId={open.cardId} onClose={close} />
          ) : (
            <PokedexPanel
              key={open.dexNo}
              dexNo={open.dexNo}
              onOpenCard={(cardId) => setOpen({ dexNo: open.dexNo, cardId })}
            />
          )}
        </CardSheet>
      )}
    </div>
  )
}
