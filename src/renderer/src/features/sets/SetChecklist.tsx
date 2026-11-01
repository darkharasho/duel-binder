import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ellipsis } from 'lucide-react'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import { englishSetName, nativeSetName } from '@shared/setNames'
import type {
  CardSearchResult,
  Friend,
  ChecklistCard,
  CountMode,
  SetChecklist as SetChecklistData,
  SetSummary
} from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { checklistUnpriced, useRequestPrices } from '@/lib/priceRequests'
import { useTileImage } from '@/lib/cardSize'
import { useChunkedList } from '@/lib/useChunkedList'
import { CardSheet } from '@/components/CardSheet'
import { FilterBar } from '@/components/FilterBar'
import { FilterOptionChip } from '@/components/FilterChip'
import { ChipOptions, FilterPanel, FilterSection } from '@/components/FilterPanel'
import { TiltCard } from '@/components/TiltCard'
import { coverArtUrl, setArtUrl, useArtWash } from '@/components/artWashContext'
import { LanguageTag } from '@/components/LanguageTag'
import { PageHeader } from '@/components/PageHeader'
import { listNav } from '@/components/panelNav'
import { SearchInput } from '@/components/SearchInput'
import { SortControl } from '@/components/SortControl'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { CardPanel, type CardPanelSeed } from '@/features/card/CardPanel'
import { api, invalidateAfterEdit, queryKeys } from '@/lib/api'
import type { ActiveChip } from '@/lib/filters'
import { useGame } from '@/lib/game'
import { isPhone, isWeb } from '@/lib/platform'
import { createSerialQueue } from '@/lib/serialQueue'
import { useFilterPanel } from '@/lib/useFilterPanel'
import { cn } from '@/lib/utils'
import { PlaceholdersButton } from './PlaceholdersDialog'
import { BulkMode } from './BulkMode'
import { FriendCardSheet } from '../friends/FriendCardSheet'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import {
  adjustChecklistCard,
  checklistSorts,
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
  onAddMissing?: (card: CardSearchResult, printingId: number) => void
  /** Shows this friend's progress read-only instead of your own. */
  friend?: Friend
  /** Whose binder this is, shown above a friend's set. */
  friendHeader?: React.ReactNode
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

/** What the card panel shows of a checklist card until its details load; `rarity` is the opened tile's. */
const seedOf = (card: ChecklistCard, rarity: string | null): CardPanelSeed => ({
  name: card.name,
  type: card.type,
  imageId: card.imageId,
  price: (card.rarities.find((r) => r.rarity === rarity) ?? card.rarities[0])?.price ?? card.price,
  defaultPrintingId:
    (card.rarities.find((r) => r.rarity === rarity) ?? card.rarities[0])?.defaultPrintingId ?? null
})

export function SetChecklist({
  setName,
  language,
  mode,
  onModeChange,
  onBack,
  onAddMissing,
  friend,
  friendHeader
}: SetChecklistProps): React.JSX.Element {
  const { game } = useGame()
  const panel = useFilterPanel()
  const [filter, setFilter] = useState<TileFilter>('all')
  const [q, setQ] = useState('')
  const [pickedRarities, setPickedRarities] = useState<string[]>([])
  const [sort, setSort] = useState<{ by: ChecklistSort; dir: SortDir }>({
    by: 'number',
    dir: 'asc'
  })
  const [selected, setSelected] = useState<{ cardId: number; entryId: number } | null>(null)
  // A card not owned yet opens with steppers instead of an entry editor.
  const [unowned, setUnowned] = useState<{ cardId: number; rarity: string | null } | null>(null)
  // The opened tile, for stepping to its neighbours (a card has one tile per rarity).
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [friendCard, setFriendCard] = useState<{ cardId: number; entryId: number } | null>(null)
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
    queryKey: friend
      ? queryKeys.friendChecklist(friend.id, setName, language)
      : queryKeys.setChecklist(setName, language),
    queryFn: () =>
      friend
        ? api.friends.checklist(friend.id, setName, language)
        : api.sets.checklist(setName, language)
  })
  const data = checklist.data
  // An OCG set's unpriced printings: the portal prices them and they show after the next sync.
  useRequestPrices(useMemo(() => (friend ? [] : checklistUnpriced(data)), [friend, data]))
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
            filterTilesByRarity(
              filterTiles(checklistTiles(data, mode), filter),
              pickedRarities
            ).filter((t) => matchesCardSearch(t.card, q)),
            sort.by,
            sort.dir
          )
        : [],
    [data, mode, filter, pickedRarities, q, sort]
  )
  const shownTiles = useChunkedList(tiles)
  const tileImage = useTileImage()

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
        // Once this card's clicks are done, refresh what else counts copies. ['sets'] is skipped
        // since the checklist and set list are patched above.
        if (inFlight.current.has(cardId)) return
        void invalidateAfterEdit(qc, (k) => k[0] === 'sets')
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

  // A friend's header already holds the page's h1.
  const Title = friend ? 'h2' : 'h1'
  const progress = progressFor(data.set, mode)
  const rarities = rarityCounts(data)
  const sorts = checklistSorts(game)
  // Bulk mode ignores the rarity, so nothing filters there.
  const canFilter = !bulk && rarities.length > 1
  const toggleRarity = (r: string): void =>
    setPickedRarities((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))
  const chips: ActiveChip[] = canFilter
    ? pickedRarities.map((r) => ({ key: r, label: r, onRemove: () => toggleRarity(r) }))
    : []
  // On the phone the count mode and bulk add move into a "⋯" menu to fit the width.
  const phone = isPhone()
  const toggleBulk = (): void => {
    setBulk(!bulk)
    setFrozen(null)
  }

  const open = (t: Tile): void => {
    setOpenKey(t.key)
    if (friend) {
      if (t.entryId !== null) setFriendCard({ cardId: t.card.cardId, entryId: t.entryId })
      return
    }
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
  const openCardId = selected?.cardId ?? unownedCard?.cardId
  const nav = listNav(
    tiles,
    tiles.findIndex((t) => t.key === openKey),
    open,
    (t) => t.key
  )

  return (
    <TooltipProvider>
      <div className="flex items-start">
        <div className="min-w-0 flex-1 space-y-4 p-8 max-md:p-4">
          <PageHeader>
            {friend && friendHeader}
            <div className="flex flex-wrap items-center gap-2">
              <BackButton onBack={onBack} />
              <Title className="flex min-w-0 items-center gap-2 text-xl font-semibold">
                <span className="truncate">
                  {englishSetName(data.set.setName, data.set.setCode)}
                </span>
                <LanguageTag language={data.set.language} />
                {nativeSetName(data.set.setName, data.set.setCode) && (
                  <span className="truncate text-sm font-normal text-muted-foreground">
                    {data.set.setName}
                  </span>
                )}
              </Title>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-b border-white/[0.08]">
              <UnderlineTabs label="Show" value={filter} options={FILTERS} onChange={setFilter} />
              <div className="ml-auto flex flex-wrap items-center gap-3 pb-2 max-md:gap-2">
                {bulk && (
                  <span className="text-sm text-muted-foreground">Changes save as you click.</span>
                )}
                {(!phone || bulk) && !friend && (
                  <Button variant={bulk ? 'default' : 'outline'} size="sm" onClick={toggleBulk}>
                    {bulk ? 'Done' : 'Bulk add'}
                  </Button>
                )}
                {!phone && !friend && !isWeb() && game === 'pkm' && (
                  <PlaceholdersButton set={data.set} cards={data.cards} />
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
                      {!friend && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={toggleBulk}>
                            {bulk ? 'Done' : 'Bulk add'}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            <FilterBar
              sizable
              // Bulk mode has its own search box, and shows every rarity.
              search={
                !bulk && (
                  <SearchInput
                    label="Search this set"
                    placeholder="Search this set by name, number or code"
                    value={q}
                    onChange={setQ}
                  />
                )
              }
              filtersOpen={panel.open}
              onToggleFilters={canFilter ? () => panel.setOpen(!panel.open) : undefined}
              sort={
                <SortControl
                  options={sorts}
                  value={sort.by}
                  dir={sort.dir}
                  onChange={(by, dir) => setSort({ by, dir })}
                />
              }
              toggle={
                !phone && (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={mode}
                    onValueChange={(m) => {
                      if (m === 'cards' || m === 'rarities') onModeChange(m)
                    }}
                  >
                    {/* Short words when the side panel leaves the bar narrow. */}
                    <ToggleGroupItem value="cards" aria-label="Each card once">
                      <span className="@max-2xl:hidden">Each card once</span>
                      <span className="@2xl:hidden">Cards</span>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="rarities" aria-label="Every rarity">
                      <span className="@max-2xl:hidden">Every rarity</span>
                      <span className="@2xl:hidden">Rarities</span>
                    </ToggleGroupItem>
                  </ToggleGroup>
                )
              }
              chips={chips}
              onClearAll={() => setPickedRarities([])}
              resultCount={`${tiles.length.toLocaleString('en-US')} ${tiles.length === 1 ? 'card' : 'cards'}`}
            />
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
                {data.set.tcgDate && ` · ${data.set.tcgDate}`} · {progress.owned} of{' '}
                {progress.total}
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
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(calc(7.5rem*var(--card-scale,1)),1fr))] gap-3 max-md:grid-cols-3 max-md:gap-1.5">
              {shownTiles.map((t) => {
                const owned = t.owned > 0
                return (
                  <li key={t.key} className="lazy-item [--lazy-h:calc(240px*var(--card-scale,1))]">
                    <button
                      type="button"
                      data-owned={owned}
                      data-nav-key={t.key}
                      aria-label={t.rarity ? `${t.card.name}, ${t.rarity}` : t.card.name}
                      disabled={friend !== undefined && !owned}
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
                            (
                              t.card.rarities.find((r) => r.rarity === t.rarity) ??
                              t.card.rarities[0]
                            )?.defaultPrintingId
                          }
                          size={tileImage}
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

          {friend && friendCard && (
            <FriendCardSheet friend={friend} {...friendCard} onClose={() => setFriendCard(null)} />
          )}

          {openCardId !== undefined && (
            <CardSheet onClose={close}>
              <CardPanel
                cardId={openCardId}
                entryId={selected?.entryId}
                seed={unownedCard && seedOf(unownedCard, unowned?.rarity ?? null)}
                caption={
                  unownedCard && `${englishSetName(data.set.setName)} · ${unownedCard.numberLabel}`
                }
                preferSet={{ setName: data.set.setName, language: data.set.language }}
                onlySet={game === 'ygo'}
                onSelectEntry={
                  selected
                    ? (entryId) => setSelected({ cardId: selected.cardId, entryId })
                    : undefined
                }
                onClose={close}
                onMoreOptions={(card, printingId) => {
                  close()
                  onAddMissing?.(card, printingId)
                }}
                nav={nav}
              />
            </CardSheet>
          )}
        </div>
        {canFilter && (
          <FilterPanel
            wide={panel.wide}
            open={panel.open}
            onOpenChange={panel.setOpen}
            description="Filter this set's cards"
            onClearAll={pickedRarities.length > 0 ? () => setPickedRarities([]) : undefined}
          >
            <FilterSection title="Rarity" defaultOpen picked={pickedRarities.length}>
              <ChipOptions>
                {rarities.map((r) => (
                  <FilterOptionChip
                    key={r.rarity}
                    label={r.rarity}
                    count={r.count}
                    selected={pickedRarities.includes(r.rarity)}
                    onClick={() => toggleRarity(r.rarity)}
                  />
                ))}
              </ChipOptions>
            </FilterSection>
          </FilterPanel>
        )}
      </div>
    </TooltipProvider>
  )
}
