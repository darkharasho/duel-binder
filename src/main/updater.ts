import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

export const RELEASES_URL = 'https://github.com/darkharasho/duel-binder/releases'
export const CHECK_INTERVAL_MS = 60 * 60 * 1000
/** How long Restart waits to hear whether a newer release came out since the download. */
export const RESTART_CHECK_MS = 8000

/** True when `a` is a later x.y.z than `b`; prerelease tags are ignored. */
export function isNewer(a: string, b: string | null): boolean {
  if (!b) return true
  const parts = (v: string): number[] =>
    v
      .split('-')[0]
      .split('.')
      .map((n) => Number(n) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** Unsigned macOS builds cannot self-update, so they only point at the release page. */
export function updateMode(platform: NodeJS.Platform, macSigned: boolean): 'auto' | 'notify' {
  return platform === 'darwin' && !macSigned ? 'notify' : 'auto'
}

export interface UpdaterDeps {
  autoUpdater: AppUpdater
  mode: 'auto' | 'notify'
  emit: (s: UpdateStatus) => void
  openExternal: (url: string) => Promise<void>
  enabled: boolean
}

export interface Updater {
  status(): UpdateStatus
  check(): Promise<UpdateStatus>
  apply(): Promise<void>
  start(): void
  stop(): void
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { autoUpdater, mode, emit, openExternal, enabled } = deps
  let current: UpdateStatus = { state: 'idle', mode, version: null, error: null }
  let timer: ReturnType<typeof setInterval> | null = null
  // A check made while an update waits for a restart: its events would clobber "ready".
  let quiet = false
  // Restart was clicked while a newer release downloads: install that one when it lands.
  let installWhenReady = false

  const set = (patch: Partial<UpdateStatus> & Pick<UpdateStatus, 'state'>): void => {
    current = { ...current, error: null, ...patch }
    emit(current)
  }
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  if (enabled) {
    autoUpdater.autoDownload = mode === 'auto'
    // Installing on a user-initiated quit is fine; we never restart on our own.
    autoUpdater.autoInstallOnAppQuit = mode === 'auto'
    autoUpdater.on('checking-for-update', () => quiet || set({ state: 'checking' }))
    autoUpdater.on(
      'update-available',
      (info: { version: string }) => quiet || set({ state: 'available', version: info.version })
    )
    autoUpdater.on('update-not-available', () => quiet || set({ state: 'none', version: null }))
    autoUpdater.on('download-progress', () => set({ state: 'downloading' }))
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      set({ state: 'ready', version: info.version })
      if (installWhenReady) {
        installWhenReady = false
        autoUpdater.quitAndInstall()
      }
    })
    autoUpdater.on('error', (e: Error) => {
      if (quiet) return
      installWhenReady = false
      set({ state: 'error', error: message(e) })
    })
  }

  /**
   * With an update downloaded, look again: when a later release is out, fetch that one instead,
   * so two releases close together install once, not twice. True when a newer download started.
   */
  async function recheckReady(installAfter = false): Promise<boolean> {
    if (quiet) return false
    const waiting = current.version
    quiet = true
    autoUpdater.autoDownload = false
    let latest: string | null = null
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result?.isUpdateAvailable) latest = result.updateInfo.version
    } catch {
      // Offline or the feed failed: the downloaded update still stands.
    } finally {
      autoUpdater.autoDownload = true
      quiet = false
    }
    if (current.state !== 'ready' || !latest || !isNewer(latest, waiting)) return false
    installWhenReady = installAfter
    set({ state: 'available', version: latest })
    autoUpdater.downloadUpdate().catch((e: unknown) => {
      installWhenReady = false
      set({ state: 'error', error: message(e) })
    })
    return true
  }

  async function check(): Promise<UpdateStatus> {
    if (!enabled) return { state: 'none', mode, version: null, error: null }
    // Do not clobber an update that is already being fetched.
    if (current.state === 'downloading') return current
    if (current.state === 'ready') {
      if (mode === 'auto') await recheckReady()
      return current
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      set({ state: 'error', error: message(e) })
    }
    return current
  }

  async function apply(): Promise<void> {
    try {
      if (mode === 'auto') {
        if (current.state !== 'ready') return
        const timeout = new Promise<false>((r) => setTimeout(() => r(false), RESTART_CHECK_MS))
        const newer = await Promise.race([recheckReady(true), timeout])
        if (!newer && current.state === 'ready') autoUpdater.quitAndInstall()
      } else if (current.version) {
        await openExternal(`${RELEASES_URL}/tag/v${encodeURIComponent(current.version)}`)
      }
    } catch (e) {
      set({ state: 'error', error: message(e) })
    }
  }

  return {
    status: () => current,
    check,
    apply,
    start() {
      if (!enabled || timer) return
      void check()
      timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
