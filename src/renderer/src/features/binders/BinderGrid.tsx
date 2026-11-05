import { useState, useSyncExternalStore } from 'react'
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
            <CardArt
              imageId={c.imageId}
              printingId={c.printingScan && c.printing ? c.printing.id : null}
              size={tileImage}
              alt=""
              className={cn('w-full', missing && 'opacity-[0.13] grayscale')}
            />
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
  // The first page shown, and which way the last turn went (for its slide).
  const [state, setState] = useState<{
    page: number
    dir: 'next' | 'prev' | null
    resetKey?: string
  }>({ page: 0, dir: null, resetKey })
  if (state.resetKey !== resetKey) setState({ page: 0, dir: null, resetKey })

  const pageCount = Math.max(1, Math.ceil(cards.length / PER_PAGE))
  const step = wide ? 2 : 1
  // A spread starts on an even page; clamped, as the slots can shrink under it.
  const first = Math.min(state.page - (state.page % step), (Math.ceil(pageCount / step) - 1) * step)
  const shown = Array.from({ length: step }, (_, i) => first + i)
  const pageCards = (p: number): BinderCard[] => cards.slice(p * PER_PAGE, (p + 1) * PER_PAGE)

  const turnTo = (page: number): void => {
    const to = Math.max(0, Math.min(page - (page % step), pageCount - 1))
    if (to === first) return
    setState({ page: to, dir: to > first ? 'next' : 'prev', resetKey })
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

  const page = (p: number, side: 'left' | 'right'): React.JSX.Element => {
    const these = p < pageCount ? pageCards(p) : []
    return (
      <div key={p} className="binder-page" data-side={side}>
        <div
          // Keyed on the page, so a turn replays the slide.
          key={`${p}-${state.dir}`}
          className="binder-sheet binder-turn"
          data-dir={state.dir ?? undefined}
        >
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
      className="space-y-5"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return
        if (e.key === 'ArrowLeft') prev()
        else if (e.key === 'ArrowRight') next()
        else return
        e.preventDefault()
      }}
    >
      <div
        ref={setEl}
        role="list"
        aria-label="Binder cards"
        className="binder-open binder-leather mx-auto"
        data-single={!wide}
        style={binderStyle(uid)}
      >
        {wide ? (
          <>
            {page(shown[0], 'left')}
            <Rings />
            {page(shown[1], 'right')}
          </>
        ) : (
          <>
            <Rings />
            {page(shown[0], 'right')}
          </>
        )}
      </div>
      {pageCount > step && (
        <nav aria-label="Pages" className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label="Previous pages"
              disabled={first === 0}
              onClick={prev}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="min-w-28 text-center text-sm tabular-nums text-muted-foreground">
              {label}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label="Next pages"
              disabled={first + step >= pageCount}
              onClick={next}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
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
