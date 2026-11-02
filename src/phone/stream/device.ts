import { registerPlugin } from '@capacitor/core'
import { isNativeApp } from '@/lib/portal'

/**
 * The iOS app's stream plugin (ios/App/App/StreamPlugin.swift): `enter` lets the phone rotate to
 * landscape and keeps the screen on, `exit` puts both back.
 */
interface StreamPlugin {
  enter(): Promise<void>
  exit(): Promise<void>
}
const Stream = registerPlugin<StreamPlugin>('Stream')

/** The web wake lock held while streaming outside the app. */
let wakeLock: WakeLockSentinel | null = null

/** Takes the web wake lock; false when there is none to take or it is refused. */
async function holdScreen(): Promise<boolean> {
  let next: WakeLockSentinel | null = null
  try {
    next = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    // Refused: nothing is held.
  }
  // Whatever was held before is let go, so a second take never leaves a lock behind.
  const previous = wakeLock
  wakeLock = next
  await previous?.release().catch(() => {})
  return next !== null
}

/**
 * Starts a stream's device state: in the app, rotation and an awake screen through the plugin; on
 * the web, a screen wake lock. `awake` is false when nothing can hold the screen on.
 */
export async function enterStream(): Promise<{ awake: boolean }> {
  if (isNativeApp()) {
    try {
      await Stream.enter()
      return { awake: true }
    } catch {
      // A build without the plugin: the stream still runs, upright and free to sleep.
      return { awake: false }
    }
  }
  return { awake: await holdScreen() }
}

/** Takes the web wake lock again, which the browser drops whenever the page is hidden. */
export async function reacquireStream(): Promise<void> {
  if (!isNativeApp()) await holdScreen()
}

/** Ends a stream's device state: upright again and the screen free to sleep. */
export async function exitStream(): Promise<void> {
  if (isNativeApp()) {
    await Stream.exit().catch(() => {})
    return
  }
  const lock = wakeLock
  wakeLock = null
  await lock?.release().catch(() => {})
}
