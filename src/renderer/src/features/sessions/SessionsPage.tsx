import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ScanSessionCard } from '@shared/scanSessions'
import { PageHeader } from '@/components/PageHeader'
import { api } from '@/lib/api'
import { useGame } from '@/lib/game'
import { SessionCardSheet } from './SessionCardSheet'
import { SessionFeed } from './SessionFeed'
import { sessionsKey } from './sessionsKey'

/** The scanner's Add to collection sessions in the shown game, newest first. */
export function SessionsPage(): React.JSX.Element {
  const { game } = useGame()
  const sessions = useQuery({ queryKey: sessionsKey(game), queryFn: () => api.sessions.list(game) })
  const [open, setOpen] = useState<ScanSessionCard | null>(null)
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        <h1 className="text-xl font-semibold">Sessions</h1>
        <p className="text-sm text-muted-foreground">Cards you added from the scanner</p>
      </PageHeader>
      {sessions.isSuccess && (
        <SessionFeed sessions={sessions.data} owner variant="desktop" onOpenCard={setOpen} />
      )}
      {open && <SessionCardSheet card={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
