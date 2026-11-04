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
  /**
   * Upload only, and only on `put`: storage keeps the bytes apart from the item, so `all()` never
   * returns them (read one with `jpeg(key)`). An ArrayBuffer, not a Blob: older WebKit loses Blobs
   * in IndexedDB.
   */
  jpeg?: ArrayBuffer
  /** Upload only: sends started. Above 0, the server may already hold the photo. */
  attempts?: number
  queuedAt: string
}

export interface OutboxStorage {
  /** Every item, without its JPEG. */
  all(): Promise<OutboxItem[]>
  /** Writes the item; its JPEG too when it has one, else any stored JPEG stays as it is. */
  put(item: OutboxItem): Promise<void>
  /** One item's JPEG, or null. */
  jpeg(key: string): Promise<ArrayBuffer | null>
  /** Removes the item and its JPEG together. */
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
  /**
   * Sends this account's items, oldest first, until one says to retry later. A drain asked for
   * while one runs joins it, and the run goes round once more (unless it stopped on the daily cap
   * or a sign-out), so a trigger during a hung send isn't lost.
   */
  drain(userId: number, send: Sender): Promise<DrainResult>
  onChange(cb: () => void): () => void
}

const withoutJpeg = (i: OutboxItem): OutboxItem => {
  const meta = { ...i }
  delete meta.jpeg
  return meta
}

/** An outbox storage in memory, for tests. */
export function memoryOutboxStorage(): OutboxStorage {
  const items = new Map<string, OutboxItem>()
  const jpegs = new Map<string, ArrayBuffer>()
  return {
    all: async () => [...items.values()].map((i) => ({ ...i })),
    put: async (i) => {
      items.set(i.key, withoutJpeg(i))
      if (i.jpeg) jpegs.set(i.key, i.jpeg)
    },
    jpeg: async (key) => jpegs.get(key) ?? null,
    remove: async (key) => {
      items.delete(key)
      jpegs.delete(key)
    }
  }
}

const ITEMS = 'items'
const JPEGS = 'jpegs'
/** 2: the JPEGs moved to their own store, so reading the queue never loads them. */
const DB_VERSION = 2

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
 * The outbox on IndexedDB: object store 'items' (keyed by `key`) for the queue, and 'jpegs' (same
 * key) for the photos, so reading the queue never loads a photo. The database is opened on first
 * use, and only a write creates it, so a phone that never takes a training photo never gets one.
 */
export function idbOutboxStorage(dbName = 'duel-binder-training'): OutboxStorage {
  let db: IDBDatabase | null = null

  /** Opens the database; null when it doesn't exist yet and `create` is false. */
  const request = (create: boolean): Promise<IDBDatabase | null> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION)
      let declined = false
      req.onupgradeneeded = (e) => {
        if (!create && e.oldVersion === 0) {
          // Aborting the version change leaves no database behind.
          declined = true
          req.transaction?.abort()
          return
        }
        const d = req.result
        // Version 1's single store never shipped in a release: nothing to carry over.
        if (d.objectStoreNames.contains('outbox')) d.deleteObjectStore('outbox')
        if (!d.objectStoreNames.contains(ITEMS)) d.createObjectStore(ITEMS, { keyPath: 'key' })
        if (!d.objectStoreNames.contains(JPEGS)) d.createObjectStore(JPEGS)
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
    const forget = (): void => {
      if (db === opened) db = null
    }
    opened.onversionchange = () => {
      opened.close()
      forget()
    }
    // WebKit can drop the connection (say, after the app was in the background): open again.
    opened.onclose = forget
    return opened
  }

  return {
    all: async () => {
      const d = await open(false)
      if (!d) return []
      const items = d.transaction(ITEMS, 'readonly').objectStore(ITEMS).getAll()
      return done(items as IDBRequest<OutboxItem[]>)
    },
    put: async (item) => {
      const d = await open(true)
      if (!d) throw new Error('The training outbox could not be opened')
      const tx = d.transaction(item.jpeg ? [ITEMS, JPEGS] : [ITEMS], 'readwrite')
      tx.objectStore(ITEMS).put(withoutJpeg(item))
      if (item.jpeg) tx.objectStore(JPEGS).put(item.jpeg, item.key)
      await committed(tx)
    },
    jpeg: async (key) => {
      const d = await open(false)
      if (!d) return null
      const got = d.transaction(JPEGS, 'readonly').objectStore(JPEGS).get(key)
      return ((await done(got)) as ArrayBuffer | undefined) ?? null
    },
    remove: async (key) => {
      const d = await open(false)
      if (!d) return
      const tx = d.transaction([ITEMS, JPEGS], 'readwrite')
      tx.objectStore(ITEMS).delete(key)
      tx.objectStore(JPEGS).delete(key)
      await committed(tx)
    }
  }
}

const uploadKey = (id: string): string => `upload:${id}`
const deleteKey = (id: string): string => `delete:${id}`

type Claim = { item: OutboxItem; jpeg: ArrayBuffer | null }

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
  /** Accounts whose running drain was asked for again: it goes round once more. */
  const again = new Set<number>()

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

  /**
   * This account's oldest item, marked as sending; for an upload, with one more attempt stored
   * (the item only, never the photo) and its JPEG, the one photo read.
   */
  const claimNext = (userId: number): Promise<Claim | null> =>
    locked(async () => {
      const [next] = await mine(userId)
      if (!next) return null
      if (next.kind === 'delete') {
        inFlight.add(next.id)
        return { item: next, jpeg: null }
      }
      const claimed = { ...next, attempts: (next.attempts ?? 0) + 1 }
      await storage.put(claimed)
      inFlight.add(next.id)
      return { item: claimed, jpeg: await storage.jpeg(next.key) }
    })

  async function runOnce(userId: number, send: Sender): Promise<DrainResult> {
    const result: DrainResult = { sent: 0, dropped: [], stopped: null, summary: null }
    for (;;) {
      const claim = await claimNext(userId)
      if (!claim) return result
      const { item, jpeg } = claim
      let answer: Awaited<ReturnType<Sender['upload']>>
      try {
        if (item.kind === 'delete') answer = await send.remove(item.id)
        else if (jpeg && item.label) answer = await send.upload(item.id, item.label, jpeg)
        else answer = { ok: false, retry: false, reason: 'rejected' }
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

  async function run(userId: number, send: Sender): Promise<DrainResult> {
    const total: DrainResult = { sent: 0, dropped: [], stopped: null, summary: null }
    for (;;) {
      again.delete(userId)
      const r = await runOnce(userId, send)
      total.sent += r.sent
      total.dropped.push(...r.dropped)
      total.stopped = r.stopped
      if (r.summary) total.summary = r.summary
      if (!again.has(userId) || r.stopped === 'daily-cap' || r.stopped === 'signed-out')
        return total
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
        if (upload && !(upload.attempts ?? 0) && !inFlight.has(id)) {
          await storage.remove(upload.key)
          return 'dropped' as const
        }
        // DELETE is idempotent: queued whenever the server may hold the photo. Queued before the
        // upload goes, so a crash between the two leaves a re-upload and then its delete.
        await storage.put({
          key: deleteKey(id),
          id,
          userId,
          kind: 'delete',
          queuedAt: now().toISOString()
        })
        if (upload) await storage.remove(upload.key)
        return 'queued' as const
      })
      changed()
      return outcome
    },

    waiting: async (userId) =>
      (await storage.all()).filter((i) => i.userId === userId && i.kind === 'upload').length,

    drain: (userId, send) => {
      const running = runs.get(userId)
      if (running) {
        again.add(userId)
        return running
      }
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
