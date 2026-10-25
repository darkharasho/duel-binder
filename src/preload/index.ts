import { contextBridge, ipcRenderer } from 'electron'
import {
  ACCOUNT_CHANGED,
  DATA_CHANGED,
  INVOKE_CHANNELS,
  SYNC_PROGRESS,
  UPDATE_STATUS,
  WINDOW_MAXIMIZED,
  type Api
} from '../shared/ipc'
import type { AccountStatus, SyncStatus, UpdateStatus } from '../shared/types'

const invoke =
  (channel: string) =>
  (...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (s: T) => void): () => void {
  const listener = (_e: unknown, s: T): void => cb(s)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Record<string, Record<string, unknown>> = {}
for (const channel of INVOKE_CHANNELS) {
  const [ns, method] = channel.split(':')
  ;(api[ns] ??= {})[method] = invoke(channel)
}
api.sync.onProgress = (cb: (s: SyncStatus) => void) => subscribe(SYNC_PROGRESS, cb)
api.app.onUpdateStatus = (cb: (s: UpdateStatus) => void) => subscribe(UPDATE_STATUS, cb)
api.app.onDataChanged = (cb: () => void) => subscribe<void>(DATA_CHANGED, () => cb())
api.account.onChange = (cb: (s: AccountStatus) => void) => subscribe(ACCOUNT_CHANGED, cb)
api.window.platform = process.platform
api.window.onMaximizedChange = (cb: (maximized: boolean) => void) => subscribe(WINDOW_MAXIMIZED, cb)

contextBridge.exposeInMainWorld('api', api as unknown as Api)
