import { useQuery } from '@tanstack/react-query'
import { LanguageTag } from '@/components/LanguageTag'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { reasonText } from '@/features/settings/accountText'
import { usePhone } from './context'

/** The entries the server can't take, with why: the phone's "sync problems" list. */
export function SyncProblems({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { store } = usePhone()
  const list = useQuery({
    queryKey: ['phone', 'syncProblems'],
    queryFn: () => store.syncProblems(),
    enabled: open
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cards that can&apos;t sync</DialogTitle>
          <DialogDescription>
            These stay on this phone until the server can take them.
          </DialogDescription>
        </DialogHeader>
        {list.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.isError ? (
          <p className="text-sm text-destructive">Couldn&apos;t load the list</p>
        ) : list.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to show.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {list.data.map((e) => (
              <li key={e.uid} className="space-y-0.5">
                <div className="flex justify-between gap-4">
                  <span className="font-medium">{e.name}</span>
                  <span className="tabular-nums">×{e.quantity}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span>{[e.setCode, e.setName, e.rarity].filter(Boolean).join(' · ')}</span>
                  <LanguageTag language={e.language} />
                </div>
                <div className="text-muted-foreground">{reasonText(e.reason)}</div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
