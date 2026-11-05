import { useMemo } from 'react'
import type { ScanSession, ScanSessionCard } from '@shared/scanSessions'
import { SessionBlock } from './SessionBlock'

/** Scan sessions, newest first: a header and a grid of card tiles each. */
export function SessionFeed({
  sessions,
  owner,
  variant,
  onOpenCard
}: {
  sessions: ScanSession[]
  owner: boolean
  variant: 'phone' | 'desktop'
  onOpenCard: (card: ScanSessionCard) => void
}): React.JSX.Element {
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sessions]
  )
  if (ordered.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No sessions yet. Add cards from the scanner and they show up here.
      </p>
    )
  return (
    <div className="space-y-4">
      {ordered.map((s) => (
        <SessionBlock
          key={s.uid}
          session={s}
          owner={owner}
          variant={variant}
          onOpenCard={onOpenCard}
        />
      ))}
    </div>
  )
}
