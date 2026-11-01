import { useEffect, useRef } from 'react'
import { DRAG, GRAVITY, launch, LIFE_MS } from './confettiPieces'

/** Side confetti for a hit. Plays once per mount, so key it by the pull. Off under reduced motion. */
export function Confetti(): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
    const pieces = launch(canvas.width, canvas.height)
    const start = performance.now()
    let last = start
    let frame = 0
    const draw = (now: number): void => {
      const dt = Math.min(now - last, 50)
      last = now
      g.clearRect(0, 0, canvas.width, canvas.height)
      const left = 1 - (now - start) / LIFE_MS
      if (left <= 0) return
      g.globalAlpha = Math.min(1, left * 3)
      for (const p of pieces) {
        p.vy += GRAVITY * dt * (canvas.height / 720)
        p.vx *= DRAG ** dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.spin += dt * 0.008
        g.fillStyle = p.color
        g.save()
        g.translate(p.x, p.y)
        g.rotate(p.spin)
        g.fillRect(
          -p.size / 2,
          -p.size / 4,
          p.size,
          (p.size / 2) * (0.4 + Math.abs(Math.cos(p.spin)))
        )
        g.restore()
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <canvas
      ref={canvasRef}
      data-testid="confetti"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
