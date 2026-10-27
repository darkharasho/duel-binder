import { useRef } from 'react'
import { cn } from '@/lib/utils'

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
}

/** Tilts its contents toward the mouse like a card held in the hand, with a glare that follows. */
export function TiltCard({
  children,
  className,
  maxTilt = 14,
  glareClassName,
  innerStyle,
  innerClassName
}: TiltCardProps): React.JSX.Element {
  const inner = useRef<HTMLDivElement>(null)
  const frame = useRef(0)

  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'mouse') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
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

  const leave = (): void => {
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
      onPointerMove={move}
      onPointerLeave={leave}
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
