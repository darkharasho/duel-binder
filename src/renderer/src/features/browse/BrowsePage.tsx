import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownAZ, ArrowUpAZ, Search, SlidersHorizontal } from 'lucide-react'
import type { FilterDef, GameDef, GameId } from '@shared/games'
import type { BrowseCard, BrowseFilters, BrowseSort, CardSearchResult } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWashContext'
import { CardArt } from '@/components/CardArt'
import { CardSheet } from '@/components/CardSheet'
import { TiltCard } from '@/components/TiltCard'
import { FacetMenu } from '@/components/FacetMenu'
import { PageHeader } from '@/components/PageHeader'
import { RangeFilter } from '@/components/RangeFilter'
import { listNav } from '@/components/panelNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { CardPanel } from '@/features/card/CardPanel'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { useGame } from '@/lib/game'
import { RANGE_FIELDS, rangeFilters } from '@/lib/rangeFilters'
import { isPhone } from '@/lib/platform'
import { useSetNames } from '@/lib/setLabels'

const PAGE = 120

type GameKey =
  'cardTypes' | 'attributes' | 'races' | 'archetypes' | 'pkmCategories' | 'pkmTypes' | 'pkmStages' | 'pkmRarities'
type ListKey = GameKey | 'setNames' | 'rarities'
type Filters = Omit<BrowseFilters, 'offset' | 'limit'>

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

/** Browse's own names for some of the games' filters. */
const LABELS: Partial<Record<GameKey, string>> = {
  cardTypes: 'Card type',
  races: 'Monster/Spell type'
}

/** The game's list filters, then Set and the game's word for rarity. */
function facetsFor(def: GameDef): { key: ListKey; label: string }[] {
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

const SORTS: { value: BrowseSort; label: string; dir: 'asc' | 'desc' }[] = [
  { value: 'name', label: 'Name', dir: 'asc' },
  { value: 'released', label: 'Release date', dir: 'desc' },
  { value: 'price', label: 'Price', dir: 'desc' },
  { value: 'atk', label: 'ATK', dir: 'desc' },
  { value: 'def', label: 'DEF', dir: 'desc' },
  { value: 'level', label: 'Level / Link', dir: 'desc' },
  { value: 'hp', label: 'HP', dir: 'desc' }
]

/** The game's sorts: ATK, DEF and Level are Yu-Gi-Oh!'s, HP is Pokémon's. */
const sortsFor = (game: GameId): typeof SORTS =>
  SORTS.filter((s) =>
    game === 'pkm' ? !['atk', 'def', 'level'].includes(s.value) : s.value !== 'hp'
  )

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
  const [filters, setFilters] = useState<Filters>(DEFAULTS)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<{ cardId: number; entryId: number } | null>(null)
  // A card not owned yet opens with a stepper per printing instead of an entry editor.
  const [unowned, setUnowned] = useState<BrowseCard | null>(null)
  // On the phone the facets wait in a bottom sheet behind one Filters button.
  const phone = isPhone()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const qc = useQueryClient()
  const change = (patch: Partial<Filters>): void => setFilters((f) => ({ ...f, ...patch }))
  const { game, def } = useGame()
  const facetList = facetsFor(def)
  const ranges = rangeFilters(def.filters)
  const sorts = sortsFor(game)

  // Debounce search text into the query.
  useEffect(() => {
    const q = text.trim() === '' ? undefined : text
    if (q === filters.q) return
    const t = setTimeout(() => setFilters((f) => ({ ...f, q })), 200)
    return () => clearTimeout(t)
  }, [text, filters.q])

  // Browse lists English printings only.
  const setNames = useSetNames('en')
  const facets = useQuery({
    queryKey: queryKeys.browseFacets,
    queryFn: () => api.cards.browseFacets()
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

  const filtered =
    Boolean(filters.q) ||
    facetList.some(({ key }) => filters[key]?.length) ||
    ranges.some(
      ({ key }) =>
        filters[RANGE_FIELDS[key].min] !== undefined || filters[RANGE_FIELDS[key].max] !== undefined
    ) ||
    filters.owned !== 'all'
  // What the phone's Filters button counts: facet values and each set range, not the search.
  const activeCount =
    facetList.reduce((n, { key }) => n + (filters[key]?.length ?? 0), 0) +
    ranges.filter(
      ({ key }) =>
        filters[RANGE_FIELDS[key].min] !== undefined || filters[RANGE_FIELDS[key].max] !== undefined
    ).length
  const clear = (): void => {
    setFilters({ ...DEFAULTS, sort: filters.sort, dir: filters.dir })
    setText('')
  }

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
  const nav = listNav(
    cards,
    cards.findIndex((c) => c.id === openId),
    // listNav only calls this on a step, never during render.
    // eslint-disable-next-line react-hooks/refs
    (c) => void open(c),
    (c) => c.id
  )

  const search = (
    <div className="relative mr-1 max-md:min-w-0 max-md:flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search cards"
        placeholder="Search by name or set code…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-8 w-60 pl-8 max-md:w-full"
      />
    </div>
  )
  const facetFilters = (
    <>
      {facetList.map(({ key, label }) => (
        <FacetMenu
          key={key}
          label={label}
          options={facets.data?.[key] ?? []}
          selected={filters[key] ?? []}
          onChange={(next) => change({ [key]: next })}
          labelOf={key === 'setNames' ? setNames.labelOf : undefined}
        />
      ))}
      {ranges.map((f) => (
        <RangeFilter key={f.key} filter={f} values={filters} onChange={change} />
      ))}
      {filtered && (
        <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
          Clear filters
        </Button>
      )}
    </>
  )

  return (
    <div className="space-y-5 p-8 max-md:p-4">
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
          <div className="ml-auto flex items-center gap-1.5 pb-2">
            <Select
              value={filters.sort}
              onValueChange={(v) => {
                const s = sorts.find((x) => x.value === v)
                if (s) change({ sort: s.value, dir: s.dir })
              }}
            >
              <SelectTrigger size="sm" aria-label="Sort by" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sorts.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={filters.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
              onClick={() => change({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })}
            >
              {filters.dir === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {search}
          {phone ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters'}
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal />
              Filters
              {activeCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          ) : (
            facetFilters
          )}
        </div>
      </PageHeader>

      {phone && (
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent
            side="bottom"
            data-layout="bottom-sheet"
            className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-white/[0.08] pb-[max(1rem,env(safe-area-inset-bottom))]"
            // Nothing takes focus on opening, so no field raises the keyboard over the sheet.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="sr-only">Filter the card list</SheetDescription>
            </SheetHeader>
            <div className="flex flex-wrap items-center gap-1.5 px-4">{facetFilters}</div>
          </SheetContent>
        </Sheet>
      )}

      {pages.isSuccess && cards.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-16">
          <p className="text-lg font-medium">No cards match</p>
          {filtered && (
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <ul
          aria-label="All cards"
          className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-6 max-md:grid-cols-3 max-md:gap-x-2 max-md:gap-y-4"
        >
          {cards.map((c) => (
            <li key={c.id} className="lazy-item [--lazy-h:290px]">
              <button
                type="button"
                data-nav-key={c.id}
                onClick={() => void open(c)}
                className="group flex w-full flex-col gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <TiltCard>
                  <CardArt
                    imageId={c.imageId}
                    size="small"
                    alt={c.name}
                    className="w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)]"
                  />
                  {c.owned > 0 && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 font-mono text-xs font-semibold text-primary-foreground shadow">
                      ×{c.owned}
                    </span>
                  )}
                </TiltCard>
                <div className="min-w-0 space-y-0.5">
                  <div className="truncate text-[13px] font-semibold">{c.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {statsLine(c)}
                  </div>
                  <div className="flex justify-between font-mono text-[11px]">
                    <span>{c.price !== null ? formatUsd(c.price) : '—'}</span>
                    <span className="text-muted-foreground">{c.releasedAt?.slice(0, 4) ?? ''}</span>
                  </div>
                </div>
              </button>
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
  )
}
