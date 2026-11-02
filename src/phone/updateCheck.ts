import { isNewer, pickApk } from '@shared/androidRelease'

/**
 * The Android APK can't update itself (Google Play updates its own build), so the APK build looks
 * at the latest GitHub release at most once a day and, when it carries a newer APK, shows a line
 * that downloads it. A dismissed version isn't shown again.
 */

const LATEST_RELEASE = 'https://api.github.com/repos/darkharasho/duel-binder/releases/latest'
const DAY_MS = 24 * 60 * 60 * 1000
export const UPDATE_CHECKED_KEY = 'duelbinder.updateCheckedAt'
export const UPDATE_DISMISSED_KEY = 'duelbinder.updateDismissed'
const UPDATE_FOUND_KEY = 'duelbinder.updateFound'

export interface Update {
  version: string
  url: string
}

function readFound(storage: Storage): Update | null {
  try {
    const v = JSON.parse(storage.getItem(UPDATE_FOUND_KEY) ?? 'null') as Update | null
    return v && typeof v.version === 'string' && typeof v.url === 'string' ? v : null
  } catch {
    return null
  }
}

/**
 * The newer APK, or null. Asks GitHub when the last ask was a day ago or more (failed or not), and
 * otherwise answers from what that ask found. Never throws.
 */
export async function checkForUpdate(deps: {
  fetch: typeof fetch
  now: () => number
  storage: Storage
  current: string
}): Promise<Update | null> {
  const { storage, current } = deps
  const checked = Number(storage.getItem(UPDATE_CHECKED_KEY))
  if (!(checked > 0 && deps.now() - checked < DAY_MS)) {
    storage.setItem(UPDATE_CHECKED_KEY, String(deps.now()))
    try {
      const res = await deps.fetch(LATEST_RELEASE, {
        headers: { accept: 'application/vnd.github+json' }
      })
      if (res.ok) {
        const apk = pickApk(await res.json())
        storage.setItem(
          UPDATE_FOUND_KEY,
          JSON.stringify(apk ? { version: apk.version, url: apk.url } : null)
        )
      }
    } catch {
      // Offline: asked again tomorrow.
    }
  }
  const found = readFound(storage)
  return found && isNewer(found.version, current) ? found : null
}
