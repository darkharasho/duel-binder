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
import { cn } from '@/lib/utils'
import { useScanHub } from './ScanHub'
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

/** The scanned-cards list with Clear and Add to collection; the same in both scan modes. */
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

  return (
    <>
      <section
        aria-labelledby="scan-session-title"
        className={cn(
          'flex min-h-72 min-w-0 flex-col rounded-lg border border-white/[0.08]',
          className
        )}
      >
        <header className="flex items-baseline justify-between border-b border-white/[0.06] px-4 py-3">
          <h2 id="scan-session-title" className="text-sm font-semibold">
            This session
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {plural(session.total, 'card', 'cards')} ·{' '}
            {plural(session.rows.length, 'entry', 'entries')}
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {session.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">Cards you scan show up here.</p>
          ) : (
            <ul aria-label="This session" className="divide-y divide-white/[0.06]">
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
        <footer className="flex items-center gap-2 border-t border-white/[0.06] p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={session.rows.length === 0 || session.committing}
            onClick={() => setClearing(true)}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            disabled={addable === 0 || session.committing}
            onClick={() => void commit()}
          >
            Add {plural(addable, 'card', 'cards')} to collection
          </Button>
        </footer>
      </section>

      <ClearSessionDialog open={clearing} onOpenChange={setClearing} />
    </>
  )
}
