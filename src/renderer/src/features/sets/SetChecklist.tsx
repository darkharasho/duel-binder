import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownAZ, ArrowLeft, ArrowUpAZ, Ellipsis, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import { englishSetName, nativeSetName } from '@shared/setNames'
import type {
  CardSearchResult,
  ChecklistCard,
  CountMode,
  SetChecklist as SetChecklistData,
  SetSummary
} from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { checklistUnpriced, useRequestPrices } from '@/lib/priceRequests'
import { CardSheet } from '@/components/CardSheet'
import { TiltCard } from '@/components/TiltCard'
import { coverArtUrl, setArtUrl, useArtWash } from '@/components/artWashContext'
import { LanguageTag } from '@/components/LanguageTag'
import { PageHeader } from '@/components/PageHeader'
import { listNav } from '@/components/panelNav'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { EntryDetailPanel } from '@/features/collection/EntryDetailPanel'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { isPhone } from '@/lib/platform'
import { createSerialQueue } from '@/lib/serialQueue'
import { cn } from '@/lib/utils'
import { BulkMode } from './BulkMode'
import { SetCardPanel } from './SetCardPanel'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import {
  adjustChecklistCard,
  CHECKLIST_SORTS,
  checklistTiles,
  filterTiles,
  filterTilesByRarity,
  matchesCardSearch,
  patchSetSummary,
  progressFor,
  rarityCounts,
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

/** A card's clicks not yet answered, in queue order, and the server's last answer for it. */
interface InFlight {
  confirmed: ChecklistCard
  ops: { printingId: number; delta: 1 | -1 }[]
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

function RarityChip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'whitespace-nowrap rounded-full border border-white/[0.08] px-2.5 py-1 text-[12px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'
      )}
    >
      {children}
    </button>
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
  const [rarity, setRarity] = useState<string | null>(null)
  const [sort, setSort] = useState<{ by: ChecklistSort; dir: SortDir }>({
    by: 'number',
    dir: 'asc'
  })
  const [selected, setSelected] = useState<{ cardId: number; entryId: number } | null>(null)
  // A card not owned yet opens with steppers instead of an entry editor.
  const [unowned, setUnowned] = useState<{ cardId: number; rarity: string | null } | null>(null)
  // The opened tile, for stepping to its neighbours (a card has one tile per rarity).
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  // Card ids shown in bulk mode, frozen so saves never re-filter a card away mid-click.
  const [frozen, setFrozen] = useState<{
    filter: TileFilter
    mode: CountMode
    ids: Set<number>
  } | null>(null)
  const [pending, setPending] = useState<Record<number, number>>({})
  const queues = useRef(new Map<number, ReturnType<typeof createSerialQueue>>())
  const inFlight = useRef(new Map<number, InFlight>())
  const qc = useQueryClient()
  useBackShortcuts(onBack)

  const checklist = useQuery({
    queryKey: queryKeys.setChecklist(setName, language),
    queryFn: () => api.sets.checklist(setName, language)
  })
  const data = checklist.data
  // An OCG set's unpriced printings: the portal prices them and they show after the next sync.
  useRequestPrices(useMemo(() => checklistUnpriced(data), [data]))
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
            filterTilesByRarity(filterTiles(checklistTiles(data, mode), filter), rarity).filter(
              (t) => matchesCardSearch(t.card, q)
            ),
            sort.by,
            sort.dir
          )
        : [],
    [data, mode, filter, rarity, q, sort]
  )

  // Recompute the frozen ids on entering bulk mode and when the filter or count mode changes.
  if (bulk && data && (!frozen || frozen.filter !== filter || frozen.mode !== mode)) {
    // Bulk layout is one item per card whatever the count mode.
    const ids = filterTiles(checklistTiles(data, 'cards'), filter).map((t) => t.card.cardId)
    setFrozen({ filter, mode, ids: new Set(ids) })
  }
  const bulkCards = useMemo(
    () =>
      data && frozen
        ? sortCards(
            data.cards.filter((c) => frozen.ids.has(c.cardId)),
            sort.by,
            sort.dir
          )
        : [],
    [data, frozen, sort]
  )

  const bumpPending = (cardId: number, by: 1 | -1): void =>
    setPending((p) => ({ ...p, [cardId]: (p[cardId] ?? 0) + by }))

  /** Shows a card as its last server answer with the +/- still in flight applied on top. */
  const show = (f: InFlight): void => {
    const card = f.ops.reduce(
      (c, op) => adjustChecklistCard(c, op.printingId, op.delta),
      f.confirmed
    )
    const next = qc.setQueryData<SetChecklistData | null>(
      queryKeys.setChecklist(setName, language),
      (old) => (old ? replaceChecklistCard(old, card) : old)
    )
    // The set list stays mounted behind the checklist; patch its one row rather than refetch it.
    if (next)
      qc.setQueryData<SetSummary[]>(queryKeys.setsList, (list) =>
        list ? patchSetSummary(list, next.set) : list
      )
  }

  /**
   * Queues one +/- for a card. The count moves at once; each server answer replaces the card (set
   * counts recomputed) with later clicks re-applied, so nothing is refetched per click. Resolves
   * true once the server saved the click, false if it failed; never rejects.
   */
  const adjust = (cardId: number, printingId: number, delta: 1 | -1): Promise<boolean> => {
    const key = queryKeys.setChecklist(setName, language)
    let f = inFlight.current.get(cardId)
    if (!f) {
      const card = qc
        .getQueryData<SetChecklistData | null>(key)
        ?.cards.find((c) => c.cardId === cardId)
      if (!card) return Promise.resolve(false)
      f = { confirmed: card, ops: [] }
      inFlight.current.set(cardId, f)
    }
    const flight = f
    flight.ops.push({ printingId, delta })
    // A checklist fetch landing later would overwrite the optimistic card; cancelling reverts
    // asynchronously, so write after it. show() derives from `flight`, so write order is moot.
    void qc.cancelQueries({ queryKey: key }).then(() => show(flight))

    let queue = queues.current.get(cardId)
    if (!queue) {
      queue = createSerialQueue()
      queues.current.set(cardId, queue)
    }
    bumpPending(cardId, 1)
    /** Retires this click; a failed one (no card) rolls back to the last server answer. */
    const settle = (card: ChecklistCard | null): void => {
      flight.ops.shift()
      if (card) flight.confirmed = card
      if (flight.ops.length === 0) inFlight.current.delete(cardId)
    }
    let saved = false
    return queue(async () => {
      let card: ChecklistCard
      try {
        card = await api.sets.adjust(setName, language, printingId, delta)
      } catch (e) {
        settle(null)
        void qc.cancelQueries({ queryKey: key }).then(() => show(flight))
        throw e
      }
      settle(card)
      await qc.cancelQueries({ queryKey: key })
      show(flight)
      saved = true
    })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not update the collection')
      })
      .finally(() => {
        bumpPending(cardId, -1)
        // Once this card's clicks are done, refresh what else counts copies. Only queries on
        // screen refetch; ['sets'] is skipped since the checklist and set list are patched above.
        if (inFlight.current.has(cardId)) return
        for (const k of mutationInvalidationKeys) {
          if (!(k.length === 1 && k[0] === 'sets')) void qc.invalidateQueries({ queryKey: [...k] })
        }
      })
      .then(() => saved)
  }

  if (data === null) {
    return (
      <div className="space-y-4 p-8 max-md:p-4">
        <BackButton onBack={onBack} />
        <p className="py-16 text-center text-lg font-medium">
          This set is no longer in the card data
        </p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-4 p-8 max-md:p-4">
        <BackButton onBack={onBack} />
      </div>
    )
  }

  const progress = progressFor(data.set, mode)
  const rarities = rarityCounts(data)
  // On the phone the count mode and bulk add move into a "⋯" menu to fit the width.
  const phone = isPhone()
  const toggleBulk = (): void => {
    setBulk(!bulk)
    setFrozen(null)
  }

  const open = (t: Tile): void => {
    setOpenKey(t.key)
    if (t.owned > 0 && t.entryId !== null) {
      setUnowned(null)
      setSelected({ cardId: t.card.cardId, entryId: t.entryId })
      return
    }
    setSelected(null)
    setUnowned({ cardId: t.card.cardId, rarity: t.rarity })
  }
  const close = (): void => {
    setSelected(null)
    setUnowned(null)
  }
  const unownedCard = unowned ? data.cards.find((c) => c.cardId === unowned.cardId) : undefined
  const nav = listNav(
    tiles,
    tiles.findIndex((t) => t.key === openKey),
    open,
    (t) => t.key
  )

  return (
    <TooltipProvider>
      <div className="space-y-4 p-8 max-md:p-4">
        <PageHeader>
          <div className="flex flex-wrap items-center gap-2">
            <BackButton onBack={onBack} />
            <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold">
              <span className="truncate">{englishSetName(data.set.setName, data.set.setCode)}</span>
              <LanguageTag language={data.set.language} />
              {nativeSetName(data.set.setName, data.set.setCode) && (
                <span className="truncate text-sm font-normal text-muted-foreground">
                  {data.set.setName}
                </span>
              )}
            </h1>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-b border-white/[0.08]">
            <UnderlineTabs label="Show" value={filter} options={FILTERS} onChange={setFilter} />
            <div className="ml-auto flex flex-wrap items-center gap-3 pb-2 max-md:ml-0 max-md:w-full max-md:gap-2">
              {!bulk && (
                <div className="relative w-52 max-md:w-full">
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
              )}
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
              {!phone && (
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
              )}
              {bulk && (
                <span className="text-sm text-muted-foreground">Changes save as you click.</span>
              )}
              {(!phone || bulk) && (
                <Button variant={bulk ? 'default' : 'outline'} size="sm" onClick={toggleBulk}>
                  {bulk ? 'Done' : 'Bulk add'}
                </Button>
              )}
              {phone && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm" aria-label="More tools">
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Count</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={mode}
                      onValueChange={(m) => {
                        if (m === 'cards' || m === 'rarities') onModeChange(m)
                      }}
                    >
                      <DropdownMenuRadioItem value="cards">Each card once</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="rarities">Every rarity</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={toggleBulk}>
                      {bulk ? 'Done' : 'Bulk add'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </PageHeader>

        <header className="flex flex-wrap items-center gap-5">
          <SetArt
            imageKey={data.set.imageKey}
            packImageKey={data.set.packImageKey}
            logoImageKey={data.set.logoImageKey}
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

        {!bulk && rarities.length > 1 && (
          <div role="group" aria-label="Filter by rarity" className="flex flex-wrap gap-1.5">
            <RarityChip active={rarity === null} onClick={() => setRarity(null)}>
              All {checklistTiles(data, mode).length}
            </RarityChip>
            {rarities.map((r) => (
              <RarityChip
                key={r.rarity}
                active={rarity === r.rarity}
                onClick={() => setRarity(rarity === r.rarity ? null : r.rarity)}
              >
                {r.rarity} {r.count}
              </RarityChip>
            ))}
          </div>
        )}

        {!bulk && q.trim() !== '' && tiles.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No cards in this set match &ldquo;{q.trim()}&rdquo;
          </p>
        )}

        {bulk ? (
          <BulkMode
            cards={bulkCards}
            setName={data.set.setName}
            pending={pending}
            adjust={adjust}
          />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 max-md:grid-cols-3 max-md:gap-1.5">
            {tiles.map((t) => {
              const owned = t.owned > 0
              return (
                <li key={t.key}>
                  <button
                    type="button"
                    data-owned={owned}
                    data-nav-key={t.key}
                    aria-label={t.rarity ? `${t.card.name}, ${t.rarity}` : t.card.name}
                    onClick={() => open(t)}
                    className={cn(
                      'relative flex w-full flex-col gap-1 rounded-lg p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                      !owned && 'grayscale opacity-40'
                    )}
                  >
                    <TiltCard>
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
                    </TiltCard>
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

        {(selected || (unowned && unownedCard)) && (
          <CardSheet onClose={close}>
            {selected ? (
              <EntryDetailPanel
                cardId={selected.cardId}
                entryId={selected.entryId}
                onSelectEntry={(entryId) => setSelected({ cardId: selected.cardId, entryId })}
                onClose={close}
                nav={nav}
              />
            ) : unowned && unownedCard ? (
              <SetCardPanel
                setName={data.set.setName}
                nav={nav}
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
              />
            ) : null}
          </CardSheet>
        )}
      </div>
    </TooltipProvider>
  )
}
