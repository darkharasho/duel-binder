import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { CardSearchResult, CountMode } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EntryDetailPanel } from '@/features/collection/EntryDetailPanel'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SetArt } from './SetArt'
import { SetProgress } from './SetProgress'
import { checklistTiles, filterTiles, progressFor, type Tile, type TileFilter } from './setsView'

interface SetChecklistProps {
  setName: string
  mode: CountMode
  onModeChange: (m: CountMode) => void
  onBack: () => void
  onAddMissing: (card: CardSearchResult, printingId: number) => void
}

const FILTERS: { value: TileFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' }
]

function BackButton({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft />
      All sets
    </Button>
  )
}

export function SetChecklist({
  setName,
  mode,
  onModeChange,
  onBack,
  onAddMissing
}: SetChecklistProps): React.JSX.Element {
  const [filter, setFilter] = useState<TileFilter>('all')
  const [selected, setSelected] = useState<{ cardId: number; entryId: number } | null>(null)

  const checklist = useQuery({
    queryKey: queryKeys.setChecklist(setName),
    queryFn: () => api.sets.checklist(setName)
  })
  const data = checklist.data
  const tiles = useMemo(
    () => (data ? filterTiles(checklistTiles(data, mode), filter) : []),
    [data, mode, filter]
  )

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
    const rarity =
      mode === 'rarities' ? t.card.rarities.find((r) => r.rarity === t.rarity) : t.card.rarities[0]
    if (!rarity) return
    onAddMissing(
      {
        id: t.card.cardId,
        name: t.card.name,
        type: t.card.type,
        defaultImageId: t.card.imageId,
        matchedSetCode: null
      },
      rarity.defaultPrintingId
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 p-8">
        <BackButton onBack={onBack} />
        <header className="flex flex-wrap items-center gap-4">
          <SetArt imageKey={data.set.imageKey} setCode={data.set.setCode} className="h-16 w-24" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{data.set.setName}</h1>
            <p className="text-sm tabular-nums text-muted-foreground">
              {data.set.setCode}
              {data.set.tcgDate && ` · ${data.set.tcgDate}`} · {progress.owned} of {progress.total}
            </p>
            <SetProgress progress={progress} className="mt-2 max-w-md" />
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
        </header>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(f) => {
            if (f === 'all' || f === 'owned' || f === 'missing') setFilter(f)
          }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

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
                  <CardArt imageId={t.card.imageId} size="small" alt="" className="w-full" />
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

        {selected && (
          <EntryDetailPanel
            cardId={selected.cardId}
            entryId={selected.entryId}
            onSelectEntry={(entryId) => setSelected({ cardId: selected.cardId, entryId })}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
