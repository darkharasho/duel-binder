import type { ScanSummary } from '@shared/scanWindow'
import { CardArt } from '@/components/CardArt'
import { formatUsd } from '@/lib/format'
import { plural } from '../scanText'

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

/** The list's value, counts and dearest pulls, opaque over everything else in the window. */
export function SummaryScreen({ summary }: { summary: ScanSummary }): React.JSX.Element {
  const { value, cards, hits, unpriced, top } = summary
  return (
    <div
      role="status"
      aria-label="Summary"
      className="absolute inset-0 flex flex-col overflow-hidden bg-neutral-950 px-[4.5vw] py-[3.5vw] text-white animate-in fade-in"
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
          <div className="mt-[0.8vw] flex items-baseline gap-[4vw]">
            <p className="text-[clamp(2.4rem,6.5vw,6.5rem)] leading-none font-extrabold text-emerald-400 tabular-nums">
              {formatUsd(value)}
            </p>
            <Stat value={cards} label={cards === 1 ? 'card' : 'cards'} />
            <Stat value={hits} label={hits === 1 ? 'hit' : 'hits'} />
          </div>
          {top.length > 0 && (
            <>
              <p className="mt-[2.2vw] mb-[1vw] text-[clamp(0.8rem,1.4vw,1.3rem)] font-semibold text-white/60">
                Top pulls
              </p>
              <ol className="flex gap-[1.6vw]">
                {top.map((c) => (
                  <li key={c.key} className="w-[min(17vw,36vh)] min-w-0">
                    <CardArt
                      imageId={c.imageId}
                      size="full"
                      alt=""
                      className="w-full overflow-hidden rounded-[clamp(0.4rem,0.9vw,0.8rem)]"
                    />
                    <p className="mt-[0.7vw] truncate text-[clamp(0.8rem,1.5vw,1.4rem)] font-semibold">
                      {c.name}
                    </p>
                    {c.guess && (
                      <p className="text-[clamp(0.7rem,1.1vw,1rem)] text-amber-300">Best guess</p>
                    )}
                    <p className="flex items-baseline gap-[0.5vw] text-[clamp(0.9rem,1.8vw,1.7rem)] font-bold text-emerald-400 tabular-nums">
                      {formatUsd(c.price)}
                      {c.raw && (
                        <span className="text-[0.7em] font-normal text-emerald-200/80">Raw</span>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
          {unpriced > 0 && (
            <p className="absolute right-[4.5vw] bottom-[2vw] text-[clamp(0.7rem,1.1vw,1rem)] text-white/50 tabular-nums">
              {plural(unpriced, 'card', 'cards')} with no price
            </p>
          )}
        </>
      )}
    </div>
  )
}
