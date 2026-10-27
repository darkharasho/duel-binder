import { useEffect, useState } from 'react'
import { CardArt } from '@/components/CardArt'
import { formatUsd } from '@/lib/format'
import { FADE_MS, type Pull } from './overlay'

const fade = { transitionDuration: `${FADE_MS}ms`, animationDuration: `${FADE_MS}ms` }

function Range({ range }: { range: NonNullable<Pull['range']> }): React.JSX.Element {
  return (
    <p className="text-[clamp(0.75rem,1.4vw,1.3rem)] text-emerald-200/80 tabular-nums">
      {formatUsd(range.low)} – {formatUsd(range.high)}
    </p>
  )
}

function Bar({ pull }: { pull: Pull }): React.JSX.Element {
  const detail = [pull.setCode, pull.rarity].filter((s) => s !== null)
  return (
    <div
      role="status"
      aria-label="Pull"
      className="absolute bottom-[3vw] left-[3vw] flex max-w-[min(70vw,48rem)] items-center gap-[1.2vw] rounded-[clamp(0.9rem,2vw,1.75rem)] bg-black/70 py-[1vw] pr-[2.2vw] pl-[1vw] text-white shadow-[0_4px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
    >
      <CardArt
        imageId={pull.imageId}
        size="small"
        alt=""
        className="w-[clamp(2.5rem,5.5vw,4.5rem)] shrink-0 overflow-hidden rounded-[clamp(0.3rem,0.6vw,0.6rem)]"
      />
      <div className="min-w-0">
        <p className="truncate text-[clamp(1rem,2.4vw,2.25rem)] leading-tight font-semibold">
          {pull.name}
        </p>
        {pull.price !== null && (
          <p className="text-[clamp(1.2rem,3vw,2.75rem)] leading-tight font-bold text-emerald-400 tabular-nums">
            {formatUsd(pull.price)}
          </p>
        )}
        {pull.range !== null && <Range range={pull.range} />}
        {detail.length > 0 && (
          <p className="truncate text-[clamp(0.75rem,1.4vw,1.3rem)] text-white/70">
            {detail.join(' · ')}
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

/** The pull's bar or hit moment. A pull that ends fades out and stays mounted until the fade does. */
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
    </div>
  )
}
