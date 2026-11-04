import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { TrainingSend } from '../../src/phone/data/store'
import {
  createOutbox,
  idbOutboxStorage,
  memoryOutboxStorage,
  type OutboxItem,
  type Sender
} from '../../src/phone/training/outbox'
import type { TrainingLabel, TrainingSummary } from '../../src/shared/training'

const label = (cardId: number): TrainingLabel => ({
  game: 'op',
  cardId,
  printingId: cardId * 10,
  holder: 'bare',
  device: 'Pixel 8',
  appVersion: '0.54.0',
  takenAt: '2026-11-04T10:00:00.000Z'
})
const jpeg = (n = 1): ArrayBuffer => new Uint8Array([0xff, 0xd8, 0xff, n]).buffer
const SUMMARY: TrainingSummary = { total: 1, today: 1, dailyCap: 500 }
const OK: TrainingSend = { ok: true, summary: SUMMARY }
const DELETED: TrainingSend = { ok: true, summary: null }

/** A clock that moves on a second per call, so items queue in order. */
function clock(): () => Date {
  let t = Date.parse('2026-11-04T10:00:00.000Z')
  return () => new Date((t += 1000))
}

/** A sender that answers OK unless `answers` says otherwise for an id. */
function sender(
  answers: Record<string, TrainingSend | (() => Promise<TrainingSend>)> = {}
): Sender & {
  upload: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  const answer = async (id: string, fallback: TrainingSend): Promise<TrainingSend> => {
    const a = answers[id]
    if (a === undefined) return fallback
    return typeof a === 'function' ? a() : a
  }
  return {
    upload: vi.fn((id: string) => answer(id, OK)),
    remove: vi.fn((id: string) => answer(`delete:${id}`, DELETED))
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('training outbox', () => {
  it('drain uploads oldest first and empties', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg(1))
    await box.addUpload(1, 'b', label(2), jpeg(2))
    await box.addUpload(1, 'c', label(3), jpeg(3))
    expect(await box.waiting(1)).toBe(3)
    const send = sender()

    const r = await box.drain(1, send)

    expect(send.upload.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    expect(send.upload.mock.calls[1][1]).toEqual(label(2))
    expect([...new Uint8Array(send.upload.mock.calls[1][2] as ArrayBuffer)]).toEqual([
      0xff, 0xd8, 0xff, 2
    ])
    expect(r).toEqual({ sent: 3, dropped: [], stopped: null, summary: SUMMARY })
    expect(await box.waiting(1)).toBe(0)
  })

  it("drain sends only this account's items", async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    await box.addUpload(2, 'b', label(2), jpeg())
    const send = sender()

    expect(await box.drain(1, send)).toMatchObject({ sent: 1 })

    expect(send.upload.mock.calls.map((c) => c[0])).toEqual(['a'])
    expect(await box.waiting(1)).toBe(0)
    expect(await box.waiting(2)).toBe(1)
  })

  it('items survive a new outbox on the same storage', async () => {
    const storage = memoryOutboxStorage()
    await createOutbox(storage, clock()).addUpload(1, 'a', label(4), jpeg(4))
    const send = sender()

    await createOutbox(storage, clock()).drain(1, send)

    expect(send.upload).toHaveBeenCalledTimes(1)
    expect(send.upload.mock.calls[0][0]).toBe('a')
    expect(send.upload.mock.calls[0][1]).toEqual(label(4))
  })

  it('daily cap stops the drain and keeps the rest', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    for (const id of ['a', 'b', 'c']) await box.addUpload(1, id, label(1), jpeg())
    const send = sender({ b: { ok: false, retry: true, reason: 'daily-cap' } })

    const r = await box.drain(1, send)

    expect(r).toEqual({ sent: 1, dropped: [], stopped: 'daily-cap', summary: SUMMARY })
    expect(send.upload.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(await box.waiting(1)).toBe(2)
  })

  it('a refused shot is dropped and reported', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    await box.addUpload(1, 'b', label(2), jpeg())
    const send = sender({ a: { ok: false, retry: false, reason: 'rejected' } })

    const r = await box.drain(1, send)

    expect(r).toEqual({
      sent: 1,
      dropped: [{ id: 'a', reason: 'rejected' }],
      stopped: null,
      summary: SUMMARY
    })
    expect(await box.waiting(1)).toBe(0)
  })

  it('forget drops a queued upload', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    await box.addUpload(1, 'b', label(2), jpeg())

    expect(await box.forget(1, 'a')).toBe('dropped')
    expect(await box.waiting(1)).toBe(1)
    const send = sender()
    await box.drain(1, send)

    expect(send.upload.mock.calls.map((c) => c[0])).toEqual(['b'])
    expect(send.remove).not.toHaveBeenCalled()
  })

  it('forget after upload queues a delete', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    const send = sender()
    await box.drain(1, send)

    expect(await box.forget(1, 'a')).toBe('queued')
    expect(await box.waiting(1)).toBe(0)
    const r = await box.drain(1, send)

    expect(send.remove.mock.calls.map((c) => c[0])).toEqual(['a'])
    expect(send.upload).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ sent: 1, stopped: null })
  })

  it('forget during an in-flight upload queues a delete', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    const held = deferred<TrainingSend>()
    const send = sender({ a: () => held.promise })

    const drain = box.drain(1, send)
    await vi.waitFor(() => expect(send.upload).toHaveBeenCalledTimes(1))
    expect(await box.forget(1, 'a')).toBe('queued')
    held.resolve(OK)
    await drain

    expect(send.remove.mock.calls.map((c) => c[0])).toEqual(['a'])
    expect(send.upload).toHaveBeenCalledTimes(1)
    await box.drain(1, send)
    expect(send.remove).toHaveBeenCalledTimes(1)
  })

  it('forget after a lost response queues a delete', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    const server = new Set<string>()
    const send = sender({
      a: async () => {
        server.add('a')
        return { ok: false, retry: true, reason: 'offline' }
      }
    })
    expect(await box.drain(1, send)).toMatchObject({ sent: 0, stopped: 'offline' })
    expect(server.has('a')).toBe(true)

    expect(await box.forget(1, 'a')).toBe('queued')
    await box.drain(1, send)

    expect(send.remove.mock.calls.map((c) => c[0])).toEqual(['a'])
    expect(send.upload).toHaveBeenCalledTimes(1)
  })

  it('concurrent drains share one run', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    await box.addUpload(1, 'a', label(1), jpeg())
    await box.addUpload(1, 'b', label(2), jpeg())
    const send = sender()

    const [one, two] = await Promise.all([box.drain(1, send), box.drain(1, send)])

    expect(send.upload.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(one).toEqual(two)

    await box.addUpload(1, 'c', label(3), jpeg())
    await box.addUpload(2, 'd', label(4), jpeg())
    await box.addUpload(2, 'e', label(5), jpeg())
    const send1 = sender()
    const send2 = sender({ e: { ok: false, retry: false, reason: 'too-big' } })
    const [r1, r2] = await Promise.all([box.drain(1, send1), box.drain(2, send2)])

    expect(send1.upload.mock.calls.map((c) => c[0])).toEqual(['c'])
    expect(send2.upload.mock.calls.map((c) => c[0])).toEqual(['d', 'e'])
    expect(r1).toEqual({ sent: 1, dropped: [], stopped: null, summary: SUMMARY })
    expect(r2).toEqual({
      sent: 1,
      dropped: [{ id: 'e', reason: 'too-big' }],
      stopped: null,
      summary: SUMMARY
    })
  })

  it('tells listeners when the queue changes', async () => {
    const box = createOutbox(memoryOutboxStorage(), clock())
    const cb = vi.fn()
    const off = box.onChange(cb)
    await box.addUpload(1, 'a', label(1), jpeg())
    expect(cb).toHaveBeenCalled()
    off()
    cb.mockClear()
    await box.drain(1, sender())
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('idbOutboxStorage', () => {
  const item = (): OutboxItem => ({
    key: 'upload:a',
    id: 'a',
    userId: 1,
    kind: 'upload',
    label: label(1),
    jpeg: jpeg(9),
    attempts: 0,
    queuedAt: '2026-11-04T10:00:00.000Z'
  })

  it('idbOutboxStorage round-trips', async () => {
    await idbOutboxStorage('outbox-round-trip').put(item())

    const again = idbOutboxStorage('outbox-round-trip')
    const all = await again.all()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ key: 'upload:a', id: 'a', userId: 1, label: label(1) })
    // Not a Blob (checked by tag: fake-indexeddb clones into another realm's ArrayBuffer).
    expect(Object.prototype.toString.call(all[0].jpeg)).toBe('[object ArrayBuffer]')
    expect([...new Uint8Array(all[0].jpeg!)]).toEqual([0xff, 0xd8, 0xff, 9])

    await again.remove('upload:a')
    expect(await again.all()).toEqual([])
    expect(await idbOutboxStorage('outbox-round-trip').all()).toEqual([])
  })

  it('reading an outbox that was never written creates no database', async () => {
    const storage = idbOutboxStorage('outbox-never-written')
    expect(await storage.all()).toEqual([])
    await storage.remove('upload:a')
    const names = (await indexedDB.databases()).map((d) => d.name)
    expect(names).not.toContain('outbox-never-written')

    // A first write still creates it.
    await storage.put(item())
    expect((await indexedDB.databases()).map((d) => d.name)).toContain('outbox-never-written')
    expect(await storage.all()).toHaveLength(1)
  })
})
