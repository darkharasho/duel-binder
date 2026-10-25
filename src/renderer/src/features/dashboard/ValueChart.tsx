import { useState } from 'react'
import type { ValuePoint } from '@shared/types'
import { formatUsd } from '@/lib/format'

const W = 600
const H = 160
/** Room above and below the line so its peaks and dips aren't clipped. */
const PAD = 8

const dayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})
const dayOf = (date: string): number => Date.parse(`${date}T00:00:00Z`)
const formatDay = (date: string): string => dayFormat.format(dayOf(date))

const signed = (n: number): string => `${n < 0 ? '-' : '+'}${formatUsd(Math.abs(n))}`

interface Plotted extends ValuePoint {
  x: number
  y: number
}

function plot(history: ValuePoint[]): { points: Plotted[]; lo: number; hi: number } {
  const t0 = dayOf(history[0].date)
  const span = dayOf(history[history.length - 1].date) - t0 || 1
  const values = history.map((p) => p.totalValue)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi === lo) {
    // A flat line sits in the middle rather than on the floor.
    const pad = Math.abs(hi) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const points = history.map((p) => ({
    ...p,
    x: ((dayOf(p.date) - t0) / span) * W,
    y: H - PAD - ((p.totalValue - lo) / (hi - lo)) * (H - 2 * PAD)
  }))
  return { points, lo, hi }
}

/** The collection's recorded value, one point per day, with the change since the first day. */
export function ValueChart({ history }: { history: ValuePoint[] }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)

  if (history.length < 2) {
    return (
      <figure aria-label="Value over time" className="flex h-full min-h-40 flex-col">
        <figcaption className="mb-3 text-sm font-semibold">Value over time</figcaption>
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-white/10 px-6 text-center text-[13px] text-muted-foreground">
          Your collection&apos;s value builds up here, one point a day.
        </div>
      </figure>
    )
  }

  const { points, lo, hi } = plot(history)
  const first = points[0]
  const last = points[points.length - 1]
  const change = last.totalValue - first.totalValue
  const pct = first.totalValue > 0 ? (change / first.totalValue) * 100 : null
  const tone = change < 0 ? 'text-rose-400' : 'text-emerald-400'
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `M0,${H} L${line.replaceAll(' ', ' L')} L${W},${H} Z`
  const shown = hover === null ? null : points[hover]

  const onMove = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const rect = ev.currentTarget.getBoundingClientRect()
    const x = ((ev.clientX - rect.left) / rect.width) * W
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i
    }
    setHover(best)
  }

  return (
    <figure aria-label="Value over time" className="flex h-full min-h-40 flex-col">
      <figcaption className="mb-3 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold">Value over time</span>
        <span className={`font-mono text-xs ${tone}`}>{signed(change)}</span>
        {pct !== null && (
          <span className={`font-mono text-xs ${tone}`}>
            ({change < 0 ? '-' : '+'}
            {Math.abs(pct).toFixed(1)}%)
          </span>
        )}
        <span className="text-xs text-muted-foreground">since {formatDay(first.date)}</span>
      </figcaption>
      <div className="flex min-h-32 flex-1 gap-2">
        <div
          className={`relative flex-1 ${tone}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            aria-hidden
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id="value-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line
              x1="0"
              x2={W}
              y1={H - 0.5}
              y2={H - 0.5}
              className="stroke-white/10"
              vectorEffect="non-scaling-stroke"
            />
            <path d={area} fill="url(#value-fill)" />
            <polyline
              points={line}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {shown && (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-white/20"
                style={{ left: `${(shown.x / W) * 100}%` }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-current"
                style={{ left: `${(shown.x / W) * 100}%`, top: `${(shown.y / H) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute -top-2 z-10 whitespace-nowrap rounded-md border border-white/10 bg-popover px-2 py-1 text-xs text-foreground shadow-lg"
                style={{
                  left: `${(shown.x / W) * 100}%`,
                  transform: `translate(${shown.x > W / 2 ? '-100%' : '0'}, -100%)`
                }}
              >
                <span className="text-muted-foreground">{formatDay(shown.date)}</span>{' '}
                <span className="font-mono">{formatUsd(shown.totalValue)}</span>{' '}
                <span className="text-muted-foreground">· {shown.totalCards} cards</span>
              </div>
            </>
          )}
        </div>
        <div
          aria-hidden
          className="flex flex-col justify-between py-0.5 text-right font-mono text-[11px] text-muted-foreground"
        >
          <span>{formatUsd(hi)}</span>
          <span>{formatUsd(lo)}</span>
        </div>
      </div>
      <div
        aria-hidden
        className="mt-1.5 flex justify-between pr-14 text-[11px] text-muted-foreground"
      >
        <span>{formatDay(first.date)}</span>
        <span>{formatDay(last.date)}</span>
      </div>
    </figure>
  )
}
