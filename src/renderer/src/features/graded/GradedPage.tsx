import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award, DollarSign, Search } from 'lucide-react'
import { AUTHENTIC, gradeTitle, gradedTotals, type GradedCopy } from '@shared/graded'
import type { NavigateFn } from '@/components/AppShell'
import { useArtWash } from '@/components/artWashContext'
import { CardSheet } from '@/components/CardSheet'
import { EmptyHero, EmptySteps } from '@/components/EmptyHero'
import { PageHeader, type PageStat } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { CardGridSkeleton } from '@/components/ui/loading'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CardPanel } from '@/features/card/CardPanel'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { pageInGame, useGame } from '@/lib/game'
import { SlabPrice } from './GradedCopies'
import { SlabArt } from './SlabArt'

type Sort = 'added' | 'value' | 'grade'

/** A grade's rank for sorting: 10 above 9.5, Authentic last. */
const gradeRank = (g: GradedCopy): number => (g.grade === AUTHENTIC ? -1 : Number(g.grade))

const SORTERS: Record<Sort, (a: GradedCopy, b: GradedCopy) => number> = {
  // The list comes newest first.
  added: () => 0,
  value: (a, b) =>
    (b.value ?? b.market?.price ?? b.rawPrice ?? -1) -
    (a.value ?? a.market?.price ?? a.rawPrice ?? -1),
  grade: (a, b) => gradeRank(b) - gradeRank(a)
}

const matches = (s: GradedCopy, q: string): boolean => {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return [s.card.name, s.printing.setCode, s.company, s.cert, s.label].some((f) =>
    f.toLowerCase().includes(t)
  )
}

const STEPS = [
  {
    icon: Search,
    title: 'Open the card',
    text: 'Find the card in your collection, Browse or a set.'
  },
  {
    icon: Award,
    title: 'Add graded copy',
    text: 'Pick the grading company and grade, and add the cert number.'
  },
  {
    icon: DollarSign,
    title: 'Track its value',
    text: 'Enter what it is worth and what you paid. Slabs stay out of set progress.'
  }
] as const

function NoSlabs({ onNavigate }: { onNavigate?: NavigateFn }): React.JSX.Element {
  const { def } = useGame()
  return (
    <EmptyHero
      id="no-slabs"
      title="No graded cards yet"
      blurb="Track your slabs one by one: grading company, grade, cert number and value."
    >
      {onNavigate && (
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={() => onNavigate('collection')}>
            Go to your collection
          </Button>
          {pageInGame('browse', def) && (
            <Button size="lg" variant="outline" onClick={() => onNavigate('browse')}>
              Browse cards
            </Button>
          )}
        </div>
      )}
      <EmptySteps steps={STEPS} />
    </EmptyHero>
  )
}

/** Every slab of the game shown, as slabs. */
export function GradedPage({ onNavigate }: { onNavigate?: NavigateFn } = {}): React.JSX.Element {
  const graded = useQuery({ queryKey: queryKeys.graded, queryFn: () => api.graded.list() })
  const slabs = useMemo(() => graded.data ?? [], [graded.data])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('added')
  const [open, setOpen] = useState<GradedCopy | null>(null)
  const shown = useMemo(
    () => slabs.filter((s) => matches(s, q)).sort(SORTERS[sort]),
    [slabs, q, sort]
  )
  const washCards = useMemo(
    () => slabs.map((s) => ({ imageId: s.imageId, frameType: s.card.frameType })),
    [slabs]
  )
  useArtWash(washCards)

  const totals = gradedTotals(slabs)
  const stats: PageStat[] = [
    { label: totals.count === 1 ? 'Slab' : 'Slabs', value: totals.count.toLocaleString('en-US') },
    { label: 'Value', value: formatUsd(totals.value) },
    ...(totals.paid > 0 ? [{ label: 'Paid', value: formatUsd(totals.paid) }] : [])
  ]

  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader title="Graded" stats={slabs.length > 0 ? stats : undefined}>
        {totals.unvalued > 0 && (
          <p className="text-sm tabular-nums">{totals.unvalued} without a value or eBay price</p>
        )}
        {slabs.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              label="Search graded cards"
              placeholder="Search by name, set code, company or cert"
              value={q}
              onChange={setQ}
            />
            <ToggleGroup
              type="single"
              variant="outline"
              value={sort}
              onValueChange={(v) => v && setSort(v as Sort)}
              aria-label="Sort"
            >
              <ToggleGroupItem value="added">Newest</ToggleGroupItem>
              <ToggleGroupItem value="value">Value</ToggleGroupItem>
              <ToggleGroupItem value="grade">Grade</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </PageHeader>
      {graded.isSuccess && slabs.length === 0 ? (
        <NoSlabs onNavigate={onNavigate} />
      ) : graded.isPending ? (
        <CardGridSkeleton />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No graded cards match</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6 max-md:grid-cols-2">
          {shown.map((s) => (
            <li key={s.uid}>
              <button
                type="button"
                onClick={() => setOpen(s)}
                aria-label={`${s.card.name}, ${gradeTitle(s)}`}
                className="block w-full space-y-1.5 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <SlabArt slab={s} />
                <div className="flex items-baseline justify-between gap-2 px-0.5 text-xs">
                  <span className="truncate font-mono text-muted-foreground">
                    {s.printing.setCode}
                  </span>
                  <SlabPrice slab={s} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <CardSheet onClose={() => setOpen(null)}>
          <CardPanel
            cardId={open.card.id}
            printingId={open.printing.id}
            seed={{
              name: open.card.name,
              type: open.card.type,
              imageId: open.imageId,
              price: open.rawPrice,
              defaultPrintingId: open.printing.id
            }}
            onClose={() => setOpen(null)}
            slab={open}
          />
        </CardSheet>
      )}
    </div>
  )
}
