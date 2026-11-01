import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BinderEditAction, BinderEditLevel } from '@shared/binders'
import type { CardBinder } from '@shared/types'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'

interface Props {
  cardId: number
  /** The printing row the panel is on, when it has a sync key; offers adding just that printing. */
  printing?: { pkey: string; label: string }
}

/** A card's binders, each with a button to add the card (or one printing of it) or take it out. */
export function AddToBinder({ cardId, printing }: Props): React.JSX.Element | null {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: queryKeys.bindersForCard(cardId),
    queryFn: () => api.binders.forCard(cardId)
  })
  const [level, setLevel] = useState<Extract<BinderEditLevel, 'card' | 'printing'>>('card')
  const [busy, setBusy] = useState<string | null>(null)
  const binders = list.data ?? []
  if (binders.length === 0) return null
  const at = printing && level === 'printing' ? 'printing' : 'card'
  const target = at === 'printing' && printing ? printing.pkey : String(cardId)

  const run = async (b: CardBinder, action: BinderEditAction | null): Promise<void> => {
    setBusy(b.uid)
    try {
      await api.binders.edit(b.uid, { level: at, target }, action)
      // One prefix covers the list, this binder's page and the card's binders.
      await qc.invalidateQueries({ queryKey: queryKeys.binders })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the binder')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Binders" className="space-y-2">
      <h3 className="text-sm font-medium">Binders</h3>
      {printing && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`binder-level-${cardId}`}
              checked={at === 'card'}
              onChange={() => setLevel('card')}
            />
            This card
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`binder-level-${cardId}`}
              checked={at === 'printing'}
              onChange={() => setLevel('printing')}
            />
            This printing ({printing.label})
          </label>
        </div>
      )}
      <ul className="space-y-1.5">
        {binders.map((b) => {
          // Printing level only adds (a printing comes out from the binder's page). At card level,
          // a binder holding the card offers Remove, and a hand remove is undone by dropping it.
          const out = at === 'card' && b.inBinder
          const action: BinderEditAction | null =
            at === 'printing'
              ? 'add'
              : out
                ? b.edit === 'add'
                  ? null
                  : 'remove'
                : b.edit === 'remove'
                  ? null
                  : 'add'
          return (
            <li key={b.uid} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {out && <span className="text-xs text-muted-foreground">in binder</span>}
              <Button
                variant="outline"
                size="sm"
                disabled={busy === b.uid}
                aria-label={`${out ? 'Remove from' : 'Add to'} ${b.name}`}
                onClick={() => void run(b, action)}
              >
                {out ? 'Remove' : 'Add'}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
