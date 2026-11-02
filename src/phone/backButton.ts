import { registerPlugin } from '@capacitor/core'
import { handleBack } from '@/lib/backStack'

/**
 * Android's back button (and back gesture). Whatever is open takes it (see @/lib/backStack). With
 * nothing left, the app leaves as Android's back would.
 */

export { handleBack, useBackHandler } from '@/lib/backStack'

/** The Android app's plugin (android/…/BackButtonPlugin.java): its `back` event replaces the system's back. */
interface BackButtonPlugin {
  addListener(event: 'back', cb: () => void): Promise<{ remove: () => Promise<void> }>
  /** Does what back would have done with nothing open: leaves the app. */
  exit(): Promise<void>
}

/** Takes over Android's back button. Called once, at start, in the Android app only. */
export async function listenForBack(
  plugin: BackButtonPlugin = registerPlugin<BackButtonPlugin>('BackButton')
): Promise<void> {
  await plugin.addListener('back', () => {
    if (!handleBack()) void plugin.exit()
  })
}
