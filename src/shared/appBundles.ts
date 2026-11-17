/**
 * The release format for live (over-the-air) web-bundle updates of the phone apps. The portal Worker,
 * the CI publish scripts and the phone app all use it, so they agree on what a release is and on the
 * exact bytes that get signed.
 */
import { isNewer } from './androidRelease'

export type BundleTarget = 'ios' | 'android-apk' | 'android-play'

const TARGETS: readonly string[] = ['ios', 'android-apk', 'android-play']

/** True when v is one of the three app targets. */
export function isBundleTarget(v: unknown): v is BundleTarget {
  return typeof v === 'string' && TARGETS.includes(v)
}

/** One file of a bundle, named as the updater plugin expects. */
export interface ManifestEntry {
  file_name: string
  file_hash: string
  download_url: string
}

/** A published release as the portal stores it. signature is base64url, IEEE P1363 ECDSA P-256. */
export interface ReleaseRecord {
  target: BundleTarget
  version: string
  fingerprint: string
  schema: number
  manifest: ManifestEntry[]
  signature: string
  createdAt: string
  withdrawn?: true
  apkUrl?: string
}

/** The part of a release the update check needs. */
export interface IndexEntry {
  version: string
  fingerprint: string
  schema: number
  withdrawn?: true
  apkUrl?: string
}

/** What the update endpoint answers: nothing new, or a signed bundle; either may point at a new app shell. */
export type AppUpdateAnswer =
  | { version: null; shellUpdate?: { version: string; url: string } }
  | {
      version: string
      manifest: ManifestEntry[]
      signature: string
      shellUpdate?: { version: string; url: string }
    }

/** The bytes that are signed: target, version and the manifest sorted by file name, as compact JSON. */
export function signedMessage(
  target: BundleTarget,
  version: string,
  manifest: ManifestEntry[]
): Uint8Array {
  const files = manifest
    .map((m) => [m.file_name, m.file_hash, m.download_url])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return new TextEncoder().encode(JSON.stringify([target, version, files]))
}

const newest = (entries: IndexEntry[]): IndexEntry | null =>
  entries.reduce<IndexEntry | null>((best, x) => (!best || isNewer(x.version, best.version) ? x : best), null)

/**
 * The release a phone on `current` should switch to, or null. Only same-fingerprint releases fit the
 * installed shell. If the running release was withdrawn, fall back to the newest older one with the
 * same data schema.
 */
export function pickRelease(
  index: IndexEntry[],
  q: { fingerprint: string; current: string }
): IndexEntry | null {
  const candidates = index.filter((x) => x.fingerprint === q.fingerprint && !x.withdrawn)
  const top = newest(candidates)
  if (top && isNewer(top.version, q.current)) return top
  const cur = index.find((x) => x.fingerprint === q.fingerprint && x.version === q.current)
  if (!cur?.withdrawn) return null
  return newest(candidates.filter((x) => isNewer(q.current, x.version) && x.schema === cur.schema))
}

/** The newest app (APK) build that this shell can't take as a live update, or null. */
export function pickShellUpdate(
  index: IndexEntry[],
  q: { fingerprint: string; builtin: string }
): { version: string; url: string } | null {
  const top = newest(
    index.filter(
      (x) => x.apkUrl && !x.withdrawn && x.fingerprint !== q.fingerprint && isNewer(x.version, q.builtin)
    )
  )
  return top && top.apkUrl ? { version: top.version, url: top.apkUrl } : null
}
