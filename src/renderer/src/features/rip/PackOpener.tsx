import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { rarityColor, rarityTextColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import { baseOf, compareRarity, revealTier } from '../../../../shared/rip/rarity'
import type { RevealTier, RipCard } from '../../../../shared/rip/types'
import { HoloCard } from './HoloCard'
import { initialOpener, openerReducer } from './opener'

/** How long a reveal holds before the next flip is taken, so a fast Space can't skip the moment. */
const HOLD_MS: Record<RevealTier, number> = { none: 0, rare: 300, big: 800, huge: 1500 }

const FEATURE: Record<
  Exclude<RevealTier, 'none'>,
  { width: string; reveal: string; glow: string }
> = {
  rare: { width: 'w-52', reveal: 'animate-[rip-reveal_450ms_ease-out_both]', glow: '24px' },
  big: { width: 'w-60', reveal: 'animate-[rip-reveal_700ms_ease-out_both]', glow: '48px' },
  huge: { width: 'w-72', reveal: 'animate-[rip-reveal_1100ms_ease-out_both]', glow: '80px' }
}

/** Where the big reveal's sparkles start, and which way they fly. */
const SPARKS = [
  { left: '8%', top: '12%', dx: '-34px', dy: '-30px' },
  { left: '92%', top: '16%', dx: '34px', dy: '-28px' },
  { left: '4%', top: '62%', dx: '-38px', dy: '18px' },
  { left: '96%', top: '58%', dx: '36px', dy: '22px' },
  { left: '50%', top: '2%', dx: '0px', dy: '-40px' },
  { left: '50%', top: '98%', dx: '0px', dy: '36px' }
]

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Space belongs to whatever has focus when that's an enabled control or a text field. A disabled
 * one (Skip or Next just clicked, then disabled) can't take the key, so the opener does.
 */
const ownsSpace = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false
  const control = target.closest(
    'input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="button"]'
  )
  return control !== null && !control.matches(':disabled, [aria-disabled="true"]')
}

function RarityBadge({
  rarity,
  className
}: {
  rarity: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      style={{
        backgroundColor: rarityColor(baseOf(rarity)),
        color: rarityTextColor(baseOf(rarity))
      }}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs leading-none font-semibold shadow-sm',
        className
      )}
    >
      {rarity}
    </span>
  )
}

/** The pack's unflipped cards, as a face-down stack. */
function FaceDownPile({ left, loading }: { left: number; loading: boolean }): React.JSX.Element {
  return (
    <div className={cn('relative w-40', loading && 'animate-pulse')}>
      {[2, 1, 0].map((i) => (
        <div
          key={i}
          aria-hidden
          style={{ transform: `translate(${i * 4}px, ${i * -4}px)` }}
          className={cn(
            'aspect-[421/614] rounded-[6px] border border-amber-900/60 bg-gradient-to-br from-amber-950 via-stone-900 to-amber-950 shadow-md',
            i > 0 && 'absolute inset-0',
            i >= left && !loading && 'invisible'
          )}
        >
          <div className="flex size-full items-center justify-center">
            <div className="h-1/2 w-2/5 rounded-[50%] border-2 border-amber-700/50" />
          </div>
        </div>
      ))}
      {!loading && (
        <span className="absolute inset-x-0 -bottom-7 text-center text-xs text-muted-foreground tabular-nums">
          {left} left
        </span>
      )}
    </div>
  )
}

/** A rare-or-better card up large in the centre, with its rarity and name. */
function FeaturedCard({ card }: { card: RipCard }): React.JSX.Element {
  const tier = revealTier(card.rarity) as Exclude<RevealTier, 'none'>
  const f = FEATURE[tier]
  const glow = rarityColor(baseOf(card.rarity))
  return (
    <div data-testid="rip-featured" data-tier={tier} className="flex flex-col items-center gap-3">
      <div className={cn('relative motion-reduce:animate-none', f.width, f.reveal)}>
        <div
          aria-hidden
          style={{ boxShadow: `0 0 ${f.glow} ${glow}`, '--rip-glow': glow } as React.CSSProperties}
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[8px]',
            tier !== 'rare' &&
              'animate-[rip-glow_2400ms_ease-in-out_infinite] motion-reduce:animate-none'
          )}
        />
        <HoloCard card={card} size="full" />
        {tier === 'huge' &&
          SPARKS.map((s, i) => (
            <span
              key={i}
              aria-hidden
              style={
                { left: s.left, top: s.top, '--dx': s.dx, '--dy': s.dy } as React.CSSProperties
              }
              className="pointer-events-none absolute text-2xl text-amber-200 drop-shadow-[0_0_6px_rgb(253_230_138_/_0.8)] animate-[scan-spark_1100ms_ease-out_300ms_both] motion-reduce:hidden"
            >
              ✦
            </span>
          ))}
      </div>
      <div className="flex max-w-72 flex-col items-center gap-1.5 text-center animate-[rip-caption_500ms_ease-out_both] motion-reduce:animate-none">
        <RarityBadge rarity={card.rarity} className={cn(tier === 'huge' && 'px-3 py-1 text-sm')} />
        <span className={cn('font-semibold', tier === 'huge' ? 'text-lg' : 'text-base')}>
          {card.name}
        </span>
        <span className="text-xs text-muted-foreground">{card.setCode}</span>
      </div>
    </div>
  )
}

interface PackOpenerProps {
  sessionId: number
  packCount: number
  setName: string
  /** Called once after the last pack, with every pack in the order opened. */
  onDone: (packs: RipCard[][]) => void
  /** False while the opener is kept mounted but hidden; Space then does nothing. Default true. */
  active?: boolean
}

/** Opens a rip session's packs one at a time; click or Space flips the next card. */
export function PackOpener({
  sessionId,
  packCount,
  setName,
  onDone,
  active = true
}: PackOpenerProps): React.JSX.Element {
  const [state, dispatch] = useReducer(openerReducer, packCount, initialOpener)
  const [error, setError] = useState(false)
  const alive = useRef(true)
  // The last pack index asked of main; -1 before the first. Guards against double opens.
  const requested = useRef(-1)
  const holdUntil = useRef(0)
  const reported = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const fetchPack = useCallback(
    (index: number) => {
      if (index <= requested.current || index >= packCount) return
      requested.current = index
      api.rip.openPack(sessionId).then(
        (cards) => {
          if (alive.current) dispatch({ type: 'packLoaded', cards })
        },
        () => {
          if (!alive.current) return
          requested.current = index - 1
          setError(true)
        }
      )
    },
    [sessionId, packCount]
  )

  useEffect(() => {
    if (state.loading && !state.done) fetchPack(state.packIndex)
  }, [state.loading, state.done, state.packIndex, fetchPack])

  useEffect(() => {
    if (state.done && !reported.current) {
      reported.current = true
      onDone(state.opened)
    }
  }, [state.done, state.opened, onDone])

  const { cards, flipped } = state
  const allFlipped = cards !== null && flipped >= cards.length
  const busy = state.loading || state.done || error

  const advance = (): void => {
    if (busy || !cards || performance.now() < holdUntil.current) return
    if (allFlipped) {
      dispatch({ type: 'next' })
      return
    }
    const hold = prefersReducedMotion() ? 0 : HOLD_MS[revealTier(cards[flipped].rarity)]
    holdUntil.current = performance.now() + hold
    dispatch({ type: 'flip' })
  }

  const latestAdvance = useRef(advance)
  useEffect(() => {
    latestAdvance.current = advance
  })

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || ownsSpace(e.target)) return
      e.preventDefault()
      if (!e.repeat) latestAdvance.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const retry = (): void => {
    setError(false)
    fetchPack(state.packIndex)
  }

  const revealed = cards ? cards.slice(0, flipped) : []
  const last = revealed.at(-1)
  const featured = last && revealTier(last.rarity) !== 'none' ? last : null
  const row = featured ? revealed.slice(0, -1) : revealed
  const seen = [...state.opened.slice(0, cards ? -1 : undefined).flat(), ...revealed]
  const best = seen.reduce<RipCard | null>(
    (b, c) => (b === null || compareRarity(c.rarity, b.rarity) < 0 ? c : b),
    null
  )
  const lastPack = state.packIndex >= packCount - 1

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="font-semibold">
            Pack {state.packIndex + 1} of {packCount}
          </span>
          <span className="text-muted-foreground"> · {setName}</span>
        </span>
        {best && (
          <span
            data-testid="rip-best"
            className="flex min-w-0 items-center gap-2 text-muted-foreground"
          >
            Best so far
            <RarityBadge rarity={best.rarity} />
            <span className="truncate text-foreground">{best.name}</span>
          </span>
        )}
      </div>

      <div data-testid="rip-row" className="flex min-h-[7.5rem] flex-wrap gap-2">
        {row.map((c) => (
          <div
            key={`${state.packIndex}-${c.slot}`}
            className="w-20 animate-[rip-drop_320ms_ease-out_both] motion-reduce:animate-none"
          >
            <HoloCard card={c} size="small" />
          </div>
        ))}
      </div>

      <div
        onClick={advance}
        className={cn(
          'flex min-h-[26rem] select-none items-center justify-center gap-12 rounded-xl border bg-muted/30 p-6',
          !busy && 'cursor-pointer'
        )}
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 text-sm">
            <p className="text-muted-foreground">Couldn&apos;t open this pack.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                retry()
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {featured && (
              <FeaturedCard key={`${state.packIndex}-${featured.slot}`} card={featured} />
            )}
            {(state.loading || !allFlipped) && (
              <FaceDownPile left={cards ? cards.length - flipped : 0} loading={state.loading} />
            )}
            {allFlipped && !featured && (
              <p className="text-sm text-muted-foreground">No hits in this one.</p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Click or press Space to flip</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy || !cards || allFlipped}
            onClick={() => dispatch({ type: 'skip' })}
          >
            Skip pack
          </Button>
          <Button disabled={busy || !allFlipped} onClick={() => dispatch({ type: 'next' })}>
            {lastPack ? 'Finish' : 'Next pack'}
          </Button>
        </div>
      </div>
    </div>
  )
}
