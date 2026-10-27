import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { rarityColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import { baseOf, compareRarity, revealTier } from '../../../../shared/rip/rarity'
import type { RevealTier, RipCard, RipSessionDetail } from '../../../../shared/rip/types'
import { RarityBadge } from './CardInfo'
import { HoloCard } from './HoloCard'
import { STAGE, prefersReducedMotion } from './stage'

/** Small hits shown along the bottom, after the best pull. */
const OTHERS_SHOWN = 10

const shortRarity = (rarity: string): string => baseOf(rarity).replace(/ Rare$/, '')

/** The big hits counted by rarity, rarest first. */
// eslint-disable-next-line react-refresh/only-export-components
export function hitCounts(cards: RipCard[]): { rarity: string; label: string; n: number }[] {
  const counts = new Map<string, { rarity: string; label: string; n: number }>()
  for (const c of cards) {
    const tier = revealTier(c.rarity)
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
    .filter((p) => revealTier(p.card.rarity) !== 'none')
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
function Hero({ pull, cards }: { pull: Pull; cards: RipCard[] }): React.JSX.Element {
  const { card, pack } = pull
  const tier = revealTier(card.rarity)
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
              width: `calc(${HERO_H} * 2.3)`,
              height: `calc(${HERO_H} * 2.3)`,
              left: `calc(50% - ${HERO_H} * 1.15)`,
              top: `calc(50% - ${HERO_H} * 1.15)`,
              opacity: tier === 'huge' ? 0.7 : 0.4,
              backgroundImage: `repeating-conic-gradient(from 0deg, ${color} 0deg 5deg, transparent 5deg 15deg)`,
              maskImage: 'radial-gradient(circle, #000 18%, transparent 66%)',
              WebkitMaskImage: 'radial-gradient(circle, #000 18%, transparent 66%)'
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
            backgroundImage: `radial-gradient(circle, ${color}${tier === 'huge' ? '77' : '55'} 0%, transparent 65%)`
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
            <div
              className="rounded-[8px]"
              style={{
                boxShadow: `0 0 ${tier === 'huge' ? 70 : 40}px ${color}, 0 30px 60px rgb(0 0 0 / 0.65)`
              }}
            >
              <HoloCard card={card} size="full" />
            </div>
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

interface Props {
  session: RipSessionDetail
  onRipMore?: () => void
  onPickSet?: () => void
  /** Disables Rip more while a new session is starting. */
  starting?: boolean
}

/**
 * What a session pulled, on a stage like the opener's: the best pull large with fanfare, the other
 * hits along the bottom, and every card by pack on demand. Fills the height it's given.
 */
export function SessionSummary({
  session,
  onRipMore,
  onPickSet,
  starting = false
}: Props): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const all = session.packs.flat()
  const hits = rankedHits(session.packs)
  const hero = hits[0] ?? null
  const others = hits.slice(1, 1 + OTHERS_SHOWN)
  const packs = session.packsOpened

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        data-testid="rip-summary-stage"
        style={{ backgroundImage: STAGE }}
        className="relative isolate flex min-h-[460px] flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.06]"
      >
        <div className="flex h-11 shrink-0 items-center px-5 text-sm">
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
                <Hero pull={hero} cards={all} />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <p className="text-sm text-white/60">No hits this time.</p>
                </div>
              )}
            </div>
            {showAll && (
              <div
                data-testid="rip-summary-all"
                className="absolute inset-0 flex flex-col gap-4 overflow-y-auto px-5 py-2"
              >
                {session.packs.map((pack, i) => (
                  <section key={i}>
                    <h3 className="mb-2 text-sm font-semibold">{`Pack ${i + 1}`}</h3>
                    <div className="flex flex-wrap gap-2">
                      {pack.map((c) => (
                        <div key={c.slot} className="w-20">
                          <HoloCard card={c} size="small" />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>

        {others.length > 0 && (
          <div className="shrink-0 px-5 pt-1 pb-3">
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-white/45 uppercase">
              Other hits
            </h3>
            {/* One line; what doesn't fit wraps out of sight (See all cards has every one). */}
            <ol
              data-testid="rip-summary-others"
              className="flex h-[86px] flex-wrap gap-x-2 overflow-hidden"
            >
              {others.map(({ card }, i) => {
                const color = rarityColor(baseOf(card.rarity))
                const caption = `${shortRarity(card.rarity)} · ${card.name}`
                return (
                  <li
                    key={`${card.pkey}-${i}`}
                    title={`${card.rarity} · ${card.name}`}
                    className="flex h-[86px] w-[84px] flex-col items-center gap-1"
                  >
                    <div
                      className="w-[44px] rounded-[3px]"
                      style={{ boxShadow: `0 0 12px ${color}aa, 0 4px 10px rgb(0 0 0 / 0.5)` }}
                    >
                      <HoloCard card={card} size="small" holo={false} />
                    </div>
                    <span className="w-full truncate text-center text-[11px] text-white/75">
                      {caption}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
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
