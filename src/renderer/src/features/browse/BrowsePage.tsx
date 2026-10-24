import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownAZ, ArrowUpAZ, Search } from 'lucide-react'
import type { BrowseCard, BrowseFilters, BrowseSort, CardSearchResult } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWash'
import { CardArt } from '@/components/CardArt'
import { FacetMenu } from '@/components/FacetMenu'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'

const PAGE = 120

type ListKey = 'cardTypes' | 'attributes' | 'races' | 'archetypes' | 'setNames' | 'rarities'
type Filters = Omit<BrowseFilters, 'offset' | 'limit'>

const FACETS: { key: ListKey; label: string }[] = [
  { key: 'cardTypes', label: 'Card type' },
  { key: 'attributes', label: 'Attribute' },
  { key: 'races', label: 'Monster/Spell type' },
  { key: 'archetypes', label: 'Archetype' },
  { key: 'setNames', label: 'Set' },
  { key: 'rarities', label: 'Rarity' }
]

const SORTS: { value: BrowseSort; label: string; dir: 'asc' | 'desc' }[] = [
  { value: 'name', label: 'Name', dir: 'asc' },
  { value: 'released', label: 'Release date', dir: 'desc' },
  { value: 'price', label: 'Price', dir: 'desc' },
  { value: 'atk', label: 'ATK', dir: 'desc' },
  { value: 'def', label: 'DEF', dir: 'desc' },
  { value: 'level', label: 'Level / Link', dir: 'desc' }
]

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

function parseLevel(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

interface Props {
  onAddCard: (card: CardSearchResult, printingId: number) => void
}

export function BrowsePage({ onAddCard }: Props): React.JSX.Element {
  const [filters, setFilters] = useState<Filters>(DEFAULTS)
  const [text, setText] = useState('')
  const change = (patch: Partial<Filters>): void => setFilters((f) => ({ ...f, ...patch }))

  // Debounce search text into the query.
  useEffect(() => {
    const q = text.trim() === '' ? undefined : text
    if (q === filters.q) return
    const t = setTimeout(() => setFilters((f) => ({ ...f, q })), 200)
    return () => clearTimeout(t)
  }, [text, filters.q])

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
    FACETS.some(({ key }) => filters[key]?.length) ||
    filters.levelMin !== undefined ||
    filters.levelMax !== undefined ||
    filters.owned !== 'all'
  const clear = (): void => {
    setFilters({ ...DEFAULTS, sort: filters.sort, dir: filters.dir })
    setText('')
  }

  const open = (c: BrowseCard): void => {
    if (c.defaultPrintingId === null) return
    onAddCard(
      { id: c.id, name: c.name, type: c.type, defaultImageId: c.imageId, matchedSetCode: null },
      c.defaultPrintingId
    )
  }

  return (
    <div className="space-y-5 p-8">
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
                const s = SORTS.find((x) => x.value === v)
                if (s) change({ sort: s.value, dir: s.dir })
              }}
            >
              <SelectTrigger size="sm" aria-label="Sort by" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
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
          <div className="relative mr-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search cards"
              placeholder="Search by name or set code…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-8 w-60 pl-8"
            />
          </div>
          {FACETS.map(({ key, label }) => (
            <FacetMenu
              key={key}
              label={label}
              options={facets.data?.[key] ?? []}
              selected={filters[key] ?? []}
              onChange={(next) => change({ [key]: next })}
            />
          ))}
          <div className="flex items-center gap-1 text-[13px] text-foreground/80">
            <span className="px-1">Level</span>
            <Input
              type="number"
              aria-label="Level min"
              placeholder="min"
              value={filters.levelMin ?? ''}
              onChange={(e) => change({ levelMin: parseLevel(e.target.value) })}
              className="h-8 w-14 px-2 font-mono text-xs"
            />
            <span aria-hidden>–</span>
            <Input
              type="number"
              aria-label="Level max"
              placeholder="max"
              value={filters.levelMax ?? ''}
              onChange={(e) => change({ levelMax: parseLevel(e.target.value) })}
              className="h-8 w-14 px-2 font-mono text-xs"
            />
          </div>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
              Clear filters
            </Button>
          )}
        </div>
      </PageHeader>

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
          className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-6"
        >
          {cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => open(c)}
                disabled={c.defaultPrintingId === null}
                title={
                  c.defaultPrintingId === null ? 'No English printing to add' : `Add ${c.name}`
                }
                className="group flex w-full flex-col gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <div className="relative">
                  <CardArt
                    imageId={c.imageId}
                    size="small"
                    alt={c.name}
                    className="w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)] transition-transform duration-200 group-enabled:group-hover:-translate-y-1"
                  />
                  {c.owned > 0 && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 font-mono text-xs font-semibold text-primary-foreground shadow">
                      ×{c.owned}
                    </span>
                  )}
                </div>
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
    </div>
  )
}
