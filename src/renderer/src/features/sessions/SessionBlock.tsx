import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ellipsis } from 'lucide-react'
import { toast } from 'sonner'
import { CardArt } from '@/components/CardArt'
import { useReverseLook } from '@/components/useReverseLook'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { sessionTotal, type ScanSession, type ScanSessionCard } from '@shared/scanSessions'
import { MakeReplay } from '../scan/replay/MakeReplay'
import { plural } from '../scan/scanText'
import { replaySourceOfSession, sessionCardKey, sessionDate } from './sessionDate'

const TILE = 88
const GAP = 8

/** How many tiles fit a row; 8 until measured (jsdom has no ResizeObserver). */
function useColumns(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(8)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const w = el.clientWidth
      if (w > 0) setColumns(Math.max(1, Math.floor((w + GAP) / (TILE + GAP))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, columns]
}

function Tile({
  card,
  ring,
  onOpen
}: {
  card: ScanSessionCard
  ring: boolean
  onOpen: () => void
}): React.JSX.Element {
  const reverse = useReverseLook(card, card.rarity, card.setCode)
  return (
    <button
      type="button"
      aria-label={`${card.name}${card.quantity > 1 ? ` ×${card.quantity}` : ''}`}
      data-replay={ring ? '' : undefined}
      onClick={onOpen}
      className="group flex flex-col items-center gap-1 text-left outline-none"
    >
      <span
        className={cn(
          'relative block w-full rounded-[7px] transition-transform group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-white/60',
          ring && 'ring-2 ring-amber-400'
        )}
      >
        <CardArt
          imageId={card.imageId}
          printingId={card.printingId}
          size="small"
          alt=""
          className="w-full"
          reverse={reverse}
        />
        {card.quantity > 1 && (
          <span className="absolute right-1 top-1 rounded-full bg-black/75 px-1.5 text-[11px] font-semibold leading-5 text-white">
            ×{card.quantity}
          </span>
        )}
      </span>
      <span
        className={cn(
          'text-xs font-medium tabular-nums',
          card.price === null ? 'text-muted-foreground' : 'text-emerald-400'
        )}
      >
        {formatUsd(card.price)}
      </span>
    </button>
  )
}

export function SessionBlock({
  session,
  owner,
  variant,
  onOpenCard
}: {
  session: ScanSession
  owner: boolean
  variant: 'phone' | 'desktop'
  onOpenCard: (card: ScanSessionCard) => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [ref, columns] = useColumns()
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const source = useMemo(() => replaySourceOfSession(session), [session])
  const ringed = useMemo(() => new Set(source.pulls.map((p) => p.key)), [source])
  const sorted = useMemo(
    () =>
      session.cards
        .map((c, i) => ({ c, i }))
        .sort(
          (a, b) => (b.c.price ?? -1) - (a.c.price ?? -1) || b.c.addedAt - a.c.addedAt || a.i - b.i
        )
        .map((x) => x.c),
    [session.cards]
  )
  // Collapsed, two rows: the "+N more" tile takes row two's last slot.
  const cap = columns * 2
  const collapsed = !expanded && sorted.length > cap
  const shown = collapsed ? sorted.slice(0, cap - 1) : sorted
  const cards = session.cards.reduce((n, c) => n + c.quantity, 0)

  const run = async (fn: () => Promise<void>, failure: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['sessions'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 backdrop-blur-md">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-bold">{sessionDate(session.createdAt)}</h3>
        <span className="text-sm text-muted-foreground">{plural(cards, 'card', 'cards')}</span>
        <span className="text-sm font-semibold text-emerald-400">
          {formatUsd(sessionTotal(session.cards).value)}
        </span>
        {owner && !session.friendsVisible && (
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground">
            hidden
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {/* Replays are the owner's to make; a friend only looks. */}
          {owner && <MakeReplay source={source} variant={variant} />}
          {owner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Session options">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    void run(
                      () => api.sessions.setHidden(session.uid, session.friendsVisible),
                      'Could not update the session'
                    )
                  }
                >
                  {session.friendsVisible ? 'Hide from friends' : 'Show to friends'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirming(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      </header>
      <div
        ref={ref}
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {shown.map((c) => (
          <Tile
            key={sessionCardKey(c)}
            card={c}
            ring={ringed.has(sessionCardKey(c))}
            onOpen={() => onOpenCard(c)}
          />
        ))}
        {collapsed && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex aspect-[5/7] w-full items-center justify-center self-start rounded-[7px] border border-white/[0.06] bg-white/[0.03] text-center text-sm text-muted-foreground hover:bg-white/[0.07]"
          >
            +{sorted.length - shown.length} more
          </button>
        )}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session</DialogTitle>
            <DialogDescription>
              Delete this session? The cards stay in your collection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                void run(() => api.sessions.delete(session.uid), 'Could not delete the session')
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
