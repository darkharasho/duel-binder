import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { rarityColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import { baseOf, compareRarity } from '../../../../shared/rip/rarity'
import { tierFor } from '../../../../shared/rip/layouts'
import type { RevealTier, RipCard, RipSessionDetail } from '../../../../shared/rip/types'
import { CardInfo, RarityBadge } from './CardInfo'
import { HoloCard } from './HoloCard'
import { prefersReducedMotion } from './stage'

const shortRarity = (rarity: string): string => baseOf(rarity).replace(/ Rare$/, '')

/** The big hits counted by rarity, rarest first. */
// eslint-disable-next-line react-refresh/only-export-components
export function hitCounts(cards: RipCard[]): { rarity: string; label: string; n: number }[] {
  const counts = new Map<string, { rarity: string; label: string; n: number }>()
  for (const c of cards) {
    const tier = tierFor(c.rarity, c.setCode)
    if (tier !== 'big' && tier !== 'huge') continue
    const label = shortRarity(c.rarity)
    const entry = counts.get(label) ?? { rarity: c.rarity, label, n: 0 }
    entry.n += 1
    counts.set(label, entry)
  }
  return [...counts.values()].sort((a, b) => compareRarity(a.rarity, b.rarity))
}

/** Counts of the big hits, rarest first: "1 Secret · 1 Ultra · 3 Super". Empty without any. */
// eslint-disable-next-line react-refresh/only-export-components
export function hitsLine(cards: RipCard[]): string {
  return hitCounts(cards)
    .map((h) => `${h.n} ${h.label}`)
    .join(' · ')
}

/** A pulled card and the pack (1-based) it came from. */
interface Pull {
  card: RipCard
  pack: number
}

/**
 * The session's hits, rarest first, ties in the order pulled: the first is the best pull. Empty
 * when nothing beat a Short Print.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function rankedHits(packs: RipCard[][]): Pull[] {
  return packs
    .flatMap((pack, i) => pack.map((card) => ({ card, pack: i + 1 })))
    .filter((p) => tierFor(p.card.rarity, p.card.setCode) !== 'none')
    .sort((a, b) => compareRarity(a.card.rarity, b.card.rarity))
}

/**
 * The hero card's height, from the middle of the stage (a size container), the least of: the
 * height less room for its tilt; 380px (about 260 wide); and what leaves room beside it for the
 * gap, the info and margins.
 */
const HERO_H = 'calc(min(100cqh - 56px, 380px, (100cqw - 56px - 300px - 64px) * 614 / 421))'
const HERO_W = `calc(${HERO_H} * 421 / 614)`
/** The card's landing (rip-hero-land); the kicker stamps and the sparkles fly as it ends. */
const LAND_MS = 900

const SPARK_COUNT: Record<RevealTier, number> = { none: 0, rare: 0, big: 6, huge: 12 }
const sparks = (n: number): { left: string; top: string; dx: string; dy: string }[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2
    return {
      left: `${50 + 50 * Math.cos(a)}%`,
      top: `${50 + 46 * Math.sin(a)}%`,
      dx: `${Math.round(110 * Math.cos(a))}px`,
      dy: `${Math.round(110 * Math.sin(a))}px`
    }
  })

/** The best pull, big: it lands with as much fanfare as its rarity earns. */
function Hero({
  pull,
  cards,
  onFocus
}: {
  pull: Pull
  cards: RipCard[]
  onFocus: (card: RipCard) => void
}): React.JSX.Element {
  const { card, pack } = pull
  const tier = tierFor(card.rarity, card.setCode)
  const color = rarityColor(baseOf(card.rarity))
  const reduced = prefersReducedMotion()
  const rays = tier === 'big' || tier === 'huge'
  const counts = hitCounts(cards)
  return (
    <div
      data-testid="rip-summary-hero"
      data-tier={tier}
      className="flex size-full items-center justify-center gap-14 px-8"
    >
      <div className="relative shrink-0" style={{ height: HERO_H, width: HERO_W }}>
        {rays && (
          <div
            aria-hidden
            data-testid="rip-summary-rays"
            style={{
              // No bigger than the rays reach: the summary doesn't clip, so a bigger box would
              // make the page scroll.
              width: `calc(${HERO_H} * 1.4)`,
              height: `calc(${HERO_H} * 1.4)`,
              left: `calc(50% - ${HERO_H} * 0.7)`,
              top: `calc(50% - ${HERO_H} * 0.7)`,
              opacity: tier === 'huge' ? 0.7 : 0.4,
              backgroundImage: `repeating-conic-gradient(from 0deg, ${color} 0deg 5deg, transparent 5deg 15deg)`,
              maskImage: 'radial-gradient(circle closest-side, #000 33%, transparent 96%)',
              WebkitMaskImage: 'radial-gradient(circle closest-side, #000 33%, transparent 96%)'
            }}
            className="pointer-events-none absolute -z-10 animate-[rip-rays_40s_linear_infinite] motion-reduce:animate-none"
          />
        )}
        <div
          aria-hidden
          data-testid="rip-summary-bloom"
          style={{
            width: `calc(${HERO_H} * 1.8)`,
            height: `calc(${HERO_H} * 1.8)`,
            left: `calc(50% - ${HERO_H} * 0.9)`,
            top: `calc(50% - ${HERO_H} * 0.9)`,
            backgroundImage: `radial-gradient(circle closest-side, ${color}${tier === 'huge' ? '77' : '55'} 0%, transparent 65%)`
          }}
          className="pointer-events-none absolute -z-10 animate-[rip-bloom_800ms_ease-out_both] motion-reduce:animate-none"
        />
        <div
          className={cn(
            'size-full',
            tier === 'huge' &&
              'animate-[rip-shake_380ms_ease-in-out_820ms_2] motion-reduce:animate-none'
          )}
        >
          <div
            data-testid="rip-summary-card"
            style={{ transform: 'rotate(-3deg)' }}
            className="size-full animate-[rip-hero-land_900ms_cubic-bezier(.34,1.56,.64,1)_both] motion-reduce:animate-none"
          >
            <button
              type="button"
              aria-label={`Look at ${card.name}`}
              onClick={() => onFocus(card)}
              className="block w-full cursor-zoom-in rounded-[8px]"
            >
              <HoloCard
                card={card}
                size="full"
                shadow={`0 0 ${tier === 'huge' ? 70 : 40}px ${color}, 0 30px 60px rgb(0 0 0 / 0.65)`}
              />
            </button>
          </div>
        </div>
        {!reduced &&
          sparks(SPARK_COUNT[tier]).map((s, i) => (
            <span
              key={i}
              aria-hidden
              data-testid="rip-summary-spark"
              style={
                {
                  left: s.left,
                  top: s.top,
                  '--dx': s.dx,
                  '--dy': s.dy,
                  animationDelay: `${LAND_MS - 250 + (i % 3) * 90}ms`
                } as React.CSSProperties
              }
              className="pointer-events-none absolute z-30 text-2xl text-amber-200 drop-shadow-[0_0_6px_rgb(253_230_138_/_0.8)] animate-[scan-spark_1100ms_ease-out_both]"
            >
              ✦
            </span>
          ))}
      </div>

      <div className="flex max-w-[400px] min-w-[240px] flex-1 flex-col items-start gap-3">
        <span
          style={{ color, animationDelay: `${LAND_MS - 100}ms` }}
          className={cn(
            'origin-left text-xs font-black tracking-[0.3em] uppercase',
            rays &&
              'animate-[rip-stamp_500ms_cubic-bezier(.2,1.4,.4,1)_both] motion-reduce:animate-none'
          )}
        >
          Best pull
        </span>
        <RarityBadge rarity={card.rarity} className={cn(tier === 'huge' && 'px-3 py-1 text-sm')} />
        <h3
          data-testid="rip-summary-hero-name"
          className="line-clamp-3 text-[34px] leading-[1.1] font-bold tracking-tight text-white"
        >
          {card.name}
        </h3>
        <p className="text-sm text-white/55">
          {card.setCode} · from pack {pack}
        </p>
        <ul aria-label="Hits" className="flex flex-wrap gap-1.5 pt-1">
          {counts.map((h) => (
            <li
              key={h.label}
              data-testid="rip-summary-chip"
              style={{ borderColor: `${rarityColor(baseOf(h.rarity))}88` }}
              className="flex items-center gap-1.5 rounded-full border bg-white/[0.04] px-2.5 py-1 text-xs text-white/85"
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: rarityColor(baseOf(h.rarity)) }}
              />
              {`${h.n} ${h.label}`}
            </li>
          ))}
          <li
            data-testid="rip-summary-chip"
            className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs text-white/70"
          >
            {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          </li>
        </ul>
      </div>
    </div>
  )
}

/** The focused card's height, from the overlay (a size container), like the opener's front card. */
const FOCUS_H = 'calc(min(100cqh - 64px, 600px, (100cqw - 64px - 44px - 300px) * 614 / 421))'
const FOCUS_W = `calc(${FOCUS_H} * 421 / 614)`

/**
 * One card, large, with what it is beside it, over the summary. A click outside it, Escape or the
 * close button puts it away; the arrow keys step through the session's cards.
 */
function Focus({
  card,
  onClose,
  onStep
}: {
  card: RipCard
  onClose: () => void
  onStep: (by: number) => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onStep(1)
      else if (e.key === 'ArrowLeft') onStep(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])
  const color = rarityColor(baseOf(card.rarity))
  const tier = tierFor(card.rarity, card.setCode)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      data-testid="rip-summary-focus"
      onClick={onClose}
      className="absolute inset-0 z-50 rounded-xl bg-black/75 backdrop-blur-sm duration-200 animate-in fade-in-0 motion-reduce:animate-none"
    >
      <div style={{ containerType: 'size' }} className="absolute inset-0">
        <div className="flex size-full items-center justify-center gap-11 px-8">
          <div
            key={`${card.pkey}-${card.slot}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              height: FOCUS_H,
              width: FOCUS_W
            }}
            className="shrink-0 duration-300 animate-in zoom-in-90 fade-in-0 motion-reduce:animate-none"
          >
            <HoloCard
              card={card}
              size="full"
              shadow={
                tier === 'none'
                  ? '0 30px 60px rgb(0 0 0 / 0.65)'
                  : `0 0 ${tier === 'huge' ? 60 : tier === 'big' ? 40 : 24}px ${color}, 0 30px 60px rgb(0 0 0 / 0.65)`
              }
            />
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ height: FOCUS_H }}
            className="flex w-[300px] shrink-0 flex-col justify-center"
          >
            <CardInfo card={card} />
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="absolute top-2 right-3 text-white/70"
      >
        Close
      </Button>
    </div>
  )
}

interface Props {
  session: RipSessionDetail
  onRipMore?: () => void
  onPickSet?: () => void
  /** Disables Rip more while a new session is starting. */
  starting?: boolean
}

/**
 * What a session pulled, on a stage like the opener's: the best pull large with fanfare, the rest
 * of its pack along the bottom, and every card by pack on demand. Clicking any card
 * brings it up large with its details. Fills the height it's given.
 */
export function SessionSummary({
  session,
  onRipMore,
  onPickSet,
  starting = false
}: Props): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const [focused, setFocused] = useState<RipCard | null>(null)
  const all = session.packs.flat()
  const hits = rankedHits(session.packs)
  const hero = hits[0] ?? null
  // Along the bottom: the rest of the best pull's pack, in the order it came.
  const others = hero ? session.packs[hero.pack - 1].filter((c) => c !== hero.card) : []
  const order = hero ? [hero.card, ...others] : []
  const step = (by: number): void =>
    setFocused((f) => {
      if (!f) return f
      const i = order.indexOf(f)
      return order[(i + by + order.length) % order.length]
    })
  const packs = session.packsOpened

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* On the page itself, not a stage: only the hero's rays and bloom light it up. */}
      <div
        data-testid="rip-summary-stage"
        className="relative isolate flex min-h-[460px] flex-1 flex-col"
      >
        <div className="flex h-8 shrink-0 items-center text-sm">
          <h2 data-testid="rip-summary-headline" className="min-w-0 truncate font-normal">
            <span className="font-semibold">
              {packs} {packs === 1 ? 'pack' : 'packs'}
            </span>
            <span className="text-white/55">
              {' '}
              · {session.setName} · {all.length} {all.length === 1 ? 'card' : 'cards'}
            </span>
          </h2>
        </div>

        {/* A size container, absolutely placed: a flex item with size containment reads 0 cqh. */}
        <div className="relative min-h-0 flex-1">
          <div style={{ containerType: 'size' }} className="absolute inset-0">
            {/* Kept laid out, only invisible, under the card list: display:none would cancel
                the animations, and showing it again would replay the whole fanfare. */}
            <div
              data-testid="rip-summary-fanfare"
              className={cn('size-full', showAll && 'invisible')}
            >
              {hero ? (
                <Hero pull={hero} cards={all} onFocus={setFocused} />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <p className="text-sm text-white/60">No hits this time.</p>
                </div>
              )}
            </div>
            {showAll && (
              <div
                data-testid="rip-summary-all"
                className="absolute inset-0 flex flex-col gap-4 overflow-y-auto py-2"
              >
                {session.packs.map((pack, i) => (
                  <section key={i}>
                    <h3 className="mb-2 text-sm font-semibold">{`Pack ${i + 1}`}</h3>
                    <div className="flex flex-wrap gap-2">
                      {pack.map((c) => (
                        <button
                          key={c.slot}
                          type="button"
                          aria-label={`Look at ${c.name}`}
                          onClick={() => setFocused(c)}
                          className="w-20 cursor-zoom-in"
                        >
                          <HoloCard card={c} size="small" />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>

        {others.length > 0 && (
          <div className="shrink-0 pt-1">
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-white/45 uppercase">
              {`The rest of pack ${hero!.pack}`}
            </h3>
            {/* One line that scrolls sideways (the wheel scrolls it too). */}
            <ol
              data-testid="rip-summary-others"
              onWheel={(e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
              }}
              className="flex h-[106px] gap-x-2 overflow-x-auto overflow-y-hidden pt-1.5 [scrollbar-width:thin]"
            >
              {others.map((card, i) => {
                const hit = tierFor(card.rarity, card.setCode) !== 'none'
                const color = rarityColor(baseOf(card.rarity))
                const caption = hit ? `${shortRarity(card.rarity)} · ${card.name}` : card.name
                return (
                  <li key={`${card.pkey}-${i}`} className="shrink-0">
                    <button
                      type="button"
                      aria-label={`Look at ${card.name}`}
                      title={`${card.rarity} · ${card.name}`}
                      onClick={() => setFocused(card)}
                      className="group flex h-[86px] w-[72px] cursor-zoom-in flex-col items-center gap-1"
                    >
                      <div className="w-[44px] transition-transform duration-150 group-hover:-translate-y-1 motion-reduce:transition-none">
                        <HoloCard
                          card={card}
                          size="small"
                          holo={false}
                          shadow={
                            hit
                              ? `0 0 12px ${color}aa, 0 4px 10px rgb(0 0 0 / 0.5)`
                              : '0 4px 10px rgb(0 0 0 / 0.5)'
                          }
                        />
                      </div>
                      <span
                        className={cn(
                          'w-full truncate text-center text-[11px]',
                          hit ? 'text-white/80' : 'text-white/50'
                        )}
                      >
                        {caption}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        {focused && <Focus card={focused} onClose={() => setFocused(null)} onStep={step} />}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button variant="ghost" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide cards' : 'See all cards'}
        </Button>
        {onPickSet && (
          <Button variant="outline" onClick={onPickSet}>
            Pick another set
          </Button>
        )}
        {onRipMore && (
          <Button disabled={starting} onClick={onRipMore}>
            Rip {session.packCount} more
          </Button>
        )}
      </div>
    </div>
  )
}
