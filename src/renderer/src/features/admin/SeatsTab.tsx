import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AdminSeats, AdminSeatsAction, AdminWaitlistEntry } from '@shared/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { adminKeys, errorText, shortWhen } from './adminTabs'
import { ConfirmButton, Grid, Note, Panel } from './parts'

const STATUS = {
  waiting: () => 'Waiting',
  invited: (r: AdminWaitlistEntry) =>
    `Invited until ${r.inviteExpiresAt ? shortWhen(r.inviteExpiresAt) : '?'}`,
  expired: () => 'Invite expired',
  joined: () => 'Joined'
} as const

/**
 * The seat cap, like the web dashboard's Seats tab: how many seats are used, invited and free, the
 * cap itself, and the waitlist with its invite, resend, cancel and delete.
 */
export function SeatsTab({ seats }: { seats: AdminSeats }): React.JSX.Element {
  const qc = useQueryClient()
  const { counts, waitlist } = seats
  const [cap, setCap] = useState(String(counts.cap))
  const act = async (req: AdminSeatsAction): Promise<void> => {
    if (!api.admin) throw new Error('Admin pages are desktop only')
    const { invited } = await api.admin.seatsAction(req)
    if (typeof invited === 'number') toast.success(`Invited ${invited} from the waitlist.`)
    await qc.invalidateQueries({ queryKey: adminKeys.seats })
  }
  const run = useMutation({
    mutationFn: act,
    onError: (e) => toast.error(errorText(e))
  })
  const capNumber = Number(cap)
  const capOk =
    cap.trim() !== '' && Number.isInteger(capNumber) && capNumber >= 0 && capNumber <= 100000
  return (
    <Panel title="Seats">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (capOk) run.mutate({ action: 'cap', cap: capNumber })
        }}
      >
        <Input
          type="number"
          min={0}
          max={100000}
          step={1}
          aria-label="Seat cap"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          className="h-8 w-28"
        />
        <Button type="submit" size="sm" disabled={!capOk || run.isPending}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={run.isPending}
          onClick={() => run.mutate({ action: 'fill' })}
        >
          Fill open seats
        </Button>
      </form>
      <p className="mt-2 text-[13px] text-muted-foreground">
        used {counts.accounts} of {counts.cap} · invited {counts.invited} · free {counts.free} ·
        waiting {counts.waiting}
      </p>
      <div className="mt-4">
        {waitlist.length === 0 ? (
          <Note>Nobody is on the waitlist.</Note>
        ) : (
          <Grid
            heads={['Email', 'Joined the list', 'Status', '']}
            left={3}
            rows={waitlist.map((r) => ({
              key: r.id,
              cells: [
                r.email,
                shortWhen(r.createdAt),
                STATUS[r.status](r),
                <span key="act" className="flex justify-end gap-1.5">
                  {(r.status === 'waiting' || r.status === 'expired') && (
                    <Button
                      size="sm"
                      disabled={run.isPending}
                      onClick={() => run.mutate({ action: 'invite', id: r.id })}
                    >
                      Invite now
                    </Button>
                  )}
                  {r.status === 'invited' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={run.isPending}
                        onClick={() => run.mutate({ action: 'resend', id: r.id })}
                      >
                        Resend
                      </Button>
                      <ConfirmButton
                        label="Cancel invite"
                        title={`Cancel the invite for ${r.email}?`}
                        action={() => act({ action: 'cancel', id: r.id })}
                      />
                    </>
                  )}
                  {r.status !== 'invited' && r.status !== 'joined' && (
                    <ConfirmButton
                      label="Delete"
                      title={`Remove ${r.email} from the waitlist for good?`}
                      action={() => act({ action: 'delete', id: r.id })}
                    />
                  )}
                </span>
              ]
            }))}
          />
        )}
      </div>
    </Panel>
  )
}
