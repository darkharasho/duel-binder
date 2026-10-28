import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { TiltCard } from '@/components/TiltCard'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { cardImageSrc, setImageSrc } from '@/lib/images'
import { rarityColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import { baseOf, compareRarity } from '../../../../shared/rip/rarity'
import { tierFor } from '../../../../shared/rip/layouts'
import type { PackWrappers, RevealTier, RipCard, RipSet } from '../../../../shared/rip/types'
import { CardInfo, RarityBadge } from './CardInfo'
import { HoloCard } from './HoloCard'
import { STAGE, prefersReducedMotion } from './stage'
import { initialOpener, openerReducer } from './opener'
import { loadArt } from './loadArt'

/** How long a hit holds the front before the next move is taken, so a fast Space can't skip it. */
const HOLD_MS: Record<RevealTier, number> = { none: 0, rare: 300, big: 800, huge: 1500 }
/** The torn strip's flight; the cards come out once it's gone (and the pack has loaded). */
const TEAR_MS = 550
/** The sent card flying down into the row; the stack moving up takes as long. */
const SETTLE_MS = 420
/** A click this soon after the last card arrives is the end of a double-click, not "move on". */
const END_CLICK_MS = 500
/** The outgoing info panel's fade. */
const INFO_OUT_MS = 200
/** Between cards when skipping to the hit. */
const SKIP_STEP_MS = 330
/** How far a drag must go to send the front card on. */
const SWIPE_PX = 60
/** The pack stays shut until this many of its first cards' art is in, so none comes up blank. */
const READY_CARDS = 3
/** But no longer than this: offline, or a slow server, mustn't keep it shut. */
const READY_WAIT_MS = 8000
/** Cards visible behind the front one, as edges. */
const EDGES = 4

const TIER_LEVEL: Record<RevealTier, number> = { none: 0, rare: 1, big: 2, huge: 3 }
const GLOW_PX: Record<RevealTier, number> = { none: 0, rare: 26, big: 48, huge: 80 }
const EASE = 'cubic-bezier(.25,.8,.25,1)'

/** Between the card and the panel. */
const PANEL_GAP = 44
/** The info panel's narrowest; the card moves left of centre rather than squeeze it more. */
const PANEL_MIN = 280
/**
 * The front card's height, from the middle of the stage (a size container), the least of:
 * - its height less room above for the edges (7px a card, four deep) and a hit's scale-up, and
 *   below for the scale-up;
 * - 600px, so a big window doesn't blow the art up past its size;
 * - what leaves room across the width for the 44px gap, the panel and 32px margins each side.
 */
// Wrapped in calc() so it's also usable where a bare min() isn't (and jsdom keeps it).
const CARD_H = `calc(min(100cqh - 58px, 600px, (100cqw - ${PANEL_GAP + 64 + PANEL_MIN}px) * 614 / 421))`
/** Centred in the space left over, but never closer than 32px to the top bar. */
const CARD_TOP = `calc(max(32px, (100cqh - ${CARD_H}) / 2))`
/** Card width from its height (421×614). */
const CARD_W = `calc(${CARD_H} * 421 / 614)`
/** The panel takes the room right of the centred card, from 280px to 400px. */
const PANEL_W = `clamp(${PANEL_MIN}px, 50cqw - ${CARD_W} / 2 - ${PANEL_GAP + 32}px, 400px)`
/**
 * The card centred, with the panel to its right; where that would push the panel past the 32px
 * margin, the card moves left just enough.
 */
const CARD_LEFT = `calc(min(50% - ${CARD_W} / 2, 100% - 32px - ${PANEL_W} - ${PANEL_GAP}px - ${CARD_W}))`

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

/**
 * The pack's outline, as percent of its box. The tear line is shared by the strip (above it) and
 * the body (below it) so they meet exactly. The wrapper also gets crimped teeth top and bottom and
 * tears 9% down; a pack photo has its own crimps, so it keeps its outline and tears just under the
 * top seal, 6% down, clear of the KONAMI mark.
 */
const TEETH = 18
const teeth = (y: number, depth: number): string[] =>
  Array.from(
    { length: TEETH * 2 + 1 },
    (_, i) => `${((i / (TEETH * 2)) * 100).toFixed(2)}% ${i % 2 ? y + depth : y}%`
  )
const polygon = (points: string[]): string => `polygon(${points.join(', ')})`
const WRAPPER_TEAR = teeth(9, -1.4)
const PHOTO_TEAR = teeth(6, -1.2)
const CLIPS = {
  wrapper: {
    strip: polygon([...teeth(0, 1.4), ...[...WRAPPER_TEAR].reverse()]),
    body: polygon([...WRAPPER_TEAR, ...[...teeth(100, -1.4)].reverse()])
  },
  photo: {
    strip: polygon(['0% 0%', '100% 0%', ...[...PHOTO_TEAR].reverse()]),
    body: polygon([...PHOTO_TEAR, '100% 100%', '0% 100%'])
  }
}
/**
 * Pack photos share a square canvas with the pack centred: about 0.55 of the width on Beyond the
 * Brave, wider on some. The box crops to 0.6 of it so it fits the pack, not the empty canvas.
 */
const PHOTO_ASPECT = 0.6
const WRAPPER_ASPECT = 0.64
/** A wrapper cut from a two-pack photo fills this much of the box, about as much as a single pack. */
const CUT_FILL = 0.96

/** One wrapper of a pack photo that shows more than one. */
type PackCut = { photo: PackWrappers; wrapper: PackWrappers['wrappers'][number] }

/**
 * Where the photo goes, as percents of the box, so the one wrapper shown sits centred in it and
 * the other is cut off. The photo and its sheen both take this, so they stay on the same wrapper.
 */
function cutFrame({ photo, wrapper: w }: PackCut): React.CSSProperties {
  // Box heights per photo pixel.
  const k = CUT_FILL * Math.min(1 / w.height, PHOTO_ASPECT / w.width)
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`
  return {
    left: pct(0.5 - ((w.x + w.width / 2) * k) / PHOTO_ASPECT),
    top: pct(0.5 - (w.y + w.height / 2) * k),
    width: pct((photo.width * k) / PHOTO_ASPECT),
    height: pct(photo.height * k)
  }
}
const FOIL =
  'linear-gradient(115deg, #e4e6eb 0%, #8e939d 16%, #f6f7f9 30%, #7a7f89 47%, #dfe2e8 63%, #969ba5 80%, #eef0f3 100%)'
/** The crimped seals: pressed ridges in a lighter foil. */
const CRIMP =
  'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.55) 0 2px, rgb(0 0 0 / 0.14) 2px 4px), linear-gradient(180deg, #f4f5f8, #c9ccd3)'
const SHEEN =
  'linear-gradient(110deg, transparent 38%, rgb(255 255 255 / 0.6) 50%, transparent 62%)'

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

/** The set art a sealed pack shows; RipPage passes the picked set. */
export type PackArt = Pick<RipSet, 'setCode' | 'packImageKey' | 'logoImageKey' | 'coverImageId'>

/**
 * Everything printed on the pack, filling its box. Drawn twice, once clipped to the strip and once
 * to the body, so tearing the strip off tears the same picture.
 */
function PackFace({
  setName,
  art,
  packSrc,
  cut,
  measuring,
  onPackError
}: {
  setName: string
  art?: PackArt
  /** The photo of the real pack, when the set has one: then the pack is that picture. */
  packSrc: string | null
  /** When the photo shows more than one wrapper, the one this pack is. */
  cut: PackCut | null
  /** Still finding out whether it does; the photo stays hidden so no other wrapper flashes up. */
  measuring: boolean
  onPackError: () => void
}): React.JSX.Element {
  const [failed, setFailed] = useState({ cover: false, logo: false })
  const cover =
    art?.coverImageId != null && !failed.cover ? cardImageSrc('cropped', art.coverImageId) : null
  const logo =
    art?.logoImageKey && !failed.logo ? setImageSrc(art.logoImageKey, { now: true }) : null
  if (packSrc) {
    // The pack is the photo: no foil or crimps of ours, and the sheen only where the pack is.
    const mask = `url("${packSrc}")`
    const frame = cut ? cutFrame(cut) : null
    return (
      <div
        data-testid="rip-pack-face"
        className={cn('absolute inset-0 overflow-hidden', measuring && 'invisible')}
      >
        <img
          src={packSrc}
          alt=""
          draggable={false}
          data-testid="rip-pack-image"
          onError={onPackError}
          style={frame ?? undefined}
          className={cn('absolute', frame ? 'max-w-none' : 'inset-0 size-full object-cover')}
        />
        <div
          aria-hidden
          data-testid="rip-pack-sheen"
          style={{
            backgroundImage: SHEEN,
            backgroundSize: '300% 100%',
            maskImage: mask,
            WebkitMaskImage: mask,
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            // Same placement as the photo: cut to its wrapper, or its object-fit: cover.
            ...(frame
              ? { ...frame, maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }
              : {
                  maskSize: 'cover',
                  WebkitMaskSize: 'cover',
                  maskPosition: 'center',
                  WebkitMaskPosition: 'center'
                })
          }}
          className={cn(
            'pointer-events-none absolute mix-blend-overlay animate-[rip-sheen_4200ms_ease-in-out_infinite] motion-reduce:hidden',
            !frame && 'inset-0'
          )}
        />
      </div>
    )
  }
  return (
    <div
      data-testid="rip-pack-face"
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundImage: FOIL }}
    >
      <div data-testid="rip-pack-wrapper" className="absolute inset-0">
        {cover && (
          <img
            src={cover}
            alt=""
            draggable={false}
            onError={() => setFailed((f) => ({ ...f, cover: true }))}
            className="absolute inset-x-[5%] top-[4%] bottom-[4%] h-[92%] w-[90%] object-cover"
          />
        )}
        {/* Foil showing round the art, and a sheen over it so it reads as printed on foil. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgb(255 255 255 / 0.18), transparent 30%, transparent 70%, rgb(0 0 0 / 0.35))'
          }}
        />
        <div className="absolute inset-x-[8%] top-[10%] flex h-[26%] items-center justify-center">
          {logo ? (
            <img
              src={logo}
              alt=""
              draggable={false}
              data-testid="rip-pack-logo"
              onError={() => setFailed((f) => ({ ...f, logo: true }))}
              className="max-h-full max-w-full object-contain drop-shadow-[0_4px_10px_rgb(0_0_0/0.7)]"
            />
          ) : (
            <span className="text-center text-[clamp(1rem,7cqh,1.6rem)] leading-tight font-black tracking-tight text-white uppercase drop-shadow-[0_2px_8px_rgb(0_0_0/0.85)]">
              {setName}
            </span>
          )}
        </div>
        {art?.setCode && (
          <span className="absolute inset-x-0 bottom-[6%] text-center font-mono text-[11px] font-bold tracking-[0.2em] text-white/85 drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]">
            {art.setCode}
          </span>
        )}
      </div>
      {/* Crimped seals. */}
      {(['top-0', 'bottom-0'] as const).map((edge) => (
        <div
          key={edge}
          aria-hidden
          data-testid="rip-pack-crimp"
          style={{ backgroundImage: CRIMP }}
          className={cn('absolute inset-x-0 h-[14px] opacity-95', edge)}
        />
      ))}
      <div
        aria-hidden
        style={{ backgroundImage: SHEEN, backgroundSize: '300% 100%' }}
        className="pointer-events-none absolute inset-0 mix-blend-overlay animate-[rip-sheen_4200ms_ease-in-out_infinite] motion-reduce:hidden"
      />
    </div>
  )
}

/** A sealed booster pack, as tall as the front card will be, with a tear strip across its top. */
function SealedPack({
  setName,
  art,
  cut,
  measuring,
  phase,
  pending
}: {
  setName: string
  art?: PackArt
  cut: PackCut | null
  measuring: boolean
  /** sealed: waiting for a tear. tearing: the strip is off. leaving: dropping away as cards rise. */
  phase: 'sealed' | 'tearing' | 'leaving'
  /** Torn but the cards haven't arrived yet. */
  pending: boolean
}): React.JSX.Element {
  const [packFailed, setPackFailed] = useState(false)
  const packSrc =
    art?.packImageKey && !packFailed ? setImageSrc(art.packImageKey, { now: true }) : null
  const fail = (): void => setPackFailed(true)
  const face = (
    <PackFace
      setName={setName}
      art={art}
      packSrc={packSrc}
      cut={cut}
      measuring={measuring}
      onPackError={fail}
    />
  )
  const clips = packSrc ? CLIPS.photo : CLIPS.wrapper
  const aspect = packSrc ? PHOTO_ASPECT : WRAPPER_ASPECT
  return (
    <div
      data-testid="rip-pack"
      data-phase={phase}
      aria-hidden={phase === 'leaving' || undefined}
      style={{ top: CARD_TOP }}
      className={cn(
        'absolute left-1/2 -translate-x-1/2',
        phase === 'leaving' &&
          'pointer-events-none animate-[rip-pack-out_520ms_ease-in_both] motion-reduce:hidden'
      )}
    >
      {phase === 'sealed' && (
        <span className="absolute inset-x-0 -top-7 text-center text-sm font-medium whitespace-nowrap text-white/70 animate-[rip-bob_1600ms_ease-in-out_infinite] motion-reduce:animate-none">
          Click to tear open
        </span>
      )}
      <TiltCard maxTilt={8} glareClassName="hidden">
        {/* As tall as the front card; sized up front, so nothing jumps while the photo loads. */}
        <div
          data-testid="rip-pack-box"
          style={{ height: CARD_H, width: `calc(${CARD_H} * ${aspect})` }}
          className="relative drop-shadow-[0_26px_40px_rgb(0_0_0/0.6)]"
        >
          <div
            className={cn(
              'absolute inset-0',
              pending && 'animate-pulse motion-reduce:animate-none'
            )}
            style={{ clipPath: clips.body }}
          >
            {face}
          </div>
          {phase !== 'leaving' && (
            <div
              aria-hidden
              data-testid="rip-pack-strip"
              style={{ clipPath: clips.strip }}
              className={cn(
                'absolute inset-0',
                phase === 'tearing' &&
                  'animate-[rip-tear-strip_550ms_ease-in_forwards] motion-reduce:hidden'
              )}
            >
              {face}
            </div>
          )}
        </div>
      </TiltCard>
    </div>
  )
}

/** Where each card in the hand sits: the front, or an edge behind it. */
function handTransform(depth: number, scale: number): string {
  return `translate(${7 * depth}px, ${-7 * depth}px) rotate(${1.4 * depth}deg) scale(${(1 - 0.015 * depth) * scale})`
}

/**
 * Beside the front card: what it is (rarity, name, code, type, stats, text), as tall as the card.
 * Clicks and scrolls in it stay here: they never move the hand on.
 */
function InfoPanel({ card, outgoing }: { card: RipCard; outgoing?: boolean }): React.JSX.Element {
  return (
    <div
      data-testid={outgoing ? 'rip-info-out' : 'rip-info'}
      aria-hidden={outgoing || undefined}
      onClick={(e) => e.stopPropagation()}
      style={{
        left: `calc(${CARD_LEFT} + ${CARD_W} + ${PANEL_GAP}px)`,
        top: CARD_TOP,
        height: CARD_H,
        width: PANEL_W
      }}
      className={cn(
        'absolute flex flex-col justify-center motion-reduce:animate-none',
        outgoing
          ? 'pointer-events-none animate-[rip-caption-out_200ms_ease-in_forwards]'
          : 'cursor-auto animate-[rip-caption_500ms_ease-out_both]'
      )}
    >
      <CardInfo card={card} />
    </div>
  )
}

/** Where a sent card flies from: the front card's box as it left. */
interface FlyFrom {
  key: string
  rect: DOMRect
}

/** A seen card, small in the row; it flies down from the front when it arrives. */
function RowCard({
  card,
  flyKey,
  flyFromRef
}: {
  card: RipCard
  flyKey: string
  flyFromRef: React.RefObject<FlyFrom | null>
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const from = flyFromRef.current
    const el = ref.current
    if (!el || from?.key !== flyKey) return
    flyFromRef.current = null
    const to = el.getBoundingClientRect()
    if (!to.width || prefersReducedMotion()) return
    const dx = from.rect.left - to.left
    const dy = from.rect.top - to.top
    const s = from.rect.width / to.width
    el.animate?.(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }],
      { duration: SETTLE_MS, easing: EASE }
    )
  }, [flyFromRef, flyKey])
  return (
    <li data-testid="rip-row-card" className="min-w-0 shrink basis-[66px] last:shrink-0">
      <div ref={ref} className="w-[60px] origin-top-left">
        {/* Just a record of what's been seen: no tilt or hover. */}
        <div className="pointer-events-none rounded-[4px] shadow-[0_6px_14px_rgb(0_0_0/0.5)]">
          <HoloCard card={card} size="full" holo={false} />
        </div>
      </div>
    </li>
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
  /** The set's art, for the sealed pack. */
  packArt?: PackArt
}

/**
 * Opens a rip session's packs one at a time, like holding them: tear the pack, then look at the
 * front card and send it down to the row to see the next. The hit is at the back, so it comes last.
 * Fills the height it's given (the page makes it fill the window), sizing the cards to fit.
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
  /** The info of the card just sent, fading as the next one's comes in. */
  const [outInfo, setOutInfo] = useState<{ card: RipCard; id: number } | null>(null)
  const [dragX, setDragX] = useState<number | null>(null)
  /** Set while a hit holds the moment; Next pack waits for it too. */
  const [holding, setHolding] = useState(0)
  const queryClient = useQueryClient()
  const alive = useRef(true)
  // The last pack index asked of main; -1 before the first. Guards against double opens.
  const requested = useRef(-1)
  const holdUntil = useRef(0)
  const endedAt = useRef(0)
  const reported = useRef(false)
  const moveId = useRef(0)
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const frontEl = useRef<HTMLDivElement | null>(null)
  const flyFrom = useRef<FlyFrom | null>(null)
  // A photo with two wrappers (1st Edition and Unlimited, say) is one of them, rolled each pack.
  const [rolls] = useState(() => Array.from({ length: packCount }, () => Math.random()))
  const packKey = packArt?.packImageKey ?? null
  const wrappersQuery = useQuery({
    queryKey: queryKeys.ripPackWrappers(packKey ?? ''),
    queryFn: () => api.rip.packWrappers(packKey!),
    enabled: packKey !== null,
    staleTime: Infinity,
    retry: false
  })

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
          // The art, ahead of any other downloads: the first few before the pack opens, the rest
          // while they come up.
          const art = cards.flatMap((c) =>
            c.imageId != null ? [cardImageSrc('full', c.imageId, { now: true })] : []
          )
          const ready = loadArt(art.slice(0, READY_CARDS), READY_WAIT_MS)
          void loadArt(art.slice(READY_CARDS), READY_WAIT_MS)
          // And the details, so the info panel is full the moment a card comes to the front.
          for (const id of new Set(cards.map((c) => c.cardId))) {
            void queryClient.prefetchQuery({
              queryKey: queryKeys.card(id),
              queryFn: () => api.cards.get(id)
            })
          }
          void ready.then(() => {
            if (alive.current) dispatch({ type: 'packLoaded', cards })
          })
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

  /** Bring the next card to the front; the one there now goes down to the row. */
  const flipNext = (): void => {
    if (!cards || flipped >= cards.length) return
    cancelDrag()
    const tier = tierFor(cards[flipped].rarity, cards[flipped].setCode)
    const hold = reduced || tier === 'none' ? 0 : SETTLE_MS + HOLD_MS[tier]
    holdUntil.current = performance.now() + hold
    if (flipped + 1 === cards.length) endedAt.current = performance.now()
    const id = ++moveId.current
    if (hold > 0) {
      setHolding(id)
      later(hold, () => setHolding((h) => (h === id ? 0 : h)))
    } else setHolding(0)
    if (flipped > 0) {
      const sent = cards[flipped - 1]
      const rect = frontEl.current?.getBoundingClientRect()
      flyFrom.current = rect ? { key: `${packIndex}-${sent.slot}`, rect } : null
      if (!reduced) {
        setOutInfo({ card: sent, id })
        later(INFO_OUT_MS, () => setOutInfo((c) => (c?.id === id ? null : c)))
      }
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

  // Every pack is torn by hand (or by Skip to the hit).
  const latestTear = useRef(tear)
  useLayoutEffect(() => {
    latestTear.current = tear
  })

  // Skipping: tear if sealed, then each card down to the row in turn, stopping on the last.
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
    setOutInfo(null)
    dispatch({ type: 'next' })
  }

  /** Space, a click or a swipe: tear, send the front card on, or (Space only) the next pack. */
  const act = (from: 'key' | 'pointer'): void => {
    if (skipping) return
    if (phase === 'sealed') tear()
    else if (performance.now() < holdUntil.current) return
    else if (phase === 'hand') flipNext()
    // At the end a click or Space moves on: the next pack, or the summary after the last.
    else if (
      phase === 'end' &&
      (from === 'key' || performance.now() - endedAt.current >= END_CLICK_MS)
    )
      next()
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

  // Dragging the front card sideways: it follows the pointer; far enough sends it on.
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
    if (!moved) {
      setDragX(null)
      return
    }
    // A drag isn't a click as well.
    suppressClick.current = true
    if (Math.abs(e.clientX - x) >= SWIPE_PX) act('pointer')
    else setDragX(null)
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
  const row = revealed.slice(0, -1)
  const seen = [...state.opened.slice(0, cards ? -1 : undefined).flat(), ...revealed]
  const best = seen.reduce<RipCard | null>(
    (b, c) => (b === null || compareRarity(c.rarity, b.rarity) < 0 ? c : b),
    null
  )
  const lastPack = packIndex >= packCount - 1
  const frontTier = front ? tierFor(front.rarity, front.setCode) : 'none'
  const hitColor = front ? rarityColor(baseOf(front.rarity)) : ''
  const frontKey = front ? `${packIndex}-${front.slot}` : ''
  const actionable =
    !skipping && (phase === 'sealed' || phase === 'hand' || (phase === 'end' && holding === 0))
  const hand = cards && front ? cards.slice(flipped - 1, flipped + EDGES) : []
  const photo = wrappersQuery.data ?? null
  const cut = photo
    ? {
        photo,
        wrapper: photo.wrappers[Math.floor((rolls[packIndex] ?? 0) * photo.wrappers.length)]
      }
    : null
  // A failed measure leaves the photo whole, as before.
  const measuring = packKey !== null && wrappersQuery.isPending

  return (
    <div
      data-testid="rip-stage"
      onClick={onStageClick}
      onPointerDownCapture={() => {
        suppressClick.current = false
      }}
      style={{ backgroundImage: STAGE }}
      className={cn(
        'relative isolate flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.06] select-none',
        actionable && 'cursor-pointer'
      )}
    >
      <div className="relative z-40 flex h-11 shrink-0 items-center justify-between gap-4 px-5 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-semibold">
            Pack {packIndex + 1} of {packCount}
          </span>
          <span className="text-white/55"> · {setName}</span>
        </span>
        <span className="flex min-w-0 items-center gap-4">
          {best && (
            <span data-testid="rip-best" className="flex min-w-0 items-center gap-2 text-white/55">
              Best so far
              <RarityBadge rarity={best.rarity} />
              <span className="truncate text-white">{best.name}</span>
            </span>
          )}
          {front && (
            <span
              data-testid="rip-count"
              className="text-xs font-medium text-white/60 tabular-nums"
            >
              {flipped} / {n}
            </span>
          )}
        </span>
      </div>

      {/*
        The middle: a size container, so the card and pack can size themselves from its height.
        It's absolutely placed in a flex slot: a flex item with size containment reads 0 for cqh.
      */}
      <div className="relative min-h-0 flex-1">
        <div
          data-testid="rip-middle"
          style={{ containerType: 'size' }}
          className="absolute inset-0"
        >
          {front && frontTier !== 'none' && (
            <div
              key={frontKey}
              aria-hidden
              data-testid="rip-bloom"
              style={{
                width: `calc(${CARD_H} * 1.5)`,
                height: `calc(${CARD_H} * 1.5)`,
                left: `calc(${CARD_LEFT} + ${CARD_W} / 2 - ${CARD_H} * 0.75)`,
                top: `calc(${CARD_TOP} + ${CARD_H} / 2 - ${CARD_H} * 0.75)`,
                backgroundImage: `radial-gradient(circle, ${hitColor}55 0%, transparent 62%)`
              }}
              className="pointer-events-none absolute animate-[rip-bloom_600ms_ease-out_both] motion-reduce:animate-none"
            />
          )}
          {phase === 'error' ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 text-sm">
              <p className="text-white/60">Couldn&apos;t open this pack.</p>
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
              {(phase === 'sealed' || phase === 'tearing') && (
                <SealedPack
                  key={packIndex}
                  setName={setName}
                  art={packArt}
                  cut={cut}
                  measuring={measuring}
                  phase={phase}
                  pending={phase === 'tearing' && cards === null}
                />
              )}
              {flipped === 1 && !reduced && (
                <SealedPack
                  key={`${packIndex}-out`}
                  setName={setName}
                  art={packArt}
                  cut={cut}
                  measuring={measuring}
                  phase="leaving"
                  pending={false}
                />
              )}

              {front && (
                <div
                  key={packIndex}
                  style={{ top: CARD_TOP, left: CARD_LEFT, height: CARD_H, width: CARD_W }}
                  className="absolute animate-[rip-rise_560ms_cubic-bezier(.25,.8,.25,1)_both] motion-reduce:animate-none"
                >
                  {hand.map((c, depth) => {
                    const isFront = depth === 0
                    const tier = isFront ? frontTier : 'none'
                    const scale = 1 + 0.04 * TIER_LEVEL[tier]
                    let transform = handTransform(depth, scale)
                    let transition = `transform ${SETTLE_MS}ms ${EASE}, filter ${SETTLE_MS}ms ${EASE}`
                    if (isFront && dragX !== null) {
                      transform = `translateX(${dragX}px) rotate(${dragX * 0.04}deg) scale(${scale})`
                      transition = 'none'
                    }
                    // Reduced motion: the stack just swaps. Inline, as a class can't beat the style.
                    if (reduced) transition = 'none'
                    return (
                      <div
                        key={c.slot}
                        ref={isFront ? frontEl : undefined}
                        data-hand-card={depth}
                        data-testid={isFront ? 'rip-front' : undefined}
                        data-tier={isFront ? tier : undefined}
                        aria-hidden={!isFront || undefined}
                        onPointerDown={isFront ? onPointerDown : undefined}
                        onPointerMove={isFront ? onPointerMove : undefined}
                        onPointerUp={isFront ? onPointerUp : undefined}
                        onPointerCancel={isFront ? cancelDrag : undefined}
                        onDragStart={(e) => e.preventDefault()}
                        style={{
                          transform,
                          transition,
                          zIndex: 10 - depth,
                          filter: isFront ? undefined : `brightness(${0.75 - 0.08 * depth})`
                        }}
                        className={cn(
                          'absolute inset-0',
                          isFront ? 'touch-pan-y' : 'pointer-events-none'
                        )}
                      >
                        <div
                          className={cn(
                            isFront &&
                              (tier === 'big' || tier === 'huge') &&
                              'animate-[rip-shake_350ms_ease-in-out_250ms_2] motion-reduce:animate-none'
                          )}
                        >
                          {/* No sheen on the edges, so a Starlight at the back can't give itself away. */}
                          <HoloCard
                            card={c}
                            size="full"
                            holo={isFront}
                            shadow={
                              isFront && tier !== 'none'
                                ? `0 0 ${GLOW_PX[tier]}px ${hitColor}, 0 26px 50px rgb(0 0 0 / 0.65)`
                                : isFront
                                  ? '0 26px 50px rgb(0 0 0 / 0.65)'
                                  : '0 6px 14px rgb(0 0 0 / 0.4)'
                            }
                          />
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

              {/* The outgoing card's info fades as it goes; the new one fades in after. */}
              {outInfo && outInfo.card !== front && (
                <InfoPanel key={`out-${outInfo.id}`} card={outInfo.card} outgoing />
              )}
              {front && <InfoPanel key={frontKey} card={front} />}
            </>
          )}
        </div>
      </div>

      {/* Clicks here (a seen card, the hint) never move the hand on. */}
      <div
        data-testid="rip-bottom"
        onClick={(e) => e.stopPropagation()}
        className="relative z-40 flex h-[112px] shrink-0 items-end gap-6 px-5 pb-3"
      >
        <ol
          aria-label="Seen cards"
          data-testid="rip-row"
          className="flex min-w-0 flex-1 items-end pt-2"
        >
          {row.map((c) => (
            <RowCard
              key={`${packIndex}-${c.slot}`}
              card={c}
              flyKey={`${packIndex}-${c.slot}`}
              flyFromRef={flyFrom}
            />
          ))}
        </ol>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-xs text-white/55">
            {phase === 'end'
              ? `That's the pack. Click for ${lastPack ? 'your summary' : 'the next one'}`
              : phase === 'hand'
                ? 'Click, Space or swipe to send the front card down'
                : 'Click or press Space to tear the pack open'}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={
                skipping ||
                phase === 'error' ||
                phase === 'done' ||
                phase === 'end' ||
                cards === null
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
    </div>
  )
}
