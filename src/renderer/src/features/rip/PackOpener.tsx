import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { cardImageSrc } from '@/lib/images'
import { rarityColor, rarityTextColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import { baseOf, compareRarity, revealTier } from '../../../../shared/rip/rarity'
import type { RevealTier, RipCard, RipSet } from '../../../../shared/rip/types'
import { SetArt } from '../sets/SetArt'
import { HoloCard } from './HoloCard'
import { initialOpener, openerReducer } from './opener'

/** How long a hit holds the front before the next move is taken, so a fast Space can't skip it. */
const HOLD_MS: Record<RevealTier, number> = { none: 0, rare: 300, big: 800, huge: 1500 }
/** The torn strip's flight; the cards come out once it's gone (and the pack has loaded). */
const TEAR_MS = 550
/** The front card sliding off to the right... */
const SLIDE_MS = 300
/** ...then tucking in behind the stack. Also how long the stack takes to shuffle forward. */
const SETTLE_MS = 420
/** Between cards when skipping to the hit. */
const SKIP_STEP_MS = 330
/** A beat on the next sealed pack before it tears itself open. */
const AUTO_TEAR_MS = 350
/** How far a drag must go to send the front card back. */
const SWIPE_PX = 60
/** Cards visible behind the front one, as edges. */
const EDGES = 4

const TIER_LEVEL: Record<RevealTier, number> = { none: 0, rare: 1, big: 2, huge: 3 }
const GLOW_PX: Record<RevealTier, number> = { none: 0, rare: 26, big: 48, huge: 80 }
const EASE = 'cubic-bezier(.25,.8,.25,1)'

/** The big hits' ring of sparkles, flying outward from round the card. */
const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * 2 * Math.PI - Math.PI / 2
  return {
    left: `${50 + 54 * Math.cos(a)}%`,
    top: `${50 + 40 * Math.sin(a)}%`,
    dx: `${Math.round(90 * Math.cos(a))}px`,
    dy: `${Math.round(90 * Math.sin(a))}px`
  }
})

/** The tear line: teeth along the strip's bottom edge, and the matching ones on the pack's top. */
const TEETH = 15
const zigzag = (from: number, to: number): string =>
  Array.from(
    { length: TEETH * 2 + 1 },
    (_, i) => `${(i / (TEETH * 2)) * 100}% ${i % 2 ? to : from}%`
  )
    .reverse()
    .join(', ')
const STRIP_CLIP = `polygon(0% 0%, 100% 0%, ${zigzag(100, 82)})`
const BODY_CLIP = `polygon(${zigzag(0, 2).split(', ').reverse().join(', ')}, 100% 100%, 0% 100%)`
const FOIL =
  'linear-gradient(115deg, #e4e6eb 0%, #8e939d 16%, #f6f7f9 30%, #7a7f89 47%, #dfe2e8 63%, #969ba5 80%, #eef0f3 100%)'
const STAGE = 'radial-gradient(ellipse at 50% 42%, #1f1f2a 0%, #0c0c11 72%)'

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

/** The set art a sealed pack shows; RipPage passes the picked set. */
export type PackArt = Pick<
  RipSet,
  'setCode' | 'imageKey' | 'packImageKey' | 'logoImageKey' | 'coverImageId'
>

/** A sealed foil pack with a tear strip across its top. */
function SealedPack({
  setName,
  art,
  phase,
  pending
}: {
  setName: string
  art?: PackArt
  /** sealed: waiting for a tear. tearing: the strip is off. leaving: dropping away as cards rise. */
  phase: 'sealed' | 'tearing' | 'leaving'
  /** Torn but the cards haven't arrived yet. */
  pending: boolean
}): React.JSX.Element {
  return (
    <div
      data-testid="rip-pack"
      data-phase={phase}
      aria-hidden={phase === 'leaving' || undefined}
      className={cn(
        'absolute top-[58px] left-1/2 -ml-[150px] h-[470px] w-[300px]',
        phase === 'leaving' &&
          'pointer-events-none animate-[rip-pack-out_520ms_ease-in_both] motion-reduce:hidden'
      )}
    >
      {phase === 'sealed' && (
        <span className="absolute inset-x-0 -top-9 text-center text-sm font-medium text-white/70 animate-[rip-bob_1600ms_ease-in-out_infinite] motion-reduce:animate-none">
          Click to tear open
        </span>
      )}
      {phase !== 'leaving' && (
        <div
          aria-hidden
          style={{ backgroundImage: FOIL, clipPath: STRIP_CLIP }}
          className={cn(
            'absolute inset-x-0 top-0 h-[44px] rounded-t-[10px]',
            phase === 'tearing' &&
              'animate-[rip-tear-strip_550ms_ease-in_forwards] motion-reduce:hidden'
          )}
        />
      )}
      <div
        style={{ backgroundImage: FOIL, clipPath: BODY_CLIP }}
        className={cn(
          'absolute inset-x-0 top-[36px] bottom-0 rounded-b-[10px] shadow-[0_30px_60px_rgb(0_0_0/0.6)]',
          pending && 'animate-pulse motion-reduce:animate-none'
        )}
      >
        <div className="absolute inset-x-[16px] top-[30px] bottom-[56px] overflow-hidden rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25)]">
          {art ? (
            <SetArt
              imageKey={art.imageKey}
              setCode={art.setCode}
              packImageKey={art.packImageKey}
              // The pack render wins over the logo; the logo only stands in when there's no pack.
              logoImageKey={art.packImageKey ? null : art.logoImageKey}
              coverImageId={art.coverImageId}
              className="size-full rounded-none"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-zinc-800 p-4 text-center text-lg font-bold text-white/80">
              {setName}
            </div>
          )}
        </div>
        <span className="absolute inset-x-4 bottom-[18px] truncate text-center text-[11px] font-semibold tracking-[0.14em] text-zinc-800 uppercase">
          {setName}
        </span>
      </div>
    </div>
  )
}

/** Under the front card: its rarity, name and set code. */
function Caption({ card, outgoing }: { card: RipCard; outgoing?: boolean }): React.JSX.Element {
  return (
    <div
      data-testid={outgoing ? 'rip-caption-out' : 'rip-caption'}
      aria-hidden={outgoing || undefined}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1.5 px-6 text-center motion-reduce:animate-none',
        outgoing
          ? 'animate-[rip-caption-out_200ms_ease-in_forwards]'
          : 'animate-[rip-caption_500ms_ease-out_both]'
      )}
    >
      <RarityBadge
        rarity={card.rarity}
        className={cn(revealTier(card.rarity) === 'huge' && 'px-3 py-1 text-sm')}
      />
      <span className="max-w-full truncate text-[19px] leading-tight font-bold text-white">
        {card.name}
      </span>
      <span className="text-xs text-white/55">{card.setCode}</span>
    </div>
  )
}

/** Where each card in the hand sits: the front, the edges behind it, or sliding away. */
function handTransform(depth: number, scale: number): string {
  return `translate(${7 * depth}px, ${-7 * depth}px) rotate(${1.4 * depth}deg) scale(${(1 - 0.015 * depth) * scale})`
}

interface Leaving {
  pack: number
  card: RipCard
  id: number
  out: boolean
}

interface PackOpenerProps {
  sessionId: number
  packCount: number
  setName: string
  /** Called once after the last pack, with every pack in the order opened. */
  onDone: (packs: RipCard[][]) => void
  /** False while the opener is kept mounted but hidden; Space then does nothing. Default true. */
  active?: boolean
  /** The set's art, for the sealed pack. */
  packArt?: PackArt
}

/**
 * Opens a rip session's packs one at a time, like holding them: tear the pack, then look at the
 * front card and put it to the back to see the next. The hit is at the back, so it comes last.
 */
export function PackOpener({
  sessionId,
  packCount,
  setName,
  onDone,
  active = true,
  packArt
}: PackOpenerProps): React.JSX.Element {
  const [state, dispatch] = useReducer(openerReducer, packCount, initialOpener)
  const [error, setError] = useState(false)
  // Each holds the pack index it applies to, so moving to the next pack resets them.
  const [tornPack, setTornPack] = useState(-1)
  const [strippedPack, setStrippedPack] = useState(-1)
  const [skippingPack, setSkippingPack] = useState(-1)
  /** Cards sliding off the front (out), then tucking in behind the stack; each on its own clock. */
  const [leaving, setLeaving] = useState<Leaving[]>([])
  const [dragX, setDragX] = useState<number | null>(null)
  /** Set while a hit holds the moment; Next pack waits for it too. */
  const [holding, setHolding] = useState(0)
  const queryClient = useQueryClient()
  const alive = useRef(true)
  // The last pack index asked of main; -1 before the first. Guards against double opens.
  const requested = useRef(-1)
  const holdUntil = useRef(0)
  const reported = useRef(false)
  const leaveId = useRef(0)
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    alive.current = true
    const pending = timers.current
    return () => {
      alive.current = false
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])

  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      if (alive.current) fn()
    }, ms)
    timers.current.add(t)
  }

  const fetchPack = useCallback(
    (index: number) => {
      if (index <= requested.current || index >= packCount) return
      requested.current = index
      api.rip.openPack(sessionId).then(
        (cards) => {
          // The pack is saved: keep History fresh, even if we've since unmounted. Not the sets
          // list: a pack never changes it, and refetching it blocks main for about a second.
          void queryClient.invalidateQueries({ queryKey: [...queryKeys.ripHistory] })
          void queryClient.invalidateQueries({ queryKey: ['rip', 'session'] })
          // Warm the art so each card is sharp the moment it comes to the front.
          for (const c of cards) {
            if (c.imageId != null) new Image().src = cardImageSrc('full', c.imageId)
          }
          if (alive.current) dispatch({ type: 'packLoaded', cards })
        },
        () => {
          if (!alive.current) return
          requested.current = index - 1
          setError(true)
        }
      )
    },
    [sessionId, packCount, queryClient]
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

  const { cards, flipped, packIndex } = state
  const n = cards?.length ?? 0
  const phase = state.done
    ? 'done'
    : error
      ? 'error'
      : flipped === 0
        ? tornPack === packIndex
          ? 'tearing'
          : 'sealed'
        : flipped < n
          ? 'hand'
          : 'end'
  const skipping = skippingPack === packIndex && phase !== 'end'
  const reduced = prefersReducedMotion()

  const cancelDrag = (): void => {
    drag.current = null
    setDragX(null)
  }

  /** Turn the next card to the front; the one there now goes to the back. */
  const flipNext = (): void => {
    if (!cards || flipped >= cards.length) return
    cancelDrag()
    const tier = revealTier(cards[flipped].rarity)
    const hold = reduced || tier === 'none' ? 0 : SETTLE_MS + HOLD_MS[tier]
    holdUntil.current = performance.now() + hold
    const id = ++leaveId.current
    if (hold > 0) {
      setHolding(id)
      later(hold, () => setHolding((h) => (h === id ? 0 : h)))
    } else setHolding(0)
    if (flipped > 0 && !reduced) {
      const card = cards[flipped - 1]
      setLeaving((ls) => [
        ...ls.filter((l) => l.card.slot !== card.slot),
        { pack: packIndex, card, id, out: true }
      ])
      later(SLIDE_MS, () =>
        setLeaving((ls) => ls.map((l) => (l.id === id ? { ...l, out: false } : l)))
      )
      later(SLIDE_MS + SETTLE_MS, () => setLeaving((ls) => ls.filter((l) => l.id !== id)))
    }
    dispatch({ type: 'flip' })
  }

  const tear = (): void => {
    const index = packIndex
    setTornPack(index)
    if (reduced) setStrippedPack(index)
    else later(TEAR_MS, () => setStrippedPack(index))
  }

  // Once the strip is off and the cards are here, they come out: the first card is the front.
  const latestFlip = useRef(flipNext)
  useLayoutEffect(() => {
    latestFlip.current = flipNext
  })
  useEffect(() => {
    if (strippedPack === packIndex && cards && flipped === 0) latestFlip.current()
  }, [strippedPack, packIndex, cards, flipped])

  // Only the first pack needs tearing by hand; the rest tear themselves once loaded.
  const latestTear = useRef(tear)
  useLayoutEffect(() => {
    latestTear.current = tear
  })
  // Not while hidden on the History tab: the owner should see it.
  const autoTear = active && packIndex > 0 && phase === 'sealed' && cards !== null
  useEffect(() => {
    if (!autoTear) return
    const t = setTimeout(() => latestTear.current(), prefersReducedMotion() ? 0 : AUTO_TEAR_MS)
    return () => clearTimeout(t)
  }, [autoTear])

  // Skipping: tear if sealed, then each card to the back in turn, stopping on the last.
  useEffect(() => {
    if (!skipping || !active) return
    if (phase === 'sealed') {
      latestTear.current()
      return
    }
    if (phase !== 'hand') return
    const t = setTimeout(() => latestFlip.current(), SKIP_STEP_MS)
    return () => clearTimeout(t)
  }, [skipping, active, phase, flipped])

  const next = (): void => {
    if (phase !== 'end' || performance.now() < holdUntil.current) return
    cancelDrag()
    setLeaving([])
    dispatch({ type: 'next' })
  }

  /** Space, a click or a swipe: tear, put the front card back, or (Space only) the next pack. */
  const act = (from: 'key' | 'pointer'): void => {
    if (skipping) return
    if (phase === 'sealed') tear()
    else if (performance.now() < holdUntil.current) return
    else if (phase === 'hand') flipNext()
    // Clicking the hit at the end is admiring it, not leaving it: Next pack or Space moves on.
    else if (phase === 'end' && from === 'key') next()
  }

  const skipToHit = (): void => {
    if (reduced) {
      if (cards) dispatch({ type: 'skip' })
      return
    }
    setSkippingPack(packIndex)
    if (phase === 'hand') flipNext()
  }

  const latestAct = useRef(act)
  useLayoutEffect(() => {
    latestAct.current = act
  })

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || ownsSpace(e.target)) return
      e.preventDefault()
      if (!e.repeat) latestAct.current('key')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const retry = (): void => {
    setError(false)
    fetchPack(packIndex)
  }

  // Dragging the front card sideways: it follows the pointer; far enough sends it back.
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || phase !== 'hand' || skipping) return
    drag.current = { x: e.clientX, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    if (Math.abs(dx) > 4) drag.current.moved = true
    if (drag.current.moved) setDragX(dx)
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const { x, moved } = drag.current
    drag.current = null
    setDragX(null)
    if (!moved) return
    // A drag isn't a click as well.
    suppressClick.current = true
    if (Math.abs(e.clientX - x) >= SWIPE_PX) act('pointer')
  }
  const onStageClick = (): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    act('pointer')
  }

  const revealed = cards ? cards.slice(0, flipped) : []
  const front = flipped > 0 ? revealed.at(-1)! : null
  const seen = [...state.opened.slice(0, cards ? -1 : undefined).flat(), ...revealed]
  const best = seen.reduce<RipCard | null>(
    (b, c) => (b === null || compareRarity(c.rarity, b.rarity) < 0 ? c : b),
    null
  )
  const lastPack = packIndex >= packCount - 1
  const frontTier = front ? revealTier(front.rarity) : 'none'
  const hitColor = front ? rarityColor(baseOf(front.rarity)) : ''
  const frontKey = front ? `${packIndex}-${front.slot}` : ''
  const actionable = !skipping && (phase === 'sealed' || phase === 'hand')
  const leavingHere = leaving.filter((l) => l.pack === packIndex)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="font-semibold">
            Pack {packIndex + 1} of {packCount}
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

      <div
        data-testid="rip-stage"
        onClick={onStageClick}
        onPointerDownCapture={() => {
          suppressClick.current = false
        }}
        style={{ backgroundImage: STAGE }}
        className={cn(
          'relative isolate h-[620px] overflow-hidden rounded-xl border border-white/[0.06] select-none',
          actionable && 'cursor-pointer'
        )}
      >
        {phase === 'error' ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 text-sm">
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
            {front && frontTier !== 'none' && (
              <div
                key={frontKey}
                aria-hidden
                data-testid="rip-bloom"
                style={{
                  backgroundImage: `radial-gradient(circle at 50% 45%, ${hitColor}55 0%, transparent 62%)`
                }}
                className="pointer-events-none absolute inset-0 -z-10 animate-[rip-bloom_600ms_ease-out_both] motion-reduce:animate-none"
              />
            )}

            {front && (
              <span
                data-testid="rip-count"
                className="absolute top-4 right-5 text-xs font-medium text-white/60 tabular-nums"
              >
                {flipped} / {n}
              </span>
            )}

            {(phase === 'sealed' || phase === 'tearing') && (
              <SealedPack
                key={packIndex}
                setName={setName}
                art={packArt}
                phase={phase}
                pending={phase === 'tearing' && cards === null}
              />
            )}
            {flipped === 1 && leavingHere.length === 0 && !reduced && (
              <SealedPack
                key={`${packIndex}-out`}
                setName={setName}
                art={packArt}
                phase="leaving"
                pending={false}
              />
            )}

            {cards && front && (
              <div
                key={packIndex}
                className="absolute top-[38px] left-1/2 -ml-[160px] h-[467px] w-[320px] animate-[rip-rise_560ms_cubic-bezier(.25,.8,.25,1)_both] motion-reduce:animate-none"
              >
                {cards.map((c, i) => {
                  const depth = (i - (flipped - 1) + n) % n
                  const leave = leavingHere.find((l) => l.card.slot === c.slot)
                  const isLeaving = leave !== undefined
                  const flyingOut = leave?.out === true
                  if (depth > EDGES && !isLeaving) return null
                  const isFront = depth === 0
                  const tier = isFront ? frontTier : 'none'
                  const scale = 1 + 0.04 * TIER_LEVEL[tier]
                  let transform = handTransform(Math.min(depth, EDGES), scale)
                  let transition = `transform ${SETTLE_MS}ms ${EASE}, filter ${SETTLE_MS}ms ${EASE}, box-shadow 600ms ease-out`
                  let zIndex = 10 - depth
                  if (flyingOut) {
                    transform = 'translate(380px, -30px) rotate(14deg)'
                    transition = `transform ${SLIDE_MS}ms ease-in`
                    zIndex = 20
                  } else if (isLeaving) {
                    zIndex = 0
                  } else if (isFront && dragX !== null) {
                    transform = `translateX(${dragX}px) rotate(${dragX * 0.04}deg) scale(${scale})`
                    transition = 'none'
                  }
                  // Reduced motion: the stack just swaps. Inline, as a class can't beat the style.
                  if (reduced) transition = 'none'
                  return (
                    <div
                      key={c.slot}
                      data-hand-card={depth}
                      data-leaving={isLeaving ? (flyingOut ? 'out' : 'tuck') : undefined}
                      data-testid={isFront && !isLeaving ? 'rip-front' : undefined}
                      data-tier={isFront ? tier : undefined}
                      aria-hidden={!isFront || isLeaving || undefined}
                      onPointerDown={isFront ? onPointerDown : undefined}
                      onPointerMove={isFront ? onPointerMove : undefined}
                      onPointerUp={isFront ? onPointerUp : undefined}
                      onPointerCancel={isFront ? cancelDrag : undefined}
                      onDragStart={(e) => e.preventDefault()}
                      style={{
                        transform,
                        transition,
                        zIndex,
                        filter:
                          isFront || flyingOut
                            ? undefined
                            : `brightness(${0.75 - 0.08 * Math.min(depth, EDGES)})`
                      }}
                      className={cn(
                        'absolute inset-0',
                        isFront ? 'touch-pan-y' : 'pointer-events-none'
                      )}
                    >
                      <div
                        style={{
                          boxShadow:
                            isFront && tier !== 'none'
                              ? `0 0 ${GLOW_PX[tier]}px ${hitColor}, 0 26px 50px rgb(0 0 0 / 0.65)`
                              : isFront
                                ? '0 26px 50px rgb(0 0 0 / 0.65)'
                                : '0 6px 14px rgb(0 0 0 / 0.4)'
                        }}
                        className={cn(
                          'rounded-[6px] transition-shadow duration-500',
                          isFront &&
                            !isLeaving &&
                            (tier === 'big' || tier === 'huge') &&
                            'animate-[rip-shake_350ms_ease-in-out_250ms_2] motion-reduce:animate-none'
                        )}
                      >
                        {/* No sheen on the edges, so a Starlight at the back can't give itself away. */}
                        <HoloCard card={c} size="full" holo={isFront && !isLeaving} />
                      </div>
                    </div>
                  )
                })}
                {(frontTier === 'big' || frontTier === 'huge') &&
                  SPARKS.map((s, i) => (
                    <span
                      key={`${frontKey}-${i}`}
                      aria-hidden
                      style={
                        {
                          left: s.left,
                          top: s.top,
                          '--dx': s.dx,
                          '--dy': s.dy
                        } as React.CSSProperties
                      }
                      className="pointer-events-none absolute z-30 text-2xl text-amber-200 drop-shadow-[0_0_6px_rgb(253_230_138_/_0.8)] animate-[scan-spark_1000ms_ease-out_250ms_both] motion-reduce:hidden"
                    >
                      ✦
                    </span>
                  ))}
              </div>
            )}

            {/* The outgoing card's caption fades as it slides off; the new one fades in after. */}
            {leavingHere
              .filter((l) => l.out)
              .map((l) => (
                <Caption key={`out-${l.id}`} card={l.card} outgoing />
              ))}
            {front && <Caption key={frontKey} card={front} />}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {phase === 'end'
            ? "That's the pack."
            : phase === 'hand'
              ? 'Click, Space or swipe to put the front card to the back'
              : 'Click or press Space to tear the pack open'}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={
              skipping || phase === 'error' || phase === 'done' || phase === 'end' || cards === null
            }
            onClick={skipToHit}
          >
            Skip to the hit
          </Button>
          <Button disabled={phase !== 'end' || holding !== 0} onClick={next}>
            {lastPack ? 'Finish' : 'Next pack'}
          </Button>
        </div>
      </div>
    </div>
  )
}
