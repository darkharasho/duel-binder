import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GameId } from '@shared/games'
import { LANGUAGES } from '@shared/languages'
import type { BrowseCard, BrowseFilters, BrowseSort, CardSearchResult } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWashContext'
import { CardArt } from '@/components/CardArt'
import { CardSheet } from '@/components/CardSheet'
import { FavouriteHeart } from '@/components/FavouriteHeart'
import { TiltCard } from '@/components/TiltCard'
import { TILE, TILE_BUTTON, TILE_HEART, TILE_NAME } from '@/components/tileLayout'
import { LanguageTag } from '@/components/LanguageTag'
import { useTileImage } from '@/lib/cardSize'
import { FilterBar } from '@/components/FilterBar'
import {
  CardFilterSections,
  FavouritesSection,
  FilterPanel,
  LanguageSection
} from '@/components/FilterPanel'
import { PageHeader } from '@/components/PageHeader'
import { listNav } from '@/components/panelNav'
import { SearchInput } from '@/components/SearchInput'
import { SortControl } from '@/components/SortControl'
import { Button } from '@/components/ui/button'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { CardPanel } from '@/features/card/CardPanel'
import { usePrefetchNeighbours } from '@/features/card/usePrefetchNeighbours'
import { api, queryKeys } from '@/lib/api'
import {
  cardFilterChips,
  clearedFilters,
  facetsFor,
  languageChip,
  favouritesChip,
  sortOptions
} from '@/lib/filters'
import { HIDDEN_SORTS, type SortOption } from '@/lib/filters'
import { useFavourites } from '@/lib/favourites'
import { formatUsd } from '@/lib/format'
import { useGame } from '@/lib/game'
import { DEFAULT_LANGUAGE, useLanguageFilter } from '@/lib/languageFilter'
import { rangeFilters } from '@/lib/rangeFilters'
import { useSetNames } from '@/lib/setLabels'
import { useFilterPanel } from '@/lib/useFilterPanel'
import { cn } from '@/lib/utils'

const PAGE = 120

type Filters = Omit<BrowseFilters, 'offset' | 'limit' | 'language'>

const SORTS = [
  { value: 'name', label: 'Name', kind: 'text', dir: 'asc' },
  { value: 'released', label: 'Release date', kind: 'date', dir: 'desc' },
  { value: 'price', label: 'Price', kind: 'number', dir: 'desc' },
  { value: 'atk', label: 'ATK', kind: 'number', dir: 'desc' },
  { value: 'def', label: 'DEF', kind: 'number', dir: 'desc' },
  { value: 'level', label: 'Level / Link', kind: 'number', dir: 'desc' },
  { value: 'hp', label: 'HP', kind: 'number', dir: 'desc' },
  { value: 'cost', label: 'Cost', kind: 'number', dir: 'asc' },
  { value: 'power', label: 'Power', kind: 'number', dir: 'desc' }
] as const

/** The game's sorts: ATK, DEF and Level are Yu-Gi-Oh!'s, HP is Pokémon's, Cost and Power One Piece's. */
const sortsFor = (game: GameId): SortOption<BrowseSort>[] =>
  sortOptions<BrowseSort>(SORTS.filter((s) => !HIDDEN_SORTS[game].includes(s.value)))

const OWNED = [
  { value: 'all', label: 'All cards' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Not owned' }
] as const

const DEFAULTS: Filters = { sort: 'name', dir: 'asc', owned: 'all' }

function statsLine(c: BrowseCard): string {
  if (c.atk === null) return c.race
  const rank = c.linkval !== null ? `LINK-${c.linkval}` : c.level !== null ? `★${c.level}` : ''
  const def = c.linkval !== null ? '' : ` / ${c.def ?? '?'}`
  return `${rank} · ${c.atk}${def}`
}

interface Props {
  onAddCard: (card: CardSearchResult, printingId: number) => void
}

export function BrowsePage({ onAddCard }: Props): React.JSX.Element {
  const [pageFilters, setFilters] = useState<Filters>(DEFAULTS)
  const [languageFilter, setLanguageFilter] = useLanguageFilter()
  // The language is the shared app-wide setting (the Collection page's), not page state.
  const language = languageFilter === 'all' ? undefined : languageFilter
  const filters = useMemo<BrowseFilters>(
    () => ({ ...pageFilters, language }),
    [pageFilters, language]
  )
  const tileImage = useTileImage()
  const [selected, setSelected] = useState<{ cardId: number; entryId: number } | null>(null)
  // A card not owned yet opens with a stepper per printing instead of an entry editor.
  const [unowned, setUnowned] = useState<BrowseCard | null>(null)
  const panel = useFilterPanel()
  const qc = useQueryClient()
  const change = (patch: Partial<Filters>): void => setFilters((f) => ({ ...f, ...patch }))
  const { game, def } = useGame()
  const facetList = facetsFor(def, 'browse')
  const ranges = rangeFilters(def.filters)
  const sorts = sortsFor(game)

  const setNames = useSetNames(languageFilter)
  const facets = useQuery({
    queryKey: queryKeys.browseFacets(languageFilter),
    queryFn: () => api.cards.browseFacets(language)
  })
  const pages = useInfiniteQuery({
    queryKey: queryKeys.browse(filters),
    queryFn: ({ pageParam }) => api.cards.browse({ ...filters, offset: pageParam, limit: PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.cards.length, 0)
      return loaded < last.total ? loaded : undefined
    }
  })
  const cards = useMemo(() => pages.data?.pages.flatMap((p) => p.cards) ?? [], [pages.data])
  const total = pages.data?.pages[0]?.total ?? 0
  useArtWash(cards[0] ? cardArtUrl(cards[0].imageId) : null)

  // Load the next page as the end of the grid scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage)
          void fetchNextPage()
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const cardChips = cardFilterChips(filters, facetList, ranges, setNames.labelOf, change)
  const chips = [
    ...languageChip(languageFilter, setLanguageFilter),
    ...favouritesChip(filters.favourites, change),
    ...cardChips
  ]
  const favourites = useFavourites()
  // The Show tabs stay as they are, like the checklist's: Clear all is for the Filters panel.
  const clear = (): void => {
    setFilters((f) => ({ ...clearedFilters(f, DEFAULTS), owned: f.owned }))
    setLanguageFilter(DEFAULT_LANGUAGE)
  }
  // The language alone hides every card (one the game has no printings in, say).
  const hiddenByLanguage =
    language !== undefined &&
    !filters.q &&
    cardChips.length === 0 &&
    filters.owned === 'all' &&
    !filters.favourites
  const languageLabel = LANGUAGES.find((l) => l.code === languageFilter)?.label ?? ''

  // Stepping quickly can overlap lookups of owned cards; only the latest open lands.
  const opening = useRef(0)
  const open = async (c: BrowseCard): Promise<void> => {
    const n = ++opening.current
    if (c.owned > 0) {
      const copies = await qc.fetchQuery({
        queryKey: queryKeys.forCard(c.id),
        queryFn: () => api.collection.forCard(c.id)
      })
      if (n !== opening.current) return
      if (copies[0]) {
        setUnowned(null)
        setSelected({ cardId: c.id, entryId: copies[0].id })
        return
      }
    }
    setSelected(null)
    setUnowned(c)
  }
  const close = (): void => {
    opening.current++
    setSelected(null)
    setUnowned(null)
  }
  const openId = selected?.cardId ?? unowned?.id
  const openIndex = openId === undefined ? -1 : cards.findIndex((c) => c.id === openId)
  usePrefetchNeighbours(
    openIndex === -1 ? undefined : cards[openIndex - 1]?.id,
    openIndex === -1 ? undefined : cards[openIndex + 1]?.id
  )
  const nav = listNav(
    cards,
    openIndex,
    // listNav only calls this on a step, never during render.
    // eslint-disable-next-line react-hooks/refs
    (c) => void open(c),
    (c) => c.id
  )

  return (
    <div className="flex items-start">
      <div className="min-w-0 flex-1 space-y-5 p-8 max-md:p-4">
        <PageHeader>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Browse</h1>
            <p className="mt-0.5 text-[13px] text-foreground/75 tabular-nums">
              {pages.isSuccess ? `${total.toLocaleString('en-US')} cards` : 'Loading cards…'}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-white/[0.08]">
            <UnderlineTabs
              label="Show"
              value={filters.owned ?? 'all'}
              options={OWNED}
              onChange={(owned) => change({ owned })}
            />
          </div>
          <FilterBar
            sizable
            search={
              <SearchInput
                label="Search cards"
                placeholder="Search cards by name or set code"
                value={filters.q ?? ''}
                onChange={(q) => change({ q: q.trim() === '' ? undefined : q })}
              />
            }
            filtersOpen={panel.open}
            onToggleFilters={() => panel.setOpen(!panel.open)}
            sort={
              <SortControl
                options={sorts}
                value={filters.sort}
                dir={filters.dir}
                onChange={(sort, dir) => change({ sort, dir })}
              />
            }
            chips={chips}
            onClearAll={clear}
            resultCount={pages.isSuccess ? `${total.toLocaleString('en-US')} cards` : undefined}
          />
        </PageHeader>

        {pages.isSuccess && cards.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-16">
            <p className="text-lg font-medium">
              {hiddenByLanguage ? `No ${languageLabel} cards` : 'No cards match'}
            </p>
            {hiddenByLanguage ? (
              <Button variant="outline" onClick={() => setLanguageFilter('all')}>
                Show all languages
              </Button>
            ) : chips.length > 0 ? (
              <Button variant="outline" onClick={clear}>
                Clear all
              </Button>
            ) : (
              filters.q && (
                <Button variant="outline" onClick={() => change({ q: undefined })}>
                  Clear search
                </Button>
              )
            )}
          </div>
        ) : (
          <ul
            aria-label="All cards"
            className="grid grid-cols-[repeat(auto-fill,minmax(calc(140px*var(--card-scale,1)),1fr))] gap-x-4 gap-y-6 max-md:grid-cols-3 max-md:gap-x-2 max-md:gap-y-4"
          >
            {cards.map((c) => (
              <li
                key={c.id}
                className={cn(TILE, 'lazy-item [--lazy-h:calc(290px*var(--card-scale,1))]')}
              >
                <button
                  type="button"
                  data-nav-key={c.id}
                  onClick={() => void open(c)}
                  className={cn(
                    TILE_BUTTON,
                    'group rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <TiltCard className="mb-2">
                    <CardArt
                      imageId={c.imageId}
                      // Filtered to a rarity, the tile shows that rarity's printing (an overframe).
                      printingId={filters.rarities?.length ? c.defaultPrintingId : undefined}
                      size={tileImage}
                      alt={c.name}
                      className="w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)]"
                    />
                    {c.owned > 0 && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 font-mono text-xs font-semibold text-primary-foreground shadow">
                        ×{c.owned}
                      </span>
                    )}
                  </TiltCard>
                  {/* With every language shown, a Magic card's languages are same-named tiles. */}
                  <div
                    className={cn('flex items-center gap-1 text-[13px] font-semibold', TILE_NAME)}
                    title={c.localName}
                  >
                    <span className="truncate">{c.name}</span>
                    {language === undefined && c.language && (
                      <LanguageTag language={c.language} className="shrink-0" />
                    )}
                  </div>
                  <div className="mt-0.5 min-w-0 space-y-0.5">
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {statsLine(c)}
                    </div>
                    <div className="flex justify-between font-mono text-[11px]">
                      <span>{c.price !== null ? formatUsd(c.price) : '—'}</span>
                      <span className="text-muted-foreground">
                        {c.releasedAt?.slice(0, 4) ?? ''}
                      </span>
                    </div>
                  </div>
                </button>
                <FavouriteHeart
                  cardId={c.id}
                  name={c.name}
                  favourites={favourites}
                  className={TILE_HEART}
                />
              </li>
            ))}
          </ul>
        )}

        <div ref={sentinel} className="flex justify-center py-4">
          {hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>

        {openId !== undefined && (
          <CardSheet onClose={close}>
            <CardPanel
              cardId={openId}
              entryId={selected?.entryId}
              seed={unowned ?? undefined}
              onSelectEntry={
                selected
                  ? (entryId) => setSelected({ cardId: selected.cardId, entryId })
                  : undefined
              }
              onClose={close}
              onMoreOptions={(card, printingId) => {
                close()
                onAddCard(card, printingId)
              }}
              nav={nav}
            />
          </CardSheet>
        )}
      </div>
      <FilterPanel
        wide={panel.wide}
        open={panel.open}
        onOpenChange={panel.setOpen}
        description="Filter the card list"
        onClearAll={chips.length > 0 ? clear : undefined}
      >
        <LanguageSection
          value={languageFilter}
          onChange={setLanguageFilter}
          available={facets.data?.languages ?? []}
        />
        <FavouritesSection on={filters.favourites === true} onChange={change} />
        <CardFilterSections
          facetList={facetList}
          ranges={ranges}
          filters={filters}
          options={(key) => facets.data?.[key] ?? []}
          setLabelOf={setNames.labelOf}
          onChange={change}
        />
      </FilterPanel>
    </div>
  )
}
