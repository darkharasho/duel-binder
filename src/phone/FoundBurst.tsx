import { CheckIcon } from 'lucide-react'
import { formatUsd } from '@/lib/format'

/** Where the sparkles start, as a percentage of the preview, and which way they fly. */
const SPARKS = [
  { left: '24%', top: '18%', dx: '-26px', dy: '-24px' },
  { left: '72%', top: '20%', dx: '26px', dy: '-22px' },
  { left: '22%', top: '66%', dx: '-28px', dy: '20px' },
  { left: '74%', top: '64%', dx: '26px', dy: '22px' },
  { left: '50%', top: '12%', dx: '0px', dy: '-30px' }
]

/**
 * The "found it" moment laid over the camera preview: a green glow around it, a few sparkles,
 * and a bubble with the card's name and price that pops up and fades. Remount it (a new key) to
 * replay it. Only decoration: the scan status already says what was added.
 */
export function FoundBurst({
  name,
  price
}: {
  name: string
  price: number | null | undefined
}): React.JSX.Element {
  return (
    <div
      aria-hidden
      data-found-burst
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
    >
      <div className="absolute inset-0 rounded-[inherit] animate-[scan-glow_900ms_ease-out_both]" />
      {SPARKS.map((s, i) => (
        <span
          key={i}
          style={{ left: s.left, top: s.top, '--dx': s.dx, '--dy': s.dy } as React.CSSProperties}
          className="absolute text-xl text-amber-200 drop-shadow-[0_0_6px_rgb(253_230_138_/_0.8)] animate-[scan-spark_800ms_ease-out_both]"
        >
          ✦
        </span>
      ))}
      <div className="absolute inset-x-0 bottom-12 flex justify-center px-4">
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-emerald-300/40 bg-black/70 py-1.5 pl-1.5 pr-3 text-[13px] font-semibold text-white shadow-lg backdrop-blur-md animate-[scan-pop_1800ms_both]">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-complete text-black">
            <CheckIcon className="size-4" strokeWidth={3} />
          </span>
          <span className="truncate">{name}</span>
          {price != null && (
            <span className="shrink-0 text-emerald-300 tabular-nums">{formatUsd(price)}</span>
          )}
        </div>
      </div>
    </div>
  )
}
