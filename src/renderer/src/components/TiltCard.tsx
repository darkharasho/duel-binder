import { useRef } from 'react'
import { cn } from '@/lib/utils'

/** A finger that moves this far sideways is swiping, and the card lies flat again. */
const SWIPE_SLOP = 10

interface TiltCardProps {
  children: React.ReactNode
  /** Sizes the card; children placed absolutely (badges) tilt along with it. */
  className?: string
  /** Largest tilt in degrees, reached at the card's edges. */
  maxTilt?: number
  /** Rounds the glare to match the card's corners. */
  glareClassName?: string
  /** On the part that tilts, e.g. a glow that should lean with the card. */
  innerStyle?: React.CSSProperties
  innerClassName?: string
  /** Also tilts under a finger held on the card (the phone); otherwise only the mouse tilts it. */
  touch?: boolean
}

/**
 * Tilts its contents toward the mouse like a card held in the hand, with a glare that follows.
 * With `touch`, a finger pressed on the card tilts it too, until it lifts, the page scrolls, or it
 * swipes sideways to the next card.
 */
export function TiltCard({
  children,
  className,
  maxTilt = 14,
  glareClassName,
  innerStyle,
  innerClassName,
  touch = false
}: TiltCardProps): React.JSX.Element {
  const inner = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const pressed = useRef(false)
  // Where the finger went down; once it heads sideways it's swiping between cards, not tilting.
  const origin = useRef({ x: 0, y: 0 })

  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'mouse' && !(touch && pressed.current)) return
    if (e.pointerType !== 'mouse') {
      const dx = Math.abs(e.clientX - origin.current.x)
      const dy = Math.abs(e.clientY - origin.current.y)
      if (dx > SWIPE_SLOP && dx > dy) return leave()
    }
    const rect = e.currentTarget.getBoundingClientRect()
    // A finger keeps reporting after a swipe drags it off the card; the edge is as far as it leans.
    const clamp = (v: number): number => Math.min(1, Math.max(0, v))
    const x = clamp((e.clientX - rect.left) / rect.width)
    const y = clamp((e.clientY - rect.top) / rect.height)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = inner.current
      if (!el) return
      el.style.setProperty('--tilt-x', `${((0.5 - y) * maxTilt * 2).toFixed(2)}deg`)
      el.style.setProperty('--tilt-y', `${((x - 0.5) * maxTilt * 2).toFixed(2)}deg`)
      el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`)
      el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`)
      el.dataset.tilting = ''
    })
  }

  const down = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!touch || e.pointerType === 'mouse') return
    pressed.current = true
    origin.current = { x: e.clientX, y: e.clientY }
    move(e)
  }

  const leave = (): void => {
    pressed.current = false
    cancelAnimationFrame(frame.current)
    const el = inner.current
    if (!el) return
    el.style.removeProperty('--tilt-x')
    el.style.removeProperty('--tilt-y')
    delete el.dataset.tilting
  }

  return (
    // The untilted wrapper measures the pointer, so the card's own movement doesn't feed back.
    <div
      className={cn('[perspective:700px]', className)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerLeave={leave}
      onPointerUp={touch ? leave : undefined}
      onPointerCancel={leave}
    >
      <div
        ref={inner}
        style={innerStyle}
        className={cn(
          'group/tilt relative transition-transform duration-500 ease-out',
          '[transform:rotateX(var(--tilt-x,0deg))_rotateY(var(--tilt-y,0deg))]',
          'data-[tilting]:duration-100 data-[tilting]:[transform:rotateX(var(--tilt-x,0deg))_rotateY(var(--tilt-y,0deg))_scale(1.05)]',
          'motion-reduce:transform-none',
          innerClassName
        )}
      >
        {children}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[4px] opacity-0 mix-blend-overlay transition-opacity duration-300 group-data-[tilting]/tilt:opacity-100 motion-reduce:hidden',
            glareClassName
          )}
          style={{
            background:
              'radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 50%), rgb(255 255 255 / 0.55), transparent 60%)'
          }}
        />
      </div>
    </div>
  )
}
