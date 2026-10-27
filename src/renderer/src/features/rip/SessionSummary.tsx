import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { baseOf, compareRarity, revealTier } from '../../../../shared/rip/rarity'
import type { RipCard, RipSessionDetail } from '../../../../shared/rip/types'
import { HoloCard } from './HoloCard'

const BEST_SHOWN = 8

const shortRarity = (rarity: string): string => baseOf(rarity).replace(/ Rare$/, '')

/** Counts of the big hits, rarest first: "1 Secret · 1 Ultra · 3 Super". Empty without any. */
// eslint-disable-next-line react-refresh/only-export-components
export function hitsLine(cards: RipCard[]): string {
  const counts = new Map<string, { rarity: string; n: number }>()
  for (const c of cards) {
    const tier = revealTier(c.rarity)
    if (tier !== 'big' && tier !== 'huge') continue
    const key = shortRarity(c.rarity)
    const entry = counts.get(key) ?? { rarity: c.rarity, n: 0 }
    entry.n += 1
    counts.set(key, entry)
  }
  return [...counts.entries()]
    .sort((a, b) => compareRarity(a[1].rarity, b[1].rarity))
    .map(([name, { n }]) => `${n} ${name}`)
    .join(' · ')
}

interface Props {
  session: RipSessionDetail
  onRipMore?: () => void
  onPickSet?: () => void
  /** Disables Rip more while a new session is starting. */
  starting?: boolean
}

/** What a session pulled: headline, the hits, the best cards, and every card by pack on demand. */
export function SessionSummary({
  session,
  onRipMore,
  onPickSet,
  starting = false
}: Props): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const all = session.packs.flat()
  const hits = hitsLine(all)
  const ranked = [...all]
    .filter((c) => revealTier(c.rarity) !== 'none')
    .sort((a, b) => compareRarity(a.rarity, b.rarity))
    .slice(0, BEST_SHOWN)
  const best = ranked.length === 0 && session.best ? [session.best] : ranked
  const packs = session.packsOpened

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {`${packs} ${packs === 1 ? 'pack' : 'packs'} of ${session.setName}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {all.length} {all.length === 1 ? 'card' : 'cards'}
        </p>
        {hits && <p className="mt-1 text-sm font-medium">{hits}</p>}
      </div>

      {best.length > 0 ? (
        <div data-testid="rip-summary-best" className="flex flex-wrap gap-3">
          {best.map((c, i) => (
            <div key={`${c.pkey}-${i}`} className="w-32">
              <HoloCard card={c} size="small" />
              <p className="mt-1 truncate text-xs">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">{c.rarity}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No hits this time.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {onRipMore && (
          <Button disabled={starting} onClick={onRipMore}>
            Rip {session.packCount} more
          </Button>
        )}
        {onPickSet && (
          <Button variant="outline" onClick={onPickSet}>
            Pick another set
          </Button>
        )}
        <Button variant="ghost" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide cards' : 'See all cards'}
        </Button>
      </div>

      {showAll && (
        <div className="flex flex-col gap-4">
          {session.packs.map((pack, i) => (
            <section key={i}>
              <h3 className="mb-2 text-sm font-semibold">{`Pack ${i + 1}`}</h3>
              <div className={cn('flex flex-wrap gap-2')}>
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
  )
}
