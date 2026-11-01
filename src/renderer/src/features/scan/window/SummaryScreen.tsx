import { useEffect, useState } from 'react'
import type { ScanSummary, ScanSummaryCard } from '@shared/scanWindow'
import { CardArt } from '@/components/CardArt'
import { formatUsd } from '@/lib/format'
import { plural } from '../scanText'

/** Row height is in vh, so this many always fit whatever size the window is. */
export const PAGE_ROWS = 9
export const PAGE_MS = 7000

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

function Hit({ card }: { card: ScanSummaryCard }): React.JSX.Element {
  return (
    <section aria-label="Hit of the night" className="flex w-[min(30vw,40vh)] shrink-0 flex-col">
      <p className="mb-[1vh] text-[clamp(0.8rem,1.4vw,1.3rem)] font-semibold tracking-wide text-amber-300">
        Hit of the night
      </p>
      <CardArt
        imageId={card.imageId}
        size="full"
        alt=""
        className="w-full overflow-hidden rounded-[clamp(0.4rem,0.9vw,0.8rem)] shadow-[0_0_4vw_rgba(251,191,36,0.35)]"
      />
      <p className="mt-[1vh] truncate text-[clamp(0.9rem,1.8vw,1.7rem)] font-semibold">
        {card.name}
      </p>
      <p className="flex items-baseline gap-[0.5vw] text-[clamp(1.1rem,2.6vw,2.4rem)] font-bold text-emerald-400 tabular-nums">
        {formatUsd(card.price ?? 0)}
        {card.raw && <span className="text-[0.6em] font-normal text-emerald-200/80">Raw</span>}
      </p>
    </section>
  )
}

function Row({ card }: { card: ScanSummaryCard }): React.JSX.Element {
  const { name, imageId, detail, quantity, price, raw, guess } = card
  return (
    <li className="flex h-[7.4vh] min-w-0 items-center gap-[1vw] border-b border-white/10">
      <CardArt
        imageId={imageId}
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
      <p className="w-[11vw] shrink-0 text-right text-[clamp(0.85rem,2.8vh,1.6rem)] font-bold tabular-nums">
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

/** The night so far, opaque over everything else in the window: the hit, then every card and price. */
export function SummaryScreen({ summary }: { summary: ScanSummary }): React.JSX.Element {
  const { value, cards, hits, unpriced, hit, list } = summary
  const pages = Math.max(1, Math.ceil(list.length / PAGE_ROWS))
  const page = usePage(pages)
  return (
    <div
      role="status"
      aria-label="Summary"
      className="absolute inset-0 flex flex-col overflow-hidden bg-neutral-950 px-[4vw] py-[4vh] text-white animate-in fade-in"
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
          <div className="mt-[2.5vh] flex min-h-0 flex-1 gap-[3vw]">
            {hit && <Hit card={hit} />}
            <section aria-label="Every card" className="min-w-0 flex-1">
              <ol>
                {list.slice(page * PAGE_ROWS, (page + 1) * PAGE_ROWS).map((c) => (
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
