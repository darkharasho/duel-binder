import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GENERATIONS, POKEDEX_SIZE } from '@shared/pokedex'
import { useArtWash } from '@/components/artWashContext'
import { CardSheet } from '@/components/CardSheet'
import { FilterOptionChip } from '@/components/FilterChip'
import { PageHeader } from '@/components/PageHeader'
import { PAGE_TITLE } from '@/components/pageHeaderContext'
import { SearchInput } from '@/components/SearchInput'
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
  // The page only shows sprites, so the wash comes from your most valuable owned cards (the
  // Dashboard's list, same query, so it's usually cached already).
  const stats = useQuery({ queryKey: queryKeys.stats, queryFn: () => api.stats.get() })
  const washCards = useMemo(
    () => stats.data?.topEntries.map((e) => ({ imageId: e.imageId, frameType: e.card.frameType })),
    [stats.data]
  )
  useArtWash(washCards ?? null)
  const summary = useQuery({ queryKey: queryKeys.pokedex, queryFn: () => api.pokedex.summary() })
  const tiles = useMemo(() => dexTiles(summary.data ?? EMPTY), [summary.data])
  const [filter, setFilter] = useState<DexFilter>('all')
  const [gen, setGen] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const visible = useMemo(
    () => visibleTiles(tiles, filter, gen, query),
    [tiles, filter, gen, query]
  )
  const total = progress(tiles)
  // `card`: the species' card opened from its panel, `entryId` the copy picked there since.
  const [open, setOpen] = useState<{
    dexNo: number
    card?: { cardId: number; printingId?: number; entryId?: number }
  } | null>(null)
  // Stable, so opening a panel doesn't re-render the 1025 tiles.
  const [openSpecies] = useState(() => (dexNo: number) => setOpen({ dexNo }))
  const close = (): void => setOpen((o) => (o?.card ? { dexNo: o.dexNo } : null))

  return (
    <div className="space-y-5 p-8 max-md:p-4">
      <PageHeader>
        <div className="space-y-2">
          <div>
            <h1 className={PAGE_TITLE}>Pokédex</h1>
            <p className="mt-0.5 text-[13px] tabular-nums">
              {summary.isSuccess
                ? `${total.caught} / ${POKEDEX_SIZE} caught · ${percentText(total)}%`
                : summary.isError
                  ? "Couldn't load your Pokédex"
                  : 'Loading…'}
            </p>
          </div>
          <DexBar caught={total.caught} total={total.total} className="h-1.5 max-w-md" />
        </div>
        {/* Pinned on desktop, so search and filters stay in reach down the dex. */}
        <div data-pin className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SearchInput
            label="Search Pokédex"
            placeholder="Name or number"
            value={query}
            onChange={setQuery}
            className="w-full max-w-xs"
          />
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
        </div>
      </PageHeader>

      {summary.isSuccess &&
        (visible.length === 0 ? (
          <p className="py-16 text-lg font-medium">
            {query.trim() !== ''
              ? `No Pokémon match “${query.trim()}”`
              : filter === 'caught'
                ? 'None caught yet'
                : 'All caught'}
          </p>
        ) : (
          <PokedexGrid all={tiles} tiles={visible} onOpen={openSpecies} />
        ))}

      <p className="pt-4 text-[11px] text-muted-foreground">
        Sprites: PokeAPI and the sprite artists credited there.
      </p>

      {open && (
        <CardSheet onClose={close}>
          {open.card ? (
            // Opens on the printing (and owned copy) the tile showed; with neither the panel has
            // nothing picked and draws no card.
            <CardPanel
              key={open.card.cardId}
              cardId={open.card.cardId}
              entryId={open.card.entryId}
              printingId={open.card.printingId}
              onSelectEntry={(entryId) =>
                setOpen((o) => (o?.card ? { ...o, card: { ...o.card, entryId } } : o))
              }
              onClose={close}
            />
          ) : (
            <PokedexPanel
              key={open.dexNo}
              dexNo={open.dexNo}
              onOpenCard={({ cardId, printingId, entryId }) =>
                setOpen({ dexNo: open.dexNo, card: { cardId, printingId, entryId } })
              }
            />
          )}
        </CardSheet>
      )}
    </div>
  )
}
