import { ANDROID_CHANNEL, APP_PLATFORM, PORTAL_ORIGIN, isNativeApp } from '@/lib/portal'
import {
  signedMessage,
  type AppUpdateAnswer,
  type BundleTarget,
  type ManifestEntry
} from '../shared/appBundles'
import { LIVE_UPDATE_PUBLIC_KEY } from './liveUpdateKey'
import { SHELL_UPDATE_KEY } from './updateCheck'

/** The part of the updater plugin (`CapacitorUpdater`) that live updates use. */
export interface Updater {
  getBuiltinVersion(): Promise<{ version: string }>
  download(o: {
    url: string
    version: string
    manifest: ManifestEntry[]
  }): Promise<{ id: string; version: string }>
  next(o: { id: string }): Promise<unknown>
  set(o: { id: string }): Promise<void>
  delete(o: { id: string }): Promise<void>
  /** Needs `allowManualBundleError`; an errored bundle never launches and can be deleted. */
  setBundleError(o: { id: string }): Promise<unknown>
  /** The running bundle (`id` is 'builtin' for the one inside the app). */
  current(): Promise<{ bundle: { id: string; version: string } }>
  list(): Promise<{ bundles: { id: string; version: string; status: string }[] }>
  /** The bundle the plugin last rolled back, once; null after that. */
  getFailedUpdate(): Promise<{ bundle: { id?: string; version: string } } | null>
  addListener(
    e: 'updateFailed',
    cb: (info: { bundle: { version: string } }) => void
  ): Promise<unknown>
}

export interface LiveUpdate {
  /** Ask the portal for an update and stage it for the next launch. Never throws. */
  check(): Promise<void>
  /**
   * The downloaded bundle that will run on the next launch, if any. Always null until `ready()`
   * resolves, so nothing switches on a stale entry.
   */
  pending(): { id: string; version: string } | null
  /** Resolves once the stored pending entry has been checked against the plugin. Never rejects. */
  ready(): Promise<void>
  /** Switch to the pending bundle now (reloads the page). */
  applyNow(): Promise<void>
  dispose(): void
}

export interface LiveUpdateDeps {
  updater: Updater
  fetch: typeof fetch
  storage: Storage
  now: () => number
  target: BundleTarget
  current: string
  publicKey: JsonWebKey
  on(event: 'visible', cb: () => void): () => void
}

const KEY = 'duelbinder.liveUpdate'
export const CHECKED_AT_KEY = `${KEY}.checkedAt`
export const FAILED_KEY = `${KEY}.failed`
export const PENDING_KEY = `${KEY}.pending`
/** The version whose "Updated to X" note has been shown (written by the home switch). */
export const SHOWN_KEY = `${KEY}.shown`
export { SHELL_UPDATE_KEY }

/**
 * A placeholder: the plugin's manifest download never fetches it, but iOS `downloadBundle` first does
 * `guard let url = URL(string: urlString)`, which throws on an empty string. Our own 404 sink keeps
 * it valid and, if it were ever fetched, unable to reach anyone else.
 */
export const DOWNLOAD_PLACEHOLDER_URL = `${PORTAL_ORIGIN}/api/app-update/none`

const CHECK_INTERVAL_MS = 10 * 60 * 1000

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function verifies(
  publicKey: JsonWebKey,
  target: BundleTarget,
  version: string,
  manifest: ManifestEntry[],
  signature: string
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'jwk',
    publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  const message = signedMessage(target, version, manifest)
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64Url(signature),
    message as Uint8Array<ArrayBuffer>
  )
}

type Pending = { id: string; version: string }

/** Bundle states that can never launch: a pending entry naming one is stale. */
const DEAD = new Set(['error', 'deleted', 'deleting'])

export function createLiveUpdate(deps: LiveUpdateDeps): LiveUpdate {
  const { updater, storage } = deps
  let running: Promise<void> | null = null
  let reconciled = false

  const failed = (): string[] => readJson<string[]>(storage, FAILED_KEY) ?? []
  const stored = (): Pending | null => readJson<Pending>(storage, PENDING_KEY)
  const pending = (): Pending | null => (reconciled ? stored() : null)

  const markFailed = (bundle: { id?: string; version: string }): void => {
    const v = bundle.version
    const list = failed()
    if (!list.includes(v)) storage.setItem(FAILED_KEY, JSON.stringify([...list, v]))
    const p = stored()
    if (p && (p.version === v || (bundle.id !== undefined && p.id === bundle.id)))
      storage.removeItem(PENDING_KEY)
  }

  // The plugin rolled a bundle back: never offer that version again. A bundle that fails before its
  // JS runs never hears this event; start-up reconciliation catches that case.
  updater.addListener('updateFailed', (info) => markFailed(info.bundle)).catch(() => undefined)

  /**
   * Make the stored pending entry agree with the plugin before anything acts on it: a bundle that
   * is already running (after a switch), was rolled back, or is gone from disk (rollback cleanup, a
   * store update with resetWhenUpdate) is not pending.
   */
  async function reconcile(): Promise<void> {
    const rolledBack = await updater.getFailedUpdate().catch(() => null)
    if (rolledBack?.bundle) markFailed(rolledBack.bundle)
    const p = stored()
    if (!p) return
    const cur = await updater
      .current()
      .then((r) => r.bundle)
      .catch(() => null)
    if (p.version === deps.current || (cur && (p.id === cur.id || p.version === cur.version))) {
      storage.removeItem(PENDING_KEY)
      return
    }
    const bundles = await updater
      .list()
      .then((r) => r.bundles)
      .catch(() => null)
    if (!bundles) return
    const b = bundles.find((x) => x.id === p.id)
    if (!b || DEAD.has(b.status)) storage.removeItem(PENDING_KEY)
  }

  const ready = reconcile()
    .catch(() => undefined)
    .then(() => {
      reconciled = true
    })

  /**
   * Stop a staged bundle from launching and drop it. `next` goes back to the running bundle (iOS);
   * Android ignores that when the running bundle is healthy, so the staged one is also marked as
   * errored, which no launch takes and which `delete` then accepts. All best-effort.
   */
  async function unstage(p: Pending): Promise<void> {
    storage.removeItem(PENDING_KEY)
    const cur = await updater
      .current()
      .then((r) => r.bundle.id)
      .catch(() => null)
    // Without knowing what runs, touch nothing: it could be this very bundle.
    if (cur === null || cur === p.id) return
    await updater.next({ id: cur }).catch(() => undefined)
    await updater.setBundleError({ id: p.id }).catch(() => undefined)
    await updater.delete({ id: p.id }).catch(() => undefined)
  }

  async function run(): Promise<void> {
    await ready
    const last = Number(storage.getItem(CHECKED_AT_KEY) ?? 0)
    if (deps.now() - last < CHECK_INTERVAL_MS) return
    storage.setItem(CHECKED_AT_KEY, String(deps.now()))

    const { version: builtin } = await updater.getBuiltinVersion()
    const q = new URLSearchParams({ target: deps.target, builtin, current: deps.current })
    const res = await deps.fetch(`${PORTAL_ORIGIN}/api/app-update?${q}`)
    if (!res.ok) return
    const answer = (await res.json()) as AppUpdateAnswer

    const before = storage.getItem(SHELL_UPDATE_KEY)
    if (answer.shellUpdate) storage.setItem(SHELL_UPDATE_KEY, JSON.stringify(answer.shellUpdate))
    else storage.removeItem(SHELL_UPDATE_KEY)
    // Tell the APK banner, but only when the answer changed.
    if (storage.getItem(SHELL_UPDATE_KEY) !== before && typeof window !== 'undefined')
      window.dispatchEvent(new Event('duelbinder:shell-update'))

    // The portal no longer offers what is staged (withdrawn, or replaced): don't launch it.
    // A malformed answer (say `{}` from a proxy) says nothing, so it changes nothing.
    if (answer.version !== null && typeof answer.version !== 'string') return
    const staged = stored()
    if (staged && answer.version !== staged.version) await unstage(staged)

    if (answer.version === null) return
    const { version, manifest, signature } = answer
    if (failed().includes(version) || stored()?.version === version) return
    if (!(await verifies(deps.publicKey, deps.target, version, manifest, signature))) return

    const bundle = await updater.download({ url: DOWNLOAD_PLACEHOLDER_URL, version, manifest })
    try {
      await updater.next({ id: bundle.id })
    } catch (err) {
      await updater.delete({ id: bundle.id }).catch(() => undefined)
      throw err
    }
    storage.setItem(PENDING_KEY, JSON.stringify({ id: bundle.id, version: bundle.version }))
    // Tell a Home visit already under way, which decided earlier that nothing was pending.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('duelbinder:live-pending'))
  }

  function check(): Promise<void> {
    running ??= run()
      .catch(() => undefined)
      .finally(() => {
        running = null
      })
    return running
  }

  const offVisible = deps.on('visible', () => void check())

  return {
    check,
    pending,
    ready: () => ready,
    async applyNow() {
      const p = pending()
      // Reject, so a Home switch already fading undoes its fade instead of staying black.
      if (!p) throw new Error('No live update is pending')
      try {
        await updater.set({ id: p.id })
      } catch (err) {
        // The bundle can't be switched to (deleted, broken): stop offering it, or Home retries forever.
        await unstage(p)
        throw err
      }
    },
    dispose: offVisible
  }
}

/** The release stream this app build follows, or null in a browser. */
export function bundleTarget(): BundleTarget | null {
  if (APP_PLATFORM === 'ios') return 'ios'
  if (APP_PLATFORM === 'android') return ANDROID_CHANNEL === 'play' ? 'android-play' : 'android-apk'
  return null
}

let started: LiveUpdate | null = null

/** Start live updates for this app (native builds only); the instance the home switch uses. */
export function startLiveUpdate(): LiveUpdate | null {
  if (started) return started
  const target = bundleTarget()
  if (!target || !isNativeApp() || typeof __APP_VERSION__ !== 'string') return null
  // The plugin is loaded lazily, so hand createLiveUpdate a forwarding Updater.
  const plugin = import('@capgo/capacitor-updater').then((m) => m.CapacitorUpdater)
  const updater: Updater = {
    getBuiltinVersion: async () => (await plugin).getBuiltinVersion(),
    download: async (o) => (await plugin).download(o),
    next: async (o) => (await plugin).next(o),
    set: async (o) => (await plugin).set(o),
    delete: async (o) => (await plugin).delete(o),
    setBundleError: async (o) => (await plugin).setBundleError(o),
    current: async () => (await plugin).current(),
    list: async () => (await plugin).list(),
    getFailedUpdate: async () => (await plugin).getFailedUpdate(),
    addListener: async (e, cb) => (await plugin).addListener(e, cb)
  }
  const live = createLiveUpdate({
    updater,
    fetch: (input, init) => fetch(input, init),
    storage: localStorage,
    now: () => Date.now(),
    target,
    current: __APP_VERSION__,
    publicKey: LIVE_UPDATE_PUBLIC_KEY,
    on: (_e, cb) => {
      const h = (): void => {
        if (document.visibilityState === 'visible') cb()
      }
      document.addEventListener('visibilitychange', h)
      return () => document.removeEventListener('visibilitychange', h)
    }
  })
  started = live
  void live.check()
  return live
}
