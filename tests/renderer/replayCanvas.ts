/** A 2D context that records every call as [name, ...args] and accepts any property set. */
export function recordingContext(): { ctx: CanvasRenderingContext2D; calls: unknown[][] } {
  const calls: unknown[][] = []
  const gradient = { addColorStop: () => {} }
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 10 })
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
      }
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

/** The text drawn with fillText. */
export const textsOf = (calls: unknown[][]): string[] =>
  calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]))
