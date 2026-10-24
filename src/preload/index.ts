import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_CHANNELS, SYNC_PROGRESS, UPDATE_STATUS, type Api } from '../shared/ipc'
import type { SyncStatus, UpdateStatus } from '../shared/types'

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

contextBridge.exposeInMainWorld('api', api as unknown as Api)
