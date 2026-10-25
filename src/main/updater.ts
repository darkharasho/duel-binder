import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

export const RELEASES_URL = 'https://github.com/darkharasho/duel-binder/releases'
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

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

  const set = (patch: Partial<UpdateStatus> & Pick<UpdateStatus, 'state'>): void => {
    current = { ...current, error: null, ...patch }
    emit(current)
  }
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  if (enabled) {
    autoUpdater.autoDownload = mode === 'auto'
    // Installing on a user-initiated quit is fine; we never restart on our own.
    autoUpdater.autoInstallOnAppQuit = mode === 'auto'
    autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
    autoUpdater.on('update-available', (info: { version: string }) =>
      set({ state: 'available', version: info.version })
    )
    autoUpdater.on('update-not-available', () => set({ state: 'none', version: null }))
    autoUpdater.on('download-progress', () => set({ state: 'downloading' }))
    autoUpdater.on('update-downloaded', (info: { version: string }) =>
      set({ state: 'ready', version: info.version })
    )
    autoUpdater.on('error', (e: Error) => set({ state: 'error', error: message(e) }))
  }

  async function check(): Promise<UpdateStatus> {
    if (!enabled) return { state: 'none', mode, version: null, error: null }
    // Do not clobber an update that is already being fetched or waiting for a restart.
    if (current.state === 'downloading' || current.state === 'ready') return current
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
        if (current.state === 'ready') autoUpdater.quitAndInstall()
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
