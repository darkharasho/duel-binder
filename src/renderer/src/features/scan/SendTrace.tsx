import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LifeBuoy, Trash2 } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { TraceSendState } from '@shared/traces'
import { MAX_TRACE_NOTE } from '@shared/traces'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAccountUser } from '@/lib/accountUser'
import { isWeb } from '@/lib/platform'

const SENT_SHOWN = 5

/** "12.3 MB", for a sent trace's size. */
const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

// eslint-disable-next-line react-refresh/only-export-components -- exported for its tests
export function sendText(s: TraceSendState): string | null {
  switch (s.kind) {
    case 'idle':
      return null
    case 'sending':
      return s.total ? `Sending… ${s.sent} of ${s.total} files` : 'Sending…'
    case 'sent':
      return `Sent, thanks! ${s.files} files went up.`
    case 'failed':
      return {
        'no-trace': 'There is no trace to send yet: scan for a bit first.',
        'daily-cap': 'That is today’s 3 traces sent. Try again tomorrow.',
        'signed-out': 'Sign in again from Settings to send it.',
        'not-allowed': 'This account can’t send traces.',
        offline: 'Couldn’t reach Duel Binder. Try again in a moment.'
      }[s.reason]
  }
}

/**
 * Trace testers (and admins), desktop: sends this session's scan trace (how each frame was read,
 * with the camera frames kept) to the owner, with what went wrong. It goes up in the background,
 * so scanning (and the stream) carries on. Their sent traces can be deleted here too.
 */
export function SendTrace(): React.JSX.Element | null {
  const { user } = useAccountUser()
  const allowed = !isWeb() && (!!user?.admin || !!user?.traceTester)
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const state = useQuery({
    queryKey: ['scan', 'traceSendState'],
    queryFn: () => api.scan.traceSendState(),
    enabled: allowed,
    // Kept up while a send goes, wherever the popover is.
    refetchInterval: (q) => (q.state.data?.kind === 'sending' ? 1000 : false)
  })
  const sent = useQuery({
    queryKey: ['scan', 'sentTraces'],
    queryFn: () => api.scan.sentTraces(),
    enabled: allowed && open
  })
  const send = useMutation({
    mutationFn: () => api.scan.sendTrace(note.trim()),
    onSuccess: (s) => {
      qc.setQueryData(['scan', 'traceSendState'], s)
      setNote('')
    }
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.scan.deleteTrace(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['scan', 'sentTraces'] })
  })
  if (!allowed) return null
  const s = state.data ?? { kind: 'idle' }
  const sending = s.kind === 'sending'
  const text = sendText(s)
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void qc.invalidateQueries({ queryKey: ['scan', 'sentTraces'] })
      }}
    >
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm">
          <LifeBuoy aria-hidden />
          {sending ? 'Sending trace…' : 'Send trace'}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          aria-label="Send trace"
          className="z-50 flex w-[24rem] max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md"
        >
          <p className="text-muted-foreground">
            Sends how the scanner read each card this session, with the camera frames it kept, to
            Duel Binder&apos;s owner to look into. Only they can see it. Scanning carries on while
            it sends.
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">What went wrong?</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_TRACE_NOTE))}
              rows={3}
              placeholder="Optional: “It called my Secret Rare an Ultra Rare”"
              className="rounded-md border border-input bg-transparent px-2 py-1.5 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={sending || send.isPending} onClick={() => send.mutate()}>
              Send this session
            </Button>
            {(text || send.isError) && (
              <p role="status" className="text-xs text-muted-foreground">
                {send.isError ? 'Couldn’t start sending. Try again.' : text}
              </p>
            )}
          </div>
          {!!sent.data?.length && (
            <section aria-label="Sent traces" className="flex flex-col gap-1 border-t pt-2">
              <p className="text-xs font-medium text-muted-foreground">Sent</p>
              <ul className="flex flex-col">
                {sent.data.slice(0, SENT_SHOWN).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate" title={t.note || undefined}>
                      {new Date(t.createdAt).toLocaleString()}
                      {t.note && ` · ${t.note}`}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {t.doneAt ? mb(t.bytes) : 'Not finished'}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete the trace sent ${new Date(t.createdAt).toLocaleString()}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(t.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
