import { useEffect, useRef, useState } from 'react'
import { upcomingCutoff } from './setsView'

/**
 * Today's upcoming cutoff, kept current for a window left open across midnight: rechecked when
 * the page becomes visible, the window gains focus, or `refreshedAt` (the sets query) changes.
 */
export function useUpcomingCutoff(refreshedAt: number): string {
  const [cutoff, setCutoff] = useState(upcomingCutoff)
  const current = useRef(cutoff)
  useEffect(() => {
    const recheck = (): void => {
      const next = upcomingCutoff()
      if (next === current.current) return
      current.current = next
      setCutoff(next)
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') recheck()
    }
    recheck()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
    }
  }, [refreshedAt])
  return cutoff
}
