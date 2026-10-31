import { CloudAuthError, CloudOfflineError } from '../../main/cloud/client'
import type { PhoneStore } from './store'

/** The part of a MessagePort (or a worker's global scope, or a Worker) the protocol uses. */
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  /** A MessagePort only delivers messages to addEventListener once started. */
  start?(): void
}

/** Every method of PhoneStore, so the client side can be built without a Proxy. */
export const STORE_METHODS = [
  'account',
  'signIn',
  'signOut',
  'deleteAccount',
  'catalog',
  'fillCatalog',
  'updateCatalog',
  'sync',
  'syncState',
  'syncProblems',
  'invoke',
  'portal',
  'portalRead',
  'requestPrices',
  'reportUsage',
  'fingerprints',
  'fingerprintRefs',
  'fingerprintStatus',
  'refreshFingerprints'
] as const satisfies readonly (keyof PhoneStore)[]

type StoreMethod = (typeof STORE_METHODS)[number]
// Compile-time check: a method added to PhoneStore must be listed above.
const everyMethodListed: [Exclude<keyof PhoneStore, StoreMethod>] extends [never] ? true : never =
  true
void everyMethodListed

export interface StoreRequest {
  id: number
  method: StoreMethod
  args: unknown[]
}

export type StoreReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { name: string; message: string } }
  /** A fillCatalog progress callback. */
  | { id: number; progress: { cursor: number; latest: number } }

/** Posted by the worker when the database can't be opened; every call fails with it. */
export interface StoreFatal {
  fatal: string
}

const isMethod = (m: unknown): m is StoreMethod =>
  typeof m === 'string' && (STORE_METHODS as readonly string[]).includes(m)

/** Answers StoreRequests arriving on port with store's methods (the worker side). */
export function exposeStore(store: PhoneStore, port: MessagePortLike): void {
  const reply = (r: StoreReply, transfer: Transferable[] = []): void =>
    port.postMessage(r, transfer)

  port.addEventListener('message', (e: MessageEvent) => {
    const req = e.data as Partial<StoreRequest> | null
    if (!req || typeof req.id !== 'number') return
    const { id } = req
    const args = Array.isArray(req.args) ? req.args : []
    void (async () => {
      try {
        if (!isMethod(req.method)) throw new Error(`Unknown store method: ${String(req.method)}`)
        const value =
          req.method === 'fillCatalog'
            ? await store.fillCatalog((progress) => reply({ id, progress }))
            : await (store[req.method] as (...a: unknown[]) => Promise<unknown>)(...args)
        reply({ id, ok: true, value }, value instanceof ArrayBuffer ? [value] : [])
      } catch (err) {
        const { name, message } =
          err instanceof Error ? err : { name: 'Error', message: String(err) }
        reply({ id, ok: false, error: { name, message } })
      }
    })()
  })
  port.start?.()
}

/** Rebuilds an error sent across the port, as the cloud's own class where it is one. */
function revive({ name, message }: { name: string; message: string }): Error {
  if (name === 'CloudAuthError') return new CloudAuthError(message)
  if (name === 'CloudOfflineError') return new CloudOfflineError(message)
  const e = new Error(message)
  e.name = name
  return e
}

interface Pending {
  resolve(value: unknown): void
  reject(err: Error): void
  onProgress?: (p: { cursor: number; latest: number }) => void
}

/** A PhoneStore whose calls go over port to an exposeStore on the other end (the page side). */
export function connectStore(port: MessagePortLike): PhoneStore {
  let nextId = 1
  const pending = new Map<number, Pending>()
  let fatal: Error | null = null

  port.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as StoreReply | StoreFatal | null
    if (!msg) return
    if ('fatal' in msg) {
      fatal = new Error(msg.fatal)
      for (const p of pending.values()) p.reject(fatal)
      pending.clear()
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    if ('progress' in msg) {
      p.onProgress?.(msg.progress)
      return
    }
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.value)
    else p.reject(revive(msg.error))
  })
  port.start?.()

  const call = (
    method: StoreMethod,
    args: unknown[],
    onProgress?: Pending['onProgress']
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (fatal) return reject(fatal)
      const id = nextId++
      pending.set(id, { resolve, reject, onProgress })
      const req: StoreRequest = { id, method, args }
      port.postMessage(req)
    })

  const client = {} as Record<StoreMethod, (...a: unknown[]) => Promise<unknown>>
  for (const method of STORE_METHODS)
    client[method] =
      method === 'fillCatalog'
        ? (onProgress) => call(method, [], onProgress as Pending['onProgress'])
        : (...args) => call(method, args)
  return client as unknown as PhoneStore
}
