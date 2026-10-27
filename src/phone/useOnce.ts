import { useEffect, useRef, type RefObject } from 'react'

/** A ref that is true while the component is mounted, for async work to check before it sets state. */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}

/**
 * Runs `fn` (as given on the first render) once per component, on mount, even under StrictMode's
 * mount-unmount-mount, so a sign-in isn't traded twice or a download started twice.
 */
export function useOnce(fn: () => void): void {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    fn()
    // Only the first render's fn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
