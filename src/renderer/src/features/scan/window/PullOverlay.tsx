import { useEffect, useState } from 'react'
import { StarIcon } from 'lucide-react'
import { CardArt } from '@/components/CardArt'
import { formatUsd } from '@/lib/format'
import { FoundBurst } from '../FoundBurst'
import { FADE_MS, type Pull } from './overlay'

const fade = { transitionDuration: `${FADE_MS}ms`, animationDuration: `${FADE_MS}ms` }

function Range({ range }: { range: NonNullable<Pull['range']> }): React.JSX.Element {
  return (
    <p className="text-[clamp(0.75rem,1.4vw,1.3rem)] text-emerald-200/80 tabular-nums">
      {formatUsd(range.low)} – {formatUsd(range.high)}
    </p>
  )
}

/** The phone's last-scan card, sized to the window: art, name, set, price and rarity. */
function Bar({ pull }: { pull: Pull }): React.JSX.Element {
  const sub = [pull.setCode, pull.setName].filter((s) => s !== null).join(' · ')
  return (
    <div
      role="status"
      aria-label="Pull"
      className="absolute bottom-[3vw] left-[3vw] flex max-w-[min(70vw,48rem)] gap-[1.2vw] rounded-[clamp(1.25rem,2.6vw,2.25rem)] border border-white/[0.13] bg-black/45 p-[1vw] pr-[2.2vw] text-white shadow-[0_10px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl"
    >
      <CardArt
        imageId={pull.imageId}
        size="small"
        alt=""
        className="w-[clamp(3rem,6.5vw,5.5rem)] shrink-0 self-start overflow-hidden rounded-[clamp(0.3rem,0.6vw,0.6rem)] animate-[scan-drop_500ms_ease-in_both]"
      />
      <div className="min-w-0 text-[clamp(0.75rem,1.4vw,1.3rem)] leading-snug">
        <p className="truncate text-[clamp(1rem,2.4vw,2.25rem)] leading-tight font-semibold">
          {pull.name}
        </p>
        {sub && <p className="truncate text-white/60">{sub}</p>}
        {pull.price !== null && (
          <p className="text-[clamp(1.1rem,2.6vw,2.4rem)] leading-tight font-bold text-emerald-400 tabular-nums">
            {formatUsd(pull.price)}
          </p>
        )}
        {pull.range !== null && <Range range={pull.range} />}
        {pull.rarity !== null && (
          <p className="mt-[0.2vw] flex items-center gap-[0.4vw] text-white/75">
            <StarIcon aria-hidden className="size-[1.1em] shrink-0" />
            <span className="truncate">{pull.rarity}</span>
          </p>
        )}
      </div>
    </div>
  )
}

function Hit({ pull }: { pull: Pull }): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Hit"
      className="absolute inset-x-0 top-0 flex flex-col items-center gap-[0.6vw] px-[4vw] pt-[3vw] pb-[6vw] text-center text-white"
      style={{
        background:
          'radial-gradient(ellipse 60% 100% at 50% 0%, rgba(251,191,36,0.45), rgba(251,191,36,0) 70%)'
      }}
    >
      {pull.rarity !== null && (
        <p className="text-[clamp(0.8rem,1.5vw,1.4rem)] font-semibold tracking-[0.3em] text-amber-300 uppercase">
          {pull.rarity}
        </p>
      )}
      <p className="text-[clamp(1.6rem,4.5vw,4.5rem)] leading-tight font-bold [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
        {pull.name}
      </p>
      {pull.price !== null && (
        <p className="text-[clamp(1.4rem,3.5vw,3.5rem)] font-bold text-emerald-400 tabular-nums">
          {formatUsd(pull.price)}
        </p>
      )}
      {pull.range !== null && <Range range={pull.range} />}
    </div>
  )
}

/**
 * The pull's card or hit moment, with the phone's "found it" glow and sparkles (and, on a card,
 * its bubble). A pull that ends fades out and stays mounted until the fade does.
 */
export function PullOverlay({ pull }: { pull: Pull | null }): React.JSX.Element | null {
  const [shown, setShown] = useState<Pull | null>(pull)
  if (pull !== null && pull !== shown) setShown(pull)

  useEffect(() => {
    if (pull !== null) return
    const timer = setTimeout(() => setShown(null), FADE_MS)
    return () => clearTimeout(timer)
  }, [pull])

  if (shown === null) return null
  return (
    <div
      // A new pull mounts afresh and fades in; an ended one fades out where it is.
      key={shown.key}
      style={fade}
      className={`pointer-events-none absolute inset-0 animate-in fade-in transition-opacity ${pull === null ? 'opacity-0' : 'opacity-100'}`}
    >
      {shown.hit ? <Hit pull={shown} /> : <Bar pull={shown} />}
      <FoundBurst name={shown.name} price={shown.price} stream bubble={!shown.hit} />
    </div>
  )
}
