import type { Api } from '../shared/ipc'
import type { Ocr } from '../shared/scan/ocr'
import { createPhoneApi, createPhoneEvents, type PhoneEvents } from './api'
import { connectStore, type MessagePortLike, type StoreFatal } from './data/protocol'
import type { PhoneStore } from './data/store'
import { createSyncTriggers } from './syncTriggers'

/** The part of the data Worker the runtime uses: its messages, and `error` if its script fails. */
export interface WorkerLike extends MessagePortLike {
  addEventListener(type: 'message' | 'error', listener: (e: MessageEvent) => void): void
}

export interface PhoneRuntime {
  store: PhoneStore
  /** The phone's `window.api`. */
  api: Api
  events: PhoneEvents
  /**
   * Calls cb once the data worker can't run (it posted `{ fatal }`, or its script failed to load);
   * at once if that already happened. Returns an unsubscribe.
   */
  onFatal(cb: (message: string) => void): () => void
  dispose(): void
}

const WORKER_FAILED = "The app's data worker didn't start"

/**
 * Everything the phone page runs on, given its data worker: the store over the worker, the phone
 * Api over the store, and the sync triggers (after edits, on coming online or into view, and every
 * few minutes). The worker's fatal message is listened for before anything is posted to it, so
 * it can't be missed.
 */
export function createPhoneRuntime(deps: {
  worker: WorkerLike
  ocr: Ocr
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
}): PhoneRuntime {
  const win = deps.win ?? window
  const doc = deps.doc ?? document

  let fatal: string | null = null
  const fatalListeners = new Set<(message: string) => void>()
  const fail = (message: string): void => {
    if (fatal !== null) return
    fatal = message
    for (const cb of [...fatalListeners]) cb(message)
  }
  deps.worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as Partial<StoreFatal> | null
    if (msg && typeof msg.fatal === 'string') fail(msg.fatal)
  })
  deps.worker.addEventListener('error', () => fail(WORKER_FAILED))

  const store = connectStore(deps.worker)
  const events = createPhoneEvents()

  const api = createPhoneApi({
    store,
    ocr: deps.ocr,
    triggers: {
      afterAdd: () => triggers.afterAdd(),
      afterPriceRequest: () => triggers.afterPriceRequest()
    },
    events
  })
  const triggers = createSyncTriggers({
    sync: () => api.account.syncNow(),
    online: () => navigator.onLine,
    visible: () => doc.visibilityState === 'visible',
    on: (event, cb) => {
      if (event === 'online') {
        win.addEventListener('online', cb)
        return () => win.removeEventListener('online', cb)
      }
      const onVisibility = (): void => {
        if (doc.visibilityState === 'visible') cb()
      }
      doc.addEventListener('visibilitychange', onVisibility)
      return () => doc.removeEventListener('visibilitychange', onVisibility)
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t)
  })

  return {
    store,
    api,
    events,
    onFatal(cb) {
      if (fatal !== null) cb(fatal)
      else fatalListeners.add(cb)
      return () => {
        fatalListeners.delete(cb)
      }
    },
    dispose() {
      triggers.dispose()
      fatalListeners.clear()
    }
  }
}
