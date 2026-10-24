import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownAZ, ArrowLeft, ArrowUpAZ, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import type { CardSearchResult, CountMode, SetChecklist as SetChecklistData } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { coverArtUrl, setArtUrl, useArtWash } from '@/components/artWash'
import { LanguageTag } from '@/components/LanguageTag'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { EntryDetailPanel } from '@/features/collection/EntryDetailPanel'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { createSerialQueue } from '@/lib/serialQueue'
import { cn } from '@/lib/utils'
import { BulkCard } from './BulkCard'
import { SetCardPanel } from './SetCardPanel'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import {
  CHECKLIST_SORTS,
  checklistTiles,
  filterTiles,
  matchesCardSearch,
  progressFor,
  replaceChecklistCard,
  sortCards,
  sortTiles,
  type ChecklistSort,
  type SortDir,
  type Tile,
  type TileFilter
} from './setsView'

interface SetChecklistProps {
  setName: string
  language: Language
  mode: CountMode
  onModeChange: (m: CountMode) => void
  onBack: () => void
  onAddMissing: (card: CardSearchResult, printingId: number) => void
}

const FILTERS: readonly { value: TileFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' }
]

function BackButton({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <Button variant="ghost" size="sm" onClick={onBack} title="Back to all sets (Esc)">
      <ArrowLeft />
      All sets
    </Button>
  )
}

/** Esc and the mouse's back button leave the set, unless a dialog or panel is open. */
function useBackShortcuts(onBack: () => void): void {
  const latest = useRef(onBack)
  useEffect(() => {
    latest.current = onBack
  })
  useEffect(() => {
    const overlayOpen = (): boolean => document.querySelector('[role="dialog"]') !== null
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen()) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      latest.current()
    }
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3 && !overlayOpen()) latest.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])
}

export function SetChecklist({
  setName,
  language,
  mode,
  onModeChange,
  onBack,
  onAddMissing
}: SetChecklistProps): React.JSX.Element {
  const [filter, setFilter] = useState<TileFilter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ by: ChecklistSort; dir: SortDir }>({ by: 'number', dir: 'asc' })
  const [selected, setSelected] = useState<{ cardId: number; entryId: number } | null>(null)
  // A card not owned yet opens with steppers instead of an entry editor.
  const [unowned, setUnowned] = useState<{ cardId: number; rarity: string | null } | null>(null)
  const [bulk, setBulk] = useState(false)
  // Card ids shown in bulk mode, frozen so saves never re-filter a card away mid-click.
  const [frozen, setFrozen] = useState<{
    filter: TileFilter
    mode: CountMode
    ids: Set<number>
  } | null>(null)
  const [pending, setPending] = useState<Record<number, number>>({})
  const queues = useRef(new Map<number, ReturnType<typeof createSerialQueue>>())
  const qc = useQueryClient()
  useBackShortcuts(onBack)

  const checklist = useQuery({
    queryKey: queryKeys.setChecklist(setName, language),
    queryFn: () => api.sets.checklist(setName, language)
  })
  const data = checklist.data
  useArtWash(
    data?.set.coverImageId
      ? coverArtUrl(data.set.coverImageId)
      : data?.set.imageKey
        ? setArtUrl(data.set.imageKey)
        : null
  )
  const tiles = useMemo(
    () =>
      data
        ? sortTiles(
            filterTiles(checklistTiles(data, mode), filter).filter((t) =>
              matchesCardSearch(t.card, q)
            ),
            sort.by,
            sort.dir
          )
        : [],
    [data, mode, filter, q, sort]
  )

  // Recompute the frozen ids on entering bulk mode and when the filter or count mode changes.
  if (bulk && data && (!frozen || frozen.filter !== filter || frozen.mode !== mode)) {
    // Bulk layout is one item per card whatever the count mode.
    const ids = filterTiles(checklistTiles(data, 'cards'), filter).map((t) => t.card.cardId)
    setFrozen({ filter, mode, ids: new Set(ids) })
  }
  const bulkCards =
    data && frozen
      ? sortCards(
          data.cards.filter((c) => frozen.ids.has(c.cardId) && matchesCardSearch(c, q)),
          sort.by,
          sort.dir
        )
      : []

  const bumpPending = (cardId: number, by: 1 | -1): void =>
    setPending((p) => ({ ...p, [cardId]: (p[cardId] ?? 0) + by }))

  /** Queues one +/- for a card; the server's card replaces ours (set counts recomputed), never refetched. */
  const adjust = (cardId: number, printingId: number, delta: 1 | -1): void => {
    let queue = queues.current.get(cardId)
    if (!queue) {
      queue = createSerialQueue()
      queues.current.set(cardId, queue)
    }
    bumpPending(cardId, 1)
    queue(async () => {
      const card = await api.sets.adjust(setName, language, printingId, delta)
      await qc.cancelQueries({ queryKey: queryKeys.setChecklist(setName, language) })
      qc.setQueryData<SetChecklistData | null>(queryKeys.setChecklist(setName, language), (old) =>
        old ? replaceChecklistCard(old, card) : old
      )
      void qc.invalidateQueries({ queryKey: [...queryKeys.setsList] })
      for (const k of mutationInvalidationKeys) {
        if (!(k.length === 1 && k[0] === 'sets')) void qc.invalidateQueries({ queryKey: [...k] })
      }
    })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not update the collection')
      })
      .finally(() => bumpPending(cardId, -1))
  }

  if (data === null) {
    return (
      <div className="space-y-4 p-8">
        <BackButton onBack={onBack} />
        <p className="py-16 text-center text-lg font-medium">
          This set is no longer in the card data
        </p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-4 p-8">
        <BackButton onBack={onBack} />
      </div>
    )
  }

  const progress = progressFor(data.set, mode)

  const open = (t: Tile): void => {
    if (t.owned > 0 && t.entryId !== null) {
      setSelected({ cardId: t.card.cardId, entryId: t.entryId })
      return
    }
    setUnowned({ cardId: t.card.cardId, rarity: t.rarity })
  }
  const unownedCard = unowned ? data.cards.find((c) => c.cardId === unowned.cardId) : undefined

  return (
    <TooltipProvider>
      <div className="space-y-4 p-8">
        <PageHeader>
          <div className="flex flex-wrap items-center gap-2">
            <BackButton onBack={onBack} />
            <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold">
              <span className="truncate">{data.set.setName}</span>
              <LanguageTag language={data.set.language} />
            </h1>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-b border-white/[0.08]">
            <UnderlineTabs label="Show" value={filter} options={FILTERS} onChange={setFilter} />
            <div className="ml-auto flex flex-wrap items-center gap-3 pb-2">
              <div className="relative w-52">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search this set"
                  aria-label="Search this set"
                  className="h-8 pl-8"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  value={sort.by}
                  onValueChange={(v) => {
                    const o = CHECKLIST_SORTS.find((x) => x.value === v)
                    if (o) setSort({ by: o.value, dir: o.dir })
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Sort by" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHECKLIST_SORTS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={sort.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                  onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
                >
                  {sort.dir === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
                </Button>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={mode}
                onValueChange={(m) => {
                  if (m === 'cards' || m === 'rarities') onModeChange(m)
                }}
              >
                <ToggleGroupItem value="cards">Each card once</ToggleGroupItem>
                <ToggleGroupItem value="rarities">Every rarity</ToggleGroupItem>
              </ToggleGroup>
              {bulk && (
                <span className="text-sm text-muted-foreground">Changes save as you click.</span>
              )}
              <Button
                variant={bulk ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setBulk(!bulk)
                  setFrozen(null)
                }}
              >
                {bulk ? 'Done' : 'Bulk add'}
              </Button>
            </div>
          </div>
        </PageHeader>

        <header className="flex flex-wrap items-center gap-5">
          <SetArt
            imageKey={data.set.imageKey}
            packImageKey={data.set.packImageKey}
            coverImageId={data.set.coverImageId}
            setCode={data.set.setCode}
            className="size-24 rounded-[3px] shadow-[0_8px_20px_rgb(0_0_0/0.5)]"
          />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-foreground/75">
              {data.set.setCode}
              {data.set.tcgDate && ` · ${data.set.tcgDate}`} · {progress.owned} of {progress.total}
            </p>
            {data.set.listRows !== null && data.set.unmatchedRows ? (
              <p className="text-sm text-muted-foreground">
                {data.set.listRows - data.set.unmatchedRows} of {data.set.listRows} cards listed;{' '}
                {data.set.unmatchedRows} couldn&apos;t be identified
              </p>
            ) : null}
            <SetProgress progress={progress} className="mt-2 max-w-md" />
          </div>
        </header>

        {q.trim() !== '' && (bulk ? bulkCards : tiles).length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No cards in this set match &ldquo;{q.trim()}&rdquo;
          </p>
        )}

        {bulk ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {bulkCards.map((card) => (
              <BulkCard
                key={card.cardId}
                card={card}
                busy={(pending[card.cardId] ?? 0) > 0}
                onAdjust={(printingId, delta) => adjust(card.cardId, printingId, delta)}
              />
            ))}
          </ul>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
            {tiles.map((t) => {
              const owned = t.owned > 0
              return (
                <li key={t.key}>
                  <button
                    type="button"
                    data-owned={owned}
                    aria-label={t.rarity ? `${t.card.name}, ${t.rarity}` : t.card.name}
                    onClick={() => open(t)}
                    className={cn(
                      'relative flex w-full flex-col gap-1 rounded-lg p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                      !owned && 'grayscale opacity-40'
                    )}
                  >
                    <CardArt
                      imageId={t.card.imageId}
                      printingId={
                        (t.card.rarities.find((r) => r.rarity === t.rarity) ?? t.card.rarities[0])
                          ?.defaultPrintingId
                      }
                      size="small"
                      alt=""
                      className="w-full"
                    />
                    {owned && (
                      <span className="absolute right-2.5 top-2.5 rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">
                        ×{t.owned}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t.card.numberLabel}
                    </span>
                    <span className="truncate text-xs font-medium">{t.card.name}</span>
                    {t.rarity && (
                      <span className="truncate text-xs text-muted-foreground">{t.rarity}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {selected && (
          <EntryDetailPanel
            cardId={selected.cardId}
            entryId={selected.entryId}
            onSelectEntry={(entryId) => setSelected({ cardId: selected.cardId, entryId })}
            onClose={() => setSelected(null)}
          />
        )}
        {unowned && unownedCard && (
          <SetCardPanel
            setName={data.set.setName}
            card={unownedCard}
            rarity={unowned.rarity}
            busy={(pending[unownedCard.cardId] ?? 0) > 0}
            onAdjust={(printingId, delta) => adjust(unownedCard.cardId, printingId, delta)}
            onMoreOptions={(printingId) => {
              setUnowned(null)
              onAddMissing(
                {
                  id: unownedCard.cardId,
                  name: unownedCard.name,
                  type: unownedCard.type,
                  defaultImageId: unownedCard.imageId,
                  matchedSetCode: null
                },
                printingId
              )
            }}
            onClose={() => setUnowned(null)}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
