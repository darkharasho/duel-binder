import type { PhoneStore } from '../data/store'
import type { TrainingLabel, TrainingSummary } from '../../shared/training'

/** A training photo waiting to go up, or a server delete waiting to be sent. */
export interface OutboxItem {
  /** `${kind}:${id}` */
  key: string
  /** The photo's client id (a UUID). */
  id: string
  userId: number
  kind: 'upload' | 'delete'
  /** Upload only. */
  label?: TrainingLabel
  /** Upload only. An ArrayBuffer, not a Blob: older WebKit loses Blobs in IndexedDB. */
  jpeg?: ArrayBuffer
  /** Upload only: sends started. Above 0, the server may already hold the photo. */
  attempts?: number
  queuedAt: string
}

export interface OutboxStorage {
  all(): Promise<OutboxItem[]>
  put(item: OutboxItem): Promise<void>
  remove(key: string): Promise<void>
}

export interface Sender {
  upload: PhoneStore['trainingUpload']
  remove: PhoneStore['trainingDelete']
}

export type DrainResult = {
  sent: number
  dropped: { id: string; reason: string }[]
  stopped: null | 'offline' | 'signed-out' | 'daily-cap'
  summary: TrainingSummary | null
}

export interface Outbox {
  addUpload(userId: number, id: string, label: TrainingLabel, jpeg: ArrayBuffer): Promise<void>
  /** Drops a queued upload never sent ('dropped'); else removes any upload item and queues a server delete ('queued'). */
  forget(userId: number, id: string): Promise<'dropped' | 'queued'>
  /** This account's queued uploads. */
  waiting(userId: number): Promise<number>
  /** Sends this account's items, oldest first, until one says to retry later. */
  drain(userId: number, send: Sender): Promise<DrainResult>
  onChange(cb: () => void): () => void
}

/** An outbox storage in memory, for tests. */
export function memoryOutboxStorage(): OutboxStorage {
  const items = new Map<string, OutboxItem>()
  return {
    all: async () => [...items.values()].map((i) => ({ ...i })),
    put: async (i) => {
      items.set(i.key, { ...i })
    },
    remove: async (key) => {
      items.delete(key)
    }
  }
}

const STORE = 'outbox'

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

/**
 * The outbox on IndexedDB: object store 'outbox', keyed by `key`. The database is opened on first
 * use, and only a write creates it, so a phone that never takes a training photo never gets one.
 */
export function idbOutboxStorage(dbName = 'duel-binder-training'): OutboxStorage {
  let db: IDBDatabase | null = null

  /** Opens the database; null when it doesn't exist yet and `create` is false. */
  const request = (create: boolean): Promise<IDBDatabase | null> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      let declined = false
      req.onupgradeneeded = (e) => {
        if (!create && e.oldVersion === 0) {
          // Aborting the version change leaves no database behind.
          declined = true
          req.transaction?.abort()
          return
        }
        req.result.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = (e) => {
        if (!declined) return reject(req.error)
        e.preventDefault()
        resolve(null)
      }
    })

  async function open(create: boolean): Promise<IDBDatabase | null> {
    if (db) return db
    const opened = await request(create)
    if (!opened) return null
    // Two first calls at once: keep one connection.
    if (db) {
      opened.close()
      return db
    }
    db = opened
    opened.onversionchange = () => {
      opened.close()
      if (db === opened) db = null
    }
    return opened
  }

  return {
    all: async () => {
      const d = await open(false)
      if (!d) return []
      const items = d.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      return done(items as IDBRequest<OutboxItem[]>)
    },
    put: async (item) => {
      const d = await open(true)
      if (!d) throw new Error('The training outbox could not be opened')
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(item)
      await committed(tx)
    },
    remove: async (key) => {
      const d = await open(false)
      if (!d) return
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      await committed(tx)
    }
  }
}

const uploadKey = (id: string): string => `upload:${id}`
const deleteKey = (id: string): string => `delete:${id}`

/**
 * Training photos waiting to go up, and deletes waiting to be sent, kept in `storage` so they
 * survive a reload or a day offline. One drain runs per account at a time.
 */
export function createOutbox(storage: OutboxStorage, now: () => Date): Outbox {
  const listeners = new Set<() => void>()
  const changed = (): void => {
    for (const cb of [...listeners]) cb()
  }
  /** Client ids being sent right now. */
  const inFlight = new Set<string>()
  const runs = new Map<number, Promise<DrainResult>>()

  // Every read-then-write of the storage runs in turn, so a forget never interleaves with a
  // drain claiming the same item.
  let lock: Promise<unknown> = Promise.resolve()
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn, fn)
    lock = run.catch(() => {})
    return run
  }

  const mine = async (userId: number): Promise<OutboxItem[]> =>
    (await storage.all())
      .filter((i) => i.userId === userId)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))

  /** This account's oldest item, marked as sending; for an upload, with one more attempt stored. */
  const claimNext = (userId: number): Promise<OutboxItem | null> =>
    locked(async () => {
      const [next] = await mine(userId)
      if (!next) return null
      inFlight.add(next.id)
      if (next.kind === 'upload') {
        const claimed = { ...next, attempts: (next.attempts ?? 0) + 1 }
        await storage.put(claimed)
        return claimed
      }
      return next
    })

  async function run(userId: number, send: Sender): Promise<DrainResult> {
    const result: DrainResult = { sent: 0, dropped: [], stopped: null, summary: null }
    for (;;) {
      const item = await claimNext(userId)
      if (!item) return result
      let answer: Awaited<ReturnType<Sender['upload']>>
      try {
        answer =
          item.kind === 'upload'
            ? await send.upload(item.id, item.label!, item.jpeg!)
            : await send.remove(item.id)
      } catch {
        answer = { ok: false, retry: true, reason: 'offline' }
      } finally {
        inFlight.delete(item.id)
      }
      if (!answer.ok && answer.retry) {
        result.stopped = answer.reason as Exclude<DrainResult['stopped'], null>
        return result
      }
      await locked(() => storage.remove(item.key))
      if (answer.ok) {
        result.sent++
        if (answer.summary) result.summary = answer.summary
      } else result.dropped.push({ id: item.id, reason: answer.reason })
      changed()
    }
  }

  return {
    addUpload: async (userId, id, label, jpeg) => {
      await locked(() =>
        storage.put({
          key: uploadKey(id),
          id,
          userId,
          kind: 'upload',
          label,
          jpeg,
          attempts: 0,
          queuedAt: now().toISOString()
        })
      )
      changed()
    },

    forget: async (userId, id) => {
      const outcome = await locked(async () => {
        const upload = (await storage.all()).find(
          (i) => i.key === uploadKey(id) && i.userId === userId
        )
        const neverSent = upload && !(upload.attempts ?? 0) && !inFlight.has(id)
        if (upload) await storage.remove(upload.key)
        if (neverSent) return 'dropped' as const
        // DELETE is idempotent: queued whenever the server may hold the photo.
        await storage.put({
          key: deleteKey(id),
          id,
          userId,
          kind: 'delete',
          queuedAt: now().toISOString()
        })
        return 'queued' as const
      })
      changed()
      return outcome
    },

    waiting: async (userId) =>
      (await storage.all()).filter((i) => i.userId === userId && i.kind === 'upload').length,

    drain: (userId, send) => {
      const running = runs.get(userId)
      if (running) return running
      const started = run(userId, send).finally(() => runs.delete(userId))
      runs.set(userId, started)
      return started
    },

    onChange: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}

let shared: Outbox | null = null

/** The app's one outbox, on IndexedDB, created on first call (tests never touch it). */
export function trainingOutbox(): Outbox {
  shared ??= createOutbox(idbOutboxStorage(), () => new Date())
  return shared
}
