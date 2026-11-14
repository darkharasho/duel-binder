import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ScanSessionCard } from '@shared/scanSessions'
import { Camera, History, ListChecks } from 'lucide-react'
import type { NavigateFn } from '@/components/AppShell'
import { EmptyHero, EmptySteps } from '@/components/EmptyHero'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { RowsSkeleton } from '@/components/ui/loading'
import { api } from '@/lib/api'
import { pageInGame, useGame } from '@/lib/game'
import { isWeb } from '@/lib/platform'
import { SessionCardSheet } from './SessionCardSheet'
import { SessionFeed } from './SessionFeed'
import { sessionsKey } from './sessionsKey'

const SESSION_STEPS = [
  { icon: Camera, title: 'Scan a stack', text: 'Hold cards up to the camera one after another.' },
  { icon: ListChecks, title: 'Add them in one go', text: 'Check the picks, then add the batch.' },
  { icon: History, title: 'Look back here', text: 'Each batch is kept, with its cards and value.' }
] as const

function NoSessions({ onNavigate }: { onNavigate?: NavigateFn }): React.JSX.Element {
  const { def } = useGame()
  // The scanner isn't in the web app, nor in every game.
  const canScan = !!onNavigate && !isWeb() && pageInGame('scan', def)
  return (
    <EmptyHero
      id="no-sessions"
      title="No scan sessions yet"
      blurb={
        canScan
          ? 'Every time you add cards from the scanner, the batch is saved here as a session.'
          : 'Every time you add cards from the scanner, the batch is saved here as a session. Scanning is in the desktop and phone apps.'
      }
    >
      {canScan && (
        <div className="mt-7 flex justify-center">
          <Button size="lg" onClick={() => onNavigate('scan')}>
            <Camera aria-hidden className="size-4" />
            Open the scanner
          </Button>
        </div>
      )}
      <EmptySteps steps={SESSION_STEPS} />
    </EmptyHero>
  )
}

/** The scanner's Add to collection sessions in the shown game, newest first. */
export function SessionsPage({ onNavigate }: { onNavigate?: NavigateFn } = {}): React.JSX.Element {
  const { game } = useGame()
  const sessions = useQuery({ queryKey: sessionsKey(game), queryFn: () => api.sessions.list(game) })
  const [open, setOpen] = useState<{ card: ScanSessionCard; uid: string } | null>(null)
  const empty = sessions.isSuccess && sessions.data.length === 0
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        <h1 className="text-xl font-semibold">Sessions</h1>
        {!empty && (
          <p className="text-sm text-muted-foreground">Cards you added from the scanner</p>
        )}
      </PageHeader>
      {sessions.isPending && <RowsSkeleton label="Loading sessions" />}
      {empty ? (
        <NoSessions onNavigate={onNavigate} />
      ) : (
        sessions.isSuccess && (
          <SessionFeed
            sessions={sessions.data}
            owner
            variant="desktop"
            onOpenCard={(card, s) => setOpen({ card, uid: s.uid })}
          />
        )
      )}
      {open && (
        <SessionCardSheet card={open.card} sessionUid={open.uid} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
