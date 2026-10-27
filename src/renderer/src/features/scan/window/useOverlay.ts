import { useCallback, useEffect, useState } from 'react'
import { NO_OVERLAY, pushPull, tickOverlay, type OverlayState, type Pull } from './overlay'

/** What the overlay shows now: pushes and expiry go through the rules in overlay.ts. */
export function useOverlay(): { overlay: Pull | null; push: (p: Pull) => void; clear: () => void } {
  const [state, setState] = useState<OverlayState>(NO_OVERLAY)

  const push = useCallback((p: Pull) => setState((s) => pushPull(s, p, Date.now())), [])
  const clear = useCallback(() => setState(NO_OVERLAY), [])

  useEffect(() => {
    if (!state.showing && !state.pending) return
    const timer = setTimeout(
      // Never earlier than `until`, so a timer that fires a millisecond early still expires it.
      () => setState((s) => tickOverlay(s, Math.max(Date.now(), s.until))),
      Math.max(0, state.until - Date.now())
    )
    return () => clearTimeout(timer)
  }, [state])

  return { overlay: state.showing, push, clear }
}
