import { useEffect } from 'react'
import { isNativeApp } from '@/lib/portal'
import { startLiveUpdate } from './liveUpdate'

// Tells the live-update plugin this bundle booted, or it rolls back to the previous one. Only once
// the app has rendered: a bundle that throws before that never says it's ready, so it rolls back.
let started = false
function setUpLiveUpdate(): void {
  if (started || !isNativeApp()) return
  started = true
  void import('@capgo/capacitor-updater')
    .then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady())
    .then(() => {
      startLiveUpdate()
    })
    .catch((err: unknown) => {
      console.warn('Live update setup failed:', err)
    })
}

/** Render after App: its effect runs once App's first render has committed. */
export function LiveUpdateBoot(): null {
  useEffect(setUpLiveUpdate, [])
  return null
}
