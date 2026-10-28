import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useScanHub } from './ScanHub'
import { GLASS, listValue } from './scanLook'
import { plural } from './scanText'
import { ScanRowItem } from './ScanRowItem'

/** The copies Add would add, and Add itself with its toasts; shared with the phone's review. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the phone's review
export function useSessionCommit(): { addable: number; commit: () => Promise<void> } {
  const { session } = useScanHub()
  const addable = session.rows
    .filter((r) => r.printingId !== null)
    .reduce((n, r) => n + r.quantity, 0)

  const commit = async (): Promise<void> => {
    const { cards, failed } = await session.commit()
    if (cards > 0) toast.success(`Added ${plural(cards, 'card', 'cards')}`)
    if (failed > 0)
      toast.error(`${plural(failed, 'entry', 'entries')} couldn't be added; see the list`)
  }
  return { addable, commit }
}

/** Asks before clearing the list. */
export function ClearSessionDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { session } = useScanHub()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Clear this session?</DialogTitle>
          <DialogDescription>
            The scanned cards are removed from the list. Nothing is added to your collection.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              session.clear()
              onOpenChange(false)
            }}
          >
            Clear list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The scanned-cards list with Clear and Add to collection, the same in both scan modes; styled as
 * the phone's review: a header with the list's value, glass cards, and pill buttons.
 */
export function SessionList({ className }: { className?: string }): React.JSX.Element {
  const { session, fresh } = useScanHub()
  const [clearing, setClearing] = useState(false)
  const { addable, commit } = useSessionCommit()

  const { setPrinting, setQuantity, remove } = session
  // Stable, so rows (memoized) don't re-render on every pull.
  const rowActions = useMemo(
    () => ({ setPrinting, setQuantity, remove }),
    [setPrinting, setQuantity, remove]
  )
  const { value, priced, unpriced } = listValue(session.rows)

  return (
    <>
      <section
        aria-labelledby="scan-session-title"
        className={cn(
          'flex min-h-72 min-w-0 flex-col rounded-[28px] border border-white/[0.08] bg-white/[0.02]',
          className
        )}
      >
        <header className="flex items-end justify-between px-[18px] pt-4 pb-3">
          <div>
            <p className="text-xs text-muted-foreground">This scan</p>
            <h2 id="scan-session-title" className="text-[22px] font-bold leading-7">
              Review
            </h2>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground tabular-nums">
              {plural(session.total, 'card', 'cards')} ·{' '}
              {plural(session.rows.length, 'entry', 'entries')}
            </p>
            {priced > 0 && (
              <p
                aria-label="Value of the list"
                className="text-xl font-bold leading-7 tabular-nums"
              >
                {formatUsd(value)}
              </p>
            )}
            {priced > 0 && unpriced > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {plural(unpriced, 'card', 'cards')} with no price
              </p>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-3">
          {session.rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              Cards you scan show up here.
            </p>
          ) : (
            <ul aria-label="This session" className="flex flex-col gap-2 pb-3">
              {session.rows.map((row) => (
                <ScanRowItem
                  key={row.key}
                  row={row}
                  actions={rowActions}
                  highlighted={row.key === fresh}
                  disabled={session.committing}
                />
              ))}
            </ul>
          )}
        </div>
        <footer className="flex gap-2.5 border-t border-white/[0.06] p-3.5">
          <button
            type="button"
            disabled={session.rows.length === 0 || session.committing}
            onClick={() => setClearing(true)}
            className={cn(
              'h-11 rounded-full px-5 text-sm font-medium hover:bg-white/[0.12] disabled:opacity-40',
              GLASS
            )}
          >
            Clear
          </button>
          <button
            type="button"
            disabled={addable === 0 || session.committing}
            onClick={() => void commit()}
            className="h-11 flex-1 rounded-full bg-white text-sm font-bold text-black shadow-lg hover:bg-white/85 disabled:opacity-40"
          >
            Add {plural(addable, 'card', 'cards')} to collection
          </button>
        </footer>
      </section>

      <ClearSessionDialog open={clearing} onOpenChange={setClearing} />
    </>
  )
}
