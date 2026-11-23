import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportReason } from '@shared/friends'
import type { FriendUser } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { api, queryKeys } from '@/lib/api'
import { friendsErrorMessage } from '@/lib/friends'

/** Reports a user to Duel Binder: a reason, an optional note, and (ticked by default) a block. */
export function ReportDialog({
  user,
  blocked = false,
  onClose
}: {
  user: FriendUser
  /** Already blocked: no "Also block" box. */
  blocked?: boolean
  /** `blockedThem`: the report went out and blocked them, so their pages are gone. */
  onClose: (blockedThem: boolean) => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [block, setBlock] = useState(!blocked)
  const send = useMutation({
    mutationFn: (r: ReportReason) =>
      api.friends.report(user.id, { reason: r, note: note.trim(), block: block && !blocked }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.friends })
  })
  const name = user.displayName ?? user.username
  const close = (): void => onClose(send.isSuccess && block && !blocked)

  if (send.isSuccess) {
    return (
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Thanks for reporting</DialogTitle>
            <DialogDescription>
              {`We'll look at it within 24 hours and remove anything that breaks the rules.`}
              {block && !blocked ? ` ${name} is blocked and can't see your cards.` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason && !send.isPending) send.mutate(reason)
          }}
        >
          <DialogHeader>
            <DialogTitle>Report {name}</DialogTitle>
            <DialogDescription>
              {`Tell us what's wrong. They won't know who reported them.`}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Reason</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-primary"
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="report-note" className="text-sm font-medium">
              More detail (optional)
            </label>
            <textarea
              id="report-note"
              value={note}
              rows={3}
              maxLength={REPORT_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {!blocked && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={block} onCheckedChange={(v) => setBlock(v === true)} />
              Also block {name}
            </label>
          )}
          {send.isError && (
            <p role="alert" className="text-sm text-destructive">
              {friendsErrorMessage(send.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!reason || send.isPending}>
              Send report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
