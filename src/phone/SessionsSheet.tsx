import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { GameId } from '@shared/games'
import type { ScanSessionCard } from '@shared/scanSessions'
import { SessionCardSheet } from '@/features/sessions/SessionCardSheet'
import { SessionFeed } from '@/features/sessions/SessionFeed'
import { sessionsKey } from '@/features/sessions/sessionsKey'
import { api } from '@/lib/api'
import { useBackHandler } from './backButton'

/** The scanner's sessions as a near full-height glass sheet over the camera; back closes it. */
export function SessionsSheet({
  game,
  onClose
}: {
  game: GameId
  onClose: () => void
}): React.JSX.Element {
  useBackHandler(true, onClose)
  const sessions = useQuery({ queryKey: sessionsKey(game), queryFn: () => api.sessions.list(game) })
  const [open, setOpen] = useState<{ card: ScanSessionCard; uid: string } | null>(null)
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 z-20 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />
      <section
        aria-labelledby="phone-sessions-title"
        className="absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-30 flex flex-col rounded-t-[28px] border-t border-white/[0.1] bg-background/80 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom duration-200"
      >
        <button
          type="button"
          aria-label="Close sessions"
          onClick={onClose}
          className="flex h-7 shrink-0 items-center justify-center"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/25" />
        </button>
        <header className="shrink-0 px-[18px] pb-3">
          <h2 id="phone-sessions-title" className="text-[22px] font-bold leading-7">
            Sessions
          </h2>
        </header>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-6">
          {sessions.isSuccess && (
            <SessionFeed sessions={sessions.data} owner variant="phone" onOpenCard={(card, s) => setOpen({ card, uid: s.uid })} />
          )}
        </div>
      </section>
      {open && (
        <SessionCardSheet card={open.card} sessionUid={open.uid} onClose={() => setOpen(null)} />
      )}
    </>
  )
}
