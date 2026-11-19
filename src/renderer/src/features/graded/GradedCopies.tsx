import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { gradeTitle, type GradedCopy } from '@shared/graded'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { GradedForm, type GradedPrinting } from './GradedForm'
import { SlabArt } from './SlabArt'

/**
 * A slab's price line: its value, else what eBay asks for its grade (marked so), else the raw
 * card's price marked as such.
 */
export function SlabPrice({ slab }: { slab: GradedCopy }): React.JSX.Element | null {
  if (slab.value !== null) return <span className="tabular-nums">{formatUsd(slab.value)}</span>
  if (slab.market)
    return (
      <span
        className="tabular-nums"
        title={`No value entered: the median of ${slab.market.listings} eBay listings of a ${gradeTitle(slab)}`}
      >
        {formatUsd(slab.market.price)} <span className="text-muted-foreground">eBay</span>
      </span>
    )
  if (slab.rawPrice === null) return null
  return (
    <span
      className="text-muted-foreground tabular-nums"
      title="No value entered: the raw card's price"
    >
      {formatUsd(slab.rawPrice)} raw
    </span>
  )
}

/**
 * The card panel's graded copies: one line per slab (tap to edit) and an Add button that opens on
 * the printing the panel shows.
 */
export function GradedCopies({
  cardId,
  cardName,
  printings,
  printingId
}: {
  cardId: number
  cardName: string
  printings: GradedPrinting[]
  printingId: number | undefined
}): React.JSX.Element {
  const slabs = useQuery({
    queryKey: queryKeys.gradedForCard(cardId),
    queryFn: () => api.graded.forCard(cardId)
  })
  const [editing, setEditing] = useState<GradedCopy | 'new' | null>(null)
  const list = slabs.data ?? []
  return (
    <section aria-label="Graded copies" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Graded{list.length > 0 && <span className="text-muted-foreground"> · {list.length}</span>}
        </h3>
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          Add graded copy
        </Button>
      </div>
      {list.length > 0 && (
        <ul className="space-y-1">
          {list.map((s) => (
            <li key={s.uid}>
              <button
                type="button"
                onClick={() => setEditing(s)}
                aria-label={`${gradeTitle(s)} ${s.printing.setCode}, edit`}
                className="flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <SlabArt slab={s} thumb className="w-12 shrink-0" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-medium">{gradeTitle(s)}</div>
                  <div className="truncate text-muted-foreground">
                    <span className="font-mono">{s.printing.setCode}</span> · {s.printing.setRarity}
                  </div>
                  {s.cert && <div className="font-mono text-muted-foreground">#{s.cert}</div>}
                </div>
                <SlabPrice slab={s} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <GradedForm
        open={editing !== null}
        onClose={() => setEditing(null)}
        cardName={cardName}
        printings={printings}
        printingId={printingId}
        slab={editing === 'new' || editing === null ? undefined : editing}
      />
    </section>
  )
}
