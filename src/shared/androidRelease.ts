/**
 * The Android APK on a GitHub release: the phone app's update banner (src/phone/UpdateBanner.tsx)
 * and duelbinder.com's download link (workers/portal/src/site/releases.ts) both read it from the
 * "latest release" JSON. .github/workflows/android.yml names it Duel-Binder-<version>.apk.
 */

export interface ApkAsset {
  version: string
  name: string
  size: number
  url: string
}

const APK_RE = /^Duel-Binder-.+\.apk$/
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The release's APK and version, or null when it has none (or isn't a release). */
export function pickApk(release: unknown): ApkAsset | null {
  if (!isRecord(release) || typeof release.tag_name !== 'string') return null
  if (!Array.isArray(release.assets)) return null
  for (const a of release.assets) {
    if (
      isRecord(a) &&
      typeof a.name === 'string' &&
      APK_RE.test(a.name) &&
      typeof a.size === 'number' &&
      typeof a.browser_download_url === 'string'
    ) {
      return {
        version: release.tag_name.replace(/^v/, ''),
        name: a.name,
        size: a.size,
        url: a.browser_download_url
      }
    }
  }
  return null
}

const parts = (v: string): number[] | null => {
  const m = VERSION_RE.exec(v)
  return m ? m.slice(1).map(Number) : null
}

/** True when `latest` is a later x.y.z than `current`; false when either can't be read. */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
