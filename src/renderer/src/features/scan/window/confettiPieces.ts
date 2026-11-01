const COLORS = ['#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#ffffff']
const PIECES_PER_SIDE = 70
export const LIFE_MS = 3200
export const GRAVITY = 0.0009
export const DRAG = 0.9985

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  spin: number
  color: string
}

/** Two bursts, fired up and inwards from the window's lower corners. Speeds are per millisecond. */
export function launch(width: number, height: number, random = Math.random): Piece[] {
  const scale = height / 720
  return [0, 1].flatMap((side) =>
    Array.from({ length: PIECES_PER_SIDE }, () => {
      const angle = (55 + random() * 30) * (Math.PI / 180)
      const speed = (0.7 + random() * 0.75) * scale
      return {
        x: side ? width : 0,
        y: height * 0.92,
        vx: Math.cos(angle) * speed * (side ? -1 : 1),
        vy: -Math.sin(angle) * speed,
        size: (6 + random() * 7) * scale,
        spin: random() * Math.PI,
        color: COLORS[Math.floor(random() * COLORS.length)]
      }
    })
  )
}
