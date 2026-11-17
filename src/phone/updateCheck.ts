/**
 * The Android APK can't update itself (Google Play updates its own build), so the APK build shows
 * a line that downloads the newer APK. The answer comes from the live-update check, which stores
 * what the portal said under `duelbinder.shellUpdate`. A dismissed version isn't shown again.
 */

const SHELL_UPDATE_KEY = 'duelbinder.shellUpdate'
export const UPDATE_DISMISSED_KEY = 'duelbinder.updateDismissed'

export interface Update {
  version: string
  url: string
}

/** The shell update the last live-update check stored, or null. Never throws. */
export function readShellUpdate(storage: Storage): Update | null {
  try {
    const v = JSON.parse(storage.getItem(SHELL_UPDATE_KEY) ?? 'null') as Update | null
    return v && typeof v.version === 'string' && typeof v.url === 'string'
      ? { version: v.version, url: v.url }
      : null
  } catch {
    return null
  }
}
