import { CheckIcon } from 'lucide-react'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Where the sparkles start, as a percentage of the preview, and which way they fly. */
const SPARKS = [
  { left: '24%', top: '18%', dx: '-26px', dy: '-24px' },
  { left: '72%', top: '20%', dx: '26px', dy: '-22px' },
  { left: '22%', top: '66%', dx: '-28px', dy: '20px' },
  { left: '74%', top: '64%', dx: '26px', dy: '22px' },
  { left: '50%', top: '12%', dx: '0px', dy: '-30px' }
]

/**
 * The "found it" moment laid over the camera preview: a gold glow around it, a ring opening out
 * and a sheen crossing the picture, a few sparkles, and a bubble with the card's name and price
 * that pops up and fades. Remount it (a new key) to replay it. Only decoration: the scan status
 * already says what was added. `stream` is the scan window's: sized to the window, the bubble at
 * the top (the last-scan card is at the bottom).
 */
export function FoundBurst({
  name,
  price,
  stream = false,
  bubble = true
}: {
  name: string
  price: number | null | undefined
  stream?: boolean
  bubble?: boolean
}): React.JSX.Element {
  return (
    <div
      aria-hidden
      data-found-burst
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
    >
      <div className="absolute inset-0 rounded-[inherit] animate-[scan-glow_900ms_ease-out_both]" />
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <div className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/25 to-transparent animate-[scan-sheen_750ms_ease-out_both]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative aspect-[63/88] h-4/5 max-w-[85%]">
          <div className="absolute inset-0 rounded-[6%] border-2 border-amber-200 animate-[scan-ring_800ms_ease-out_both]" />
        </div>
      </div>
      {SPARKS.map((s, i) => (
        <span
          key={i}
          style={{ left: s.left, top: s.top, '--dx': s.dx, '--dy': s.dy } as React.CSSProperties}
          className={cn(
            'absolute text-amber-200 drop-shadow-[0_0_6px_rgb(253_230_138_/_0.8)] animate-[scan-spark_800ms_ease-out_both]',
            stream ? 'text-[clamp(1.25rem,3vw,3rem)]' : 'text-xl'
          )}
        >
          ✦
        </span>
      ))}
      {bubble && (
        <div
          className={cn(
            'absolute inset-x-0 flex justify-center',
            stream ? 'top-[4vw] px-[4vw]' : 'bottom-12 px-4'
          )}
        >
          <div
            className={cn(
              'flex min-w-0 items-center rounded-full border border-amber-300/40 bg-black/70 font-semibold text-white shadow-lg backdrop-blur-md animate-[scan-pop_1800ms_both]',
              stream
                ? 'gap-[0.8vw] py-[0.6vw] pr-[1.4vw] pl-[0.6vw] text-[clamp(0.9rem,1.9vw,1.9rem)]'
                : 'gap-2 py-1.5 pr-3 pl-1.5 text-[13px]'
            )}
          >
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full bg-complete text-black',
                stream ? 'size-[clamp(1.5rem,3vw,3rem)]' : 'size-6'
              )}
            >
              <CheckIcon className="size-2/3" strokeWidth={3} />
            </span>
            <span className="truncate">{name}</span>
            {price != null && (
              <span className="shrink-0 text-emerald-300 tabular-nums">{formatUsd(price)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
