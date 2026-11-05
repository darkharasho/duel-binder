import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import type { BinderCard } from '@shared/types'
import { cssAspect } from '@shared/games'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardArt } from '@/components/CardArt'
import { FavouriteHeart } from '@/components/FavouriteHeart'
import { useTileImage } from '@/lib/cardSize'
import { useFavourites } from '@/lib/favourites'
import { formatUsd } from '@/lib/format'
import { useCardAspect } from '@/lib/game'
import { useSwipe } from '@/lib/useSwipe'
import { cn } from '@/lib/utils'
import { binderStyle } from './binderColour'
import './binderLook.css'

/** The nearest ancestor that scrolls: the page the binder sits on. */
function scrollParent(node: HTMLElement): HTMLElement {
  for (let p = node.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
  }
  return document.scrollingElement as HTMLElement
}

/**
 * The widest the open binder can be while all of it, and whatever sits below it, fits in the
 * window without scrolling. Measured, as the header above it changes height from binder to binder.
 */
function useFitWidth(el: HTMLElement | null, on: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!el || !on || typeof ResizeObserver === 'undefined') return
    const scroller = scrollParent(el)
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      if (!r.height || !r.width) return
      const s = scroller.getBoundingClientRect()
      const top = r.top - s.top + scroller.scrollTop
      // What sits under the binder: the page marks, then each wrapper's bottom padding.
      const root = el.closest('[data-binder-root]') ?? el
      let below = root.getBoundingClientRect().bottom - r.bottom
      for (let p = root.parentElement; p && p !== scroller; p = p.parentElement) {
        below += parseFloat(getComputedStyle(p).paddingBottom) || 0
      }
      const fit = Math.floor((scroller.clientHeight - top - below) * (r.width / r.height))
      // A couple of pixels either way is the binder settling; stop there.
      setWidth((w) => (w != null && Math.abs(w - fit) < 3 ? w : fit))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scroller)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, on])
  return width
}

/** Whether a turn plays the page flip: not where motion is turned down, nor without animations (jsdom). */
const canFlip = (): boolean =>
  typeof document.body.animate === 'function' &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/** Longer than any flip runs; the flip is dropped by then even if its end event never came. */
const FLIP_MAX_MS = 1200

/** Pockets on a page: three rows of three, as on a real binder page. */
export const PER_PAGE = 9
/** More pages than this get a slider instead of a mark per page. */
const MAX_MARKS = 24
/** Two pages side by side from this width; one below it. */
const WIDE = '(min-width: 768px)'

const readWide = (): boolean => window.matchMedia?.(WIDE).matches ?? true
const subscribeWide = (cb: () => void): (() => void) => {
  const query = window.matchMedia?.(WIDE)
  query?.addEventListener?.('change', cb)
  return () => query?.removeEventListener?.('change', cb)
}

interface Props {
  /** The binder's uid, for its colour. */
  uid: string
  cards: BinderCard[]
  onOpen: (card: BinderCard) => void
  /** Takes a slot out of the binder; the control shows only when this is given and not `readOnly`. */
  onRemove?: (card: BinderCard) => void
  readOnly?: boolean
  /** Marks a page with nothing missing; off for a binder with no goal, where nothing is missing. */
  markComplete?: boolean
  /** Back to the first page when this changes. */
  resetKey?: string
}

interface PocketProps {
  card: BinderCard
  onOpen: (card: BinderCard) => void
  onRemove?: (card: BinderCard) => void
  favourites?: ReturnType<typeof useFavourites>
  tileImage: ReturnType<typeof useTileImage>
}

/** One slot: an owned card in its sleeve, or a missing one printed faintly on the page. */
function Pocket({
  card: c,
  onOpen,
  onRemove,
  favourites,
  tileImage
}: PocketProps): React.JSX.Element {
  const missing = c.owned === 0
  const aspect = useCardAspect(c.imageId || undefined)
  const where = c.printing ? `${c.printing.setCode} · ${c.printing.setRarity}` : null
  return (
    <div role="listitem" className="binder-pocket group/tile" data-owned={!missing}>
      <button
        type="button"
        onClick={() => onOpen(c)}
        aria-label={missing ? `${c.card.name}, missing` : c.card.name}
        title={[c.card.name, where].filter(Boolean).join('\n')}
        className="block w-full rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="binder-card">
          {c.imageId ? (
            // Faded on a wrapper: the art's own fade-in would otherwise light a missing card up.
            <div className={cn(missing && 'opacity-[0.13] grayscale')}>
              <CardArt
                imageId={c.imageId}
                printingId={c.printingScan && c.printing ? c.printing.id : null}
                size={tileImage}
                alt=""
                className="w-full"
              />
            </div>
          ) : (
            <div className="w-full bg-white/5" style={{ aspectRatio: cssAspect(aspect) }} />
          )}
          {missing && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-[#0d0d0f]/90 to-40% px-2 pb-2 pt-6 text-left max-md:px-1.5 max-md:pb-1.5">
              <div className="line-clamp-2 text-[11.5px] font-medium leading-tight text-foreground/80 max-md:text-[10px]">
                {c.card.name}
              </div>
              <div className="mt-0.5 flex justify-between gap-1 text-[11px] tabular-nums text-muted-foreground max-md:text-[9.5px]">
                <span className="truncate">{c.printing?.setCode ?? 'Missing'}</span>
                {c.price != null && <span>{formatUsd(c.price)}</span>}
              </div>
            </div>
          )}
        </div>
      </button>
      {!missing && c.owned > 1 && (
        <Badge className="pointer-events-none absolute bottom-3.5 right-3.5 z-[3] h-5 bg-background/80 px-1.5 text-[11px] text-foreground tabular-nums shadow ring-1 ring-white/15 backdrop-blur-sm max-md:bottom-2.5 max-md:right-2.5">
          ×{c.owned}
        </Badge>
      )}
      {c.added && (
        <Badge
          variant="secondary"
          className="pointer-events-none absolute left-3.5 top-5 z-[3] text-[10px] max-md:left-2 max-md:top-3"
        >
          added by hand
        </Badge>
      )}
      {favourites && (
        <FavouriteHeart
          cardId={c.card.id}
          name={c.card.name}
          favourites={favourites}
          // A heart on every pocket crowds a phone page; the card panel still has one there.
          className="absolute bottom-3.5 left-3.5 z-[3] bg-background/75 backdrop-blur-sm max-md:hidden"
        />
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${c.card.name} from this binder`}
          onClick={() => onRemove(c)}
          className="absolute right-3.5 top-3.5 z-[3] rounded bg-background/80 p-1 opacity-0 transition-opacity [@media(pointer:coarse)]:opacity-100 focus-visible:opacity-100 group-hover/tile:opacity-100 max-md:right-2 max-md:top-2"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** The rings down the middle of an open binder, or down the left of one page. */
function Rings(): React.JSX.Element {
  return (
    <div className="binder-gutter" aria-hidden>
      <div className="binder-plate" />
      {[18, 50, 82].map((top) => (
        <div key={top}>
          <div className="binder-hole" data-side="left" style={{ top: `${top}%` }} />
          <div className="binder-hole" data-side="right" style={{ top: `${top}%` }} />
          <div className="binder-ring" style={{ top: `${top}%` }} />
        </div>
      ))}
    </div>
  )
}

/**
 * A binder's slots as an open binder: pages of nine pockets, two side by side on a wide screen and
 * one on a phone, turned with the arrows, the page marks, the arrow keys or a swipe.
 */
export function BinderGrid({
  uid,
  cards,
  onOpen,
  onRemove,
  readOnly,
  markComplete = true,
  resetKey
}: Props): React.JSX.Element {
  const tileImage = useTileImage()
  // Favourites are private: a friend's binder (read-only) has no hearts.
  const ownFavourites = useFavourites(!readOnly)
  const favourites = readOnly ? undefined : ownFavourites
  const wide = useSyncExternalStore(subscribeWide, readWide)
  const aspect = useCardAspect()
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const fitWidth = useFitWidth(el, wide)
  // The first page shown, and the first page before a turn while its page is still flipping over.
  const [state, setState] = useState<{
    page: number
    from: number | null
    /** Counts turns, so a turn made mid-flip starts its own flip. */
    turn: number
    resetKey?: string
  }>({ page: 0, from: null, turn: 0, resetKey })
  if (state.resetKey !== resetKey) setState({ page: 0, from: null, turn: 0, resetKey })
  const settle = (): void => setState((s) => (s.from == null ? s : { ...s, from: null }))
  useEffect(() => {
    if (state.from == null) return
    const t = setTimeout(settle, FLIP_MAX_MS)
    return () => clearTimeout(t)
  }, [state.from, state.turn])

  const pageCount = Math.max(1, Math.ceil(cards.length / PER_PAGE))
  const step = wide ? 2 : 1
  // A spread starts on an even page; clamped, as the slots can shrink under it.
  const first = Math.min(state.page - (state.page % step), (Math.ceil(pageCount / step) - 1) * step)
  const shown = Array.from({ length: step }, (_, i) => first + i)
  const pageCards = (p: number): BinderCard[] => cards.slice(p * PER_PAGE, (p + 1) * PER_PAGE)

  const turnTo = (page: number): void => {
    const to = Math.max(0, Math.min(page - (page % step), pageCount - 1))
    if (to === first) return
    setState((s) => ({ page: to, from: canFlip() ? first : null, turn: s.turn + 1, resetKey }))
  }
  const prev = (): void => turnTo(first - step)
  const next = (): void => turnTo(first + step)

  useSwipe(el, {
    enabled: pageCount > step,
    zones: ['body'],
    onRelease: (_zone, dx, velocity) => {
      if (dx < -60 || velocity < -0.4) next()
      else if (dx > 60 || velocity > 0.4) prev()
    }
  })

  const label =
    step === 2 && first + 1 < pageCount
      ? `Pages ${first + 1}–${first + 2} of ${pageCount}`
      : `Page ${first + 1} of ${pageCount}`

  // While a page flips, each side shows what lies under the turning leaf until the leaf lands.
  const flip =
    state.from != null && state.from !== first
      ? { from: state.from, dir: state.from < first ? ('next' as const) : ('prev' as const) }
      : null

  /**
   * The page being turned. On a spread it swings over the rings: the old page on its front, the
   * new page on the other side on its back. A single page lifts off (next) or falls back on (prev).
   */
  const leaf = (f: { from: number; dir: 'next' | 'prev' }): React.JSX.Element => {
    const faces = wide
      ? f.dir === 'next'
        ? { front: page(f.from + 1, 'right'), back: page(first, 'left'), over: 'right' }
        : { front: page(f.from, 'left'), back: page(first + 1, 'right'), over: 'left' }
      : f.dir === 'next'
        ? { front: page(f.from, 'right'), back: null, over: 'single' }
        : { front: page(first, 'right'), back: null, over: 'single' }
    return (
      <div
        key={state.turn}
        className="binder-leaf"
        data-over={faces.over}
        data-dir={f.dir}
        aria-hidden
        inert
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) settle()
        }}
      >
        <div className="binder-leaf-face" data-face="front">
          {faces.front}
        </div>
        {faces.back && (
          <div className="binder-leaf-face" data-face="back">
            {faces.back}
          </div>
        )}
      </div>
    )
  }

  const turning = pageCount > step
  const prevButton = (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0 rounded-full"
      aria-label="Previous pages"
      disabled={first === 0}
      onClick={prev}
    >
      <ChevronLeftIcon className="size-4" />
    </Button>
  )
  const nextButton = (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0 rounded-full"
      aria-label="Next pages"
      disabled={first + step >= pageCount}
      onClick={next}
    >
      <ChevronRightIcon className="size-4" />
    </Button>
  )

  const page = (p: number, side: 'left' | 'right'): React.JSX.Element => {
    const these = p < pageCount ? pageCards(p) : []
    return (
      <div key={p} className="binder-page" data-side={side}>
        <div className="binder-sheet">
          {these.map((c) => (
            <Pocket
              key={c.key}
              card={c}
              onOpen={onOpen}
              onRemove={readOnly ? undefined : onRemove}
              favourites={favourites}
              tileImage={tileImage}
            />
          ))}
          {/* A part-filled page keeps its empty pockets, so every page is the same size. */}
          {Array.from({ length: PER_PAGE - these.length }, (_, i) => (
            <div key={`empty-${i}`} className="binder-pocket" aria-hidden>
              <div className="binder-card invisible">
                <div style={{ aspectRatio: cssAspect(aspect) }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      data-binder-root
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return
        if (e.key === 'ArrowLeft') prev()
        else if (e.key === 'ArrowRight') next()
        else return
        e.preventDefault()
      }}
    >
      <div className="flex items-center justify-center gap-3">
        {wide && turning && prevButton}
        <div
          ref={setEl}
          role="list"
          aria-label="Binder cards"
          className="binder-open binder-leather min-w-0 flex-1"
          data-single={!wide}
          style={{
            ...binderStyle(uid),
            ...(fitWidth != null && ({ '--fit-w': `${fitWidth}px` } as React.CSSProperties))
          }}
        >
          {wide ? (
            <>
              {page(flip?.dir === 'next' ? flip.from : first, 'left')}
              <Rings />
              {page(flip?.dir === 'prev' ? flip.from + 1 : first + 1, 'right')}
            </>
          ) : (
            <>
              <Rings />
              {page(flip?.dir === 'prev' ? flip.from : first, 'right')}
            </>
          )}
          {flip && leaf(flip)}
        </div>
        {wide && turning && nextButton}
      </div>
      {turning && (
        <nav
          aria-label="Pages"
          className={cn('flex items-center justify-center', wide ? 'gap-4' : 'flex-col gap-3')}
        >
          {wide ? (
            <span className="text-sm tabular-nums text-muted-foreground">{label}</span>
          ) : (
            <div className="flex items-center gap-4">
              {prevButton}
              <span className="min-w-28 text-center text-sm tabular-nums text-muted-foreground">
                {label}
              </span>
              {nextButton}
            </div>
          )}
          {pageCount <= MAX_MARKS ? (
            <div className="flex flex-wrap justify-center gap-1">
              {Array.from({ length: pageCount }, (_, p) => {
                const current = shown.includes(p)
                const done = markComplete && pageCards(p).every((c) => c.owned > 0)
                return (
                  <button
                    key={p}
                    type="button"
                    aria-label={`Page ${p + 1}${done ? ', complete' : ''}`}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => turnTo(p)}
                    className="group/mark grid h-5 place-items-center rounded-sm px-px outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        'block h-[3px] w-[18px] rounded-full transition-colors max-md:w-3.5',
                        current
                          ? 'bg-foreground'
                          : done
                            ? 'bg-complete'
                            : 'bg-white/15 group-hover/mark:bg-white/30'
                      )}
                    />
                  </button>
                )
              })}
            </div>
          ) : (
            <input
              type="range"
              aria-label="Page"
              min={1}
              max={pageCount}
              value={first + 1}
              onChange={(e) => turnTo(Number(e.target.value) - 1)}
              className="w-64 max-w-full accent-foreground"
            />
          )}
        </nav>
      )}
    </div>
  )
}
