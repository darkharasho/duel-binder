import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Quad } from './vision/detect'

/** How quickly the drawn outline catches up with the latest detection: its time constant, in ms. */
const EASE_MS = 70
/** Each bracket's arms, as a share of the side they run along. */
const ARM = 0.16
const ARM_LOCKED = 0.11

type Point = readonly [number, number]

/**
 * The outline eased toward each new detection, so it glides instead of jumping from frame to
 * frame. A first detection is drawn where it is.
 */
function useEasedQuad(target: Quad | null): Quad | null {
  const [shown, setShown] = useState<Quad | null>(target)
  const current = useRef<Quad | null>(target)
  useEffect(() => {
    if (!target || !current.current || typeof requestAnimationFrame === 'undefined') {
      current.current = target
      setShown(target)
      return
    }
    let frame = 0
    let last = performance.now()
    const step = (now: number): void => {
      const from = current.current!
      const k = 1 - Math.exp(-(now - last) / EASE_MS)
      last = now
      const next = from.map(([x, y], i) => [
        x + (target[i][0] - x) * k,
        y + (target[i][1] - y) * k
      ]) as unknown as Quad
      current.current = next
      setShown(next)
      const left = next.some(
        ([x, y], i) => Math.abs(target[i][0] - x) + Math.abs(target[i][1] - y) > 0.5
      )
      if (left) frame = requestAnimationFrame(step)
      else {
        current.current = target
        setShown(target)
      }
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return shown
}

const toward = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t
]

/** A corner bracket at each of the quad's corners, as one SVG path. */
function brackets(q: Quad, arm: number): string {
  return q
    .map((p, i) => {
      const a = toward(p, q[(i + 3) % 4], arm)
      const b = toward(p, q[(i + 1) % 4], arm)
      return `M${a[0]},${a[1]} L${p[0]},${p[1]} L${b[0]},${b[1]}`
    })
    .join(' ')
}

/**
 * The detected card drawn over the camera preview: white corner brackets while it's being read,
 * closing in round a glowing gold outline once it's been added. `width` and `height` are the
 * scanned crop's, which the quad is in; it's laid over the preview like the video's object-cover.
 */
export function CardOutline({
  quad,
  width,
  height,
  locked
}: {
  quad: Quad
  width: number
  height: number
  locked: boolean
}): React.JSX.Element | null {
  const q = useEasedQuad(quad)
  if (!q) return null
  return (
    <svg
      aria-hidden
      data-locked={locked || undefined}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <polygon
        points={q.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="rgb(251 191 36 / 0.08)"
        stroke="#fbbf24"
        strokeWidth={2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={cn(
          'transition-opacity duration-200 [filter:drop-shadow(0_0_6px_rgb(251_191_36/0.7))] motion-reduce:transition-none',
          locked ? 'opacity-100' : 'opacity-0'
        )}
      />
      <path
        d={brackets(q, locked ? ARM_LOCKED : ARM)}
        fill="none"
        stroke="white"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="[filter:drop-shadow(0_0_5px_rgb(255_255_255/0.55))]"
      />
    </svg>
  )
}
