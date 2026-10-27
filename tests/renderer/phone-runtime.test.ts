import { createPhoneRuntime, type WorkerLike } from '../../src/phone/runtime'
import { EDIT_DELAY_MS } from '../../src/phone/syncTriggers'
import { fakeOcr, setOnline } from './phoneFakes'

const REPLIES: Record<string, unknown> = {
  account: { state: 'signed-out' },
  syncState: { waiting: 0, problems: 0, lastSyncedAt: null, signedOut: true },
  sync: { waiting: 0, problems: 0, lastSyncedAt: null, signedOut: true, changed: false }
}

/**
 * A worker that records the requests sent to it; with `answer`, it answers each one (a little
 * later, as a worker would). The test can post anything else.
 */
function fakeWorker(answer = false): WorkerLike & {
  sent: { id: number; method: string }[]
  emit(type: 'message' | 'error', data?: unknown): void
} {
  const listeners: { type: string; l: (e: MessageEvent) => void }[] = []
  const sent: { id: number; method: string }[] = []
  const emit = (type: 'message' | 'error', data?: unknown): void => {
    for (const x of listeners)
      if (x.type === type) x.l(new MessageEvent(type === 'message' ? 'message' : 'error', { data }))
  }
  return {
    sent,
    postMessage: (m: unknown) => {
      const req = m as { id: number; method: string }
      sent.push(req)
      if (answer)
        queueMicrotask(() => emit('message', { id: req.id, ok: true, value: REPLIES[req.method] }))
    },
    addEventListener: (type: string, l: (e: MessageEvent) => void) => {
      listeners.push({ type, l })
    },
    emit
  }
}

const methods = (worker: ReturnType<typeof fakeWorker>): string[] =>
  worker.sent.map((m) => m.method)

afterEach(() => {
  vi.useRealTimers()
  setOnline(true)
})

describe('createPhoneRuntime', () => {
  it('hands a fatal posted before anyone listens to a later onFatal', () => {
    const worker = fakeWorker()
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    worker.emit('message', { fatal: 'no OPFS' })
    const seen: string[] = []
    rt.onFatal((m) => seen.push(m))
    expect(seen).toEqual(['no OPFS'])
    rt.dispose()
  })

  it('a worker that fails to load is fatal too', () => {
    const worker = fakeWorker()
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    const seen: string[] = []
    rt.onFatal((m) => seen.push(m))
    worker.emit('error')
    expect(seen).toHaveLength(1)
    rt.dispose()
  })

  it('store calls go to the worker, and a fatal fails them', async () => {
    const worker = fakeWorker()
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    const call = rt.store.account()
    expect(worker.sent).toEqual([{ id: 1, method: 'account', args: [] }])
    worker.emit('message', { fatal: 'no OPFS' })
    await expect(call).rejects.toThrow('no OPFS')
    rt.dispose()
  })

  it('an edit syncs once, EDIT_DELAY_MS after the last one', async () => {
    vi.useFakeTimers()
    const worker = fakeWorker(true)
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    await rt.api.collection.remove(1)
    await vi.advanceTimersByTimeAsync(EDIT_DELAY_MS / 2)
    await rt.api.collection.remove(2)
    await vi.advanceTimersByTimeAsync(EDIT_DELAY_MS - 1)
    expect(methods(worker)).not.toContain('sync')
    await vi.advanceTimersByTimeAsync(1)
    expect(methods(worker).filter((m) => m === 'sync')).toHaveLength(1)
    rt.dispose()
  })

  it('coming back online syncs', async () => {
    const worker = fakeWorker(true)
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(methods(worker)).toContain('sync'))
    rt.dispose()
    worker.sent.length = 0
    window.dispatchEvent(new Event('online'))
    await new Promise((r) => setTimeout(r, 0))
    expect(worker.sent).toEqual([])
  })
})
