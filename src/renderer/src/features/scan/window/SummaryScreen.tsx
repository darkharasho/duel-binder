import { useEffect, useState } from 'react'
import type { ScanSummary, ScanSummaryCard } from '@shared/scanWindow'
import { CardArt } from '@/components/CardArt'
import { useReverseLook } from '@/components/useReverseLook'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { plural } from '../scanText'

/** Row height is in vh, so this many always fit whatever size the window is. */
export const PAGE_ROWS = 9
export const PAGE_MS = 7000
export const SUMMARY_OUT_MS = 300

function Stat({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <p className="text-[clamp(1.2rem,2.6vw,2.4rem)] leading-tight font-semibold tabular-nums">
      {value}
      <span className="block text-[clamp(0.75rem,1.2vw,1.1rem)] font-normal text-white/60">
        {label}
      </span>
    </p>
  )
}

/** A long list turns over by itself: nobody can scroll a window that's being captured. */
function usePage(pages: number): number {
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (pages < 2) return
    const timer = setInterval(() => setPage((p) => p + 1), PAGE_MS)
    return () => clearInterval(timer)
  }, [pages])
  return page % pages
}

const PLACES = ['1st', '2nd', '3rd']

/** One pull on the podium: the hit (the biggest, in the middle) or a runner-up beside it. */
function Pulled({ card, place }: { card: ScanSummaryCard; place: number }): React.JSX.Element {
  const reverse = useReverseLook(card, card.rarity, card.setCode)
  const first = place === 0
  return (
    <section
      aria-label={first ? 'Hit of the session' : `${PLACES[place]} pull`}
      className={cn(
        'flex min-w-0 flex-col animate-in fade-in slide-in-from-bottom-[3vh] zoom-in-95 duration-700 motion-reduce:animate-none',
        first ? 'z-10 flex-[1.3]' : 'flex-1 pt-[6vh] delay-150 fill-mode-backwards'
      )}
    >
      <p
        className={cn(
          'mb-[1vh] truncate font-semibold tracking-wide',
          first
            ? 'text-[clamp(0.8rem,1.4vw,1.3rem)] text-amber-300'
            : 'text-[clamp(0.65rem,1.1vw,1rem)] text-white/60'
        )}
      >
        {first ? 'Hit of the session' : PLACES[place]}
      </p>
      <CardArt
        imageId={card.imageId}
        printingId={card.photoId}
        reverse={reverse}
        size="full"
        alt=""
        className={cn(
          'w-full rounded-[clamp(0.4rem,0.9vw,0.8rem)] bg-transparent shadow-none',
          first
            ? 'drop-shadow-[0_0_2vw_rgba(251,191,36,0.35)]'
            : 'drop-shadow-[0_0_1vw_rgba(255,255,255,0.12)]'
        )}
      />
      <p
        className={cn(
          'mt-[1vh] truncate font-semibold',
          first ? 'text-[clamp(0.9rem,1.8vw,1.7rem)]' : 'text-[clamp(0.7rem,1.3vw,1.2rem)]'
        )}
      >
        {card.name}
      </p>
      {card.guess && (
        <p className="text-[clamp(0.75rem,1.2vw,1.1rem)] text-amber-300">Best guess</p>
      )}
      {card.price == null ? (
        <p className="text-[clamp(1.1rem,2.6vw,2.4rem)] text-white/60">No price</p>
      ) : (
        <p
          className={cn(
            'flex items-baseline gap-[0.5vw] font-bold text-emerald-400 tabular-nums',
            first ? 'text-[clamp(1.1rem,2.6vw,2.4rem)]' : 'text-[clamp(0.85rem,1.8vw,1.6rem)]'
          )}
        >
          {formatUsd(card.price)}
          {card.raw && <span className="text-[0.6em] font-normal text-emerald-200/80">Raw</span>}
        </p>
      )}
    </section>
  )
}

/**
 * The session's top pulls, as the highlights picture stands them: the hit in the middle, the
 * 2nd to its left and the 3rd to its right. A lone hit stands as it always did.
 */
function Podium({ top }: { top: ScanSummaryCard[] }): React.JSX.Element {
  // Left to right: 2nd, 1st, 3rd.
  const order = top.length === 1 ? [0] : top.length === 2 ? [1, 0] : [1, 0, 2]
  return (
    <div
      role="group"
      aria-label="Top pulls"
      className={cn(
        'flex shrink-0 items-start gap-[1.2vw] portrait:self-center',
        top.length === 1
          ? 'w-[min(30vw,40vh)] portrait:w-[min(30vw,13vh)]'
          : top.length === 2
            ? 'w-[min(44vw,60vh)] portrait:w-[min(60vw,26vh)]'
            : 'w-[min(54vw,74vh)] portrait:w-[min(80vw,34vh)]'
      )}
    >
      {order.map((i) => (
        <Pulled key={top[i].key} card={top[i]} place={i} />
      ))}
    </div>
  )
}

function Row({ card }: { card: ScanSummaryCard }): React.JSX.Element {
  const { name, imageId, photoId, detail, quantity, price, raw, guess } = card
  const reverse = useReverseLook(card, card.rarity, card.setCode)
  return (
    <li className="flex h-[7.4vh] min-w-0 portrait:h-[5.6vh] items-center gap-[1vw] border-b border-white/10">
      <CardArt
        imageId={imageId}
        printingId={photoId}
        reverse={reverse}
        size="small"
        alt=""
        className="w-[4vh] shrink-0 overflow-hidden rounded-sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[clamp(0.8rem,2.6vh,1.5rem)] leading-tight font-semibold">
          {name}
        </p>
        <p className="truncate text-[clamp(0.65rem,1.9vh,1.05rem)] leading-tight text-white/55">
          {detail}
          {guess && <span className="text-amber-300">{detail && ' · '}Best guess</span>}
        </p>
      </div>
      {quantity > 1 && (
        <p className="shrink-0 text-[clamp(0.75rem,2.3vh,1.3rem)] text-white/60 tabular-nums">
          ×{quantity}
        </p>
      )}
      <p className="w-[11vw] shrink-0 text-right portrait:w-[22vw] text-[clamp(0.85rem,2.8vh,1.6rem)] font-bold tabular-nums">
        {price == null ? (
          <span className="font-normal text-white/45">No price</span>
        ) : (
          <span className="text-emerald-400">
            {formatUsd(price * quantity)}
            {raw && <span className="ml-[0.3em] text-[0.65em] font-normal">Raw</span>}
          </span>
        )}
      </p>
    </li>
  )
}

/** The session so far, over the camera blurred behind it: its top pulls, then every card and price. */
export function SummaryScreen({
  summary,
  leaving = false,
  pageRows = PAGE_ROWS,
  className
}: {
  summary: ScanSummary
  leaving?: boolean
  /** Rows to a page, for a box with less room than the stream window (the phone's). */
  pageRows?: number
  /** Extra classes for the screen, such as padding clear of a notch. */
  className?: string
}): React.JSX.Element {
  const { value, cards, hits, unpriced, hit, list } = summary
  // A main window from before the podium sends the hit alone.
  const top = summary.top ?? (hit ? [hit] : [])
  const pages = Math.max(1, Math.ceil(list.length / pageRows))
  const page = usePage(pages)
  return (
    <div
      role="status"
      aria-label="Summary"
      className={cn(
        'absolute inset-0 flex flex-col overflow-hidden bg-neutral-950/65 px-[4vw] py-[4vh] text-white backdrop-blur-[2vw] motion-reduce:animate-none',
        leaving
          ? 'animate-out fade-out fill-mode-forwards duration-300'
          : 'animate-in fade-in duration-500',
        className
      )}
      style={{
        backgroundImage:
          'radial-gradient(ellipse 60% 55% at 50% 0%, rgba(251,191,36,0.16), rgba(251,191,36,0) 70%)'
      }}
    >
      <p className="text-[clamp(0.8rem,1.4vw,1.3rem)] font-semibold tracking-[0.3em] text-amber-300 uppercase">
        Session summary
      </p>
      {cards === 0 ? (
        <p className="mt-[2vw] text-[clamp(1.2rem,3vw,2.8rem)] text-white/60">No cards yet</p>
      ) : (
        <>
          <div className="mt-[0.6vh] flex items-baseline gap-[4vw]">
            <p className="text-[clamp(2.2rem,5.5vw,5.5rem)] leading-none font-extrabold text-emerald-400 tabular-nums">
              {formatUsd(value)}
            </p>
            <Stat value={cards} label={cards === 1 ? 'card' : 'cards'} />
            <Stat value={hits} label={hits === 1 ? 'hit' : 'hits'} />
          </div>
          <div className="mt-[2.5vh] flex min-h-0 flex-1 gap-[3vw] portrait:flex-col portrait:gap-[2vh]">
            {top.length > 0 && <Podium top={top} />}
            <section
              aria-label="Every card"
              className="min-w-0 flex-1 animate-in fade-in slide-in-from-right-[2vw] duration-700 motion-reduce:animate-none"
            >
              <ol>
                {list.slice(page * pageRows, (page + 1) * pageRows).map((c) => (
                  <Row key={c.key} card={c} />
                ))}
              </ol>
            </section>
          </div>
          <p className="absolute right-[4vw] bottom-[1.2vh] text-[clamp(0.7rem,1.1vw,1rem)] text-white/50 tabular-nums">
            {unpriced > 0 && `${plural(unpriced, 'card', 'cards')} with no price`}
            {unpriced > 0 && pages > 1 && ' · '}
            {pages > 1 && `Page ${page + 1} of ${pages}`}
          </p>
        </>
      )}
    </div>
  )
}

/** The screen, kept up while it animates out after the main window turns it off. */
export function SummaryOverlay({
  summary
}: {
  summary: ScanSummary | null
}): React.JSX.Element | null {
  const [shown, setShown] = useState(summary)
  if (summary !== null && summary !== shown) setShown(summary)

  useEffect(() => {
    if (summary !== null) return
    const timer = setTimeout(() => setShown(null), SUMMARY_OUT_MS)
    return () => clearTimeout(timer)
  }, [summary])

  if (shown === null) return null
  return <SummaryScreen summary={shown} leaving={summary === null} />
}
