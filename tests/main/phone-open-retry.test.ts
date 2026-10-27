import { describe, expect, it, vi } from 'vitest'
import {
  isOpenElsewhere,
  openWithRetry,
  OPEN_RETRY_DELAYS_MS
} from '../../src/phone/data/openRetry'

/** What Chrome throws when another page's worker holds the pool's access handles. */
const locked = (): DOMException =>
  new DOMException(
    "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.",
    'NoModificationAllowedError'
  )

describe('opening the phone database', () => {
  it('tells a lock held by another tab from other failures', () => {
    expect(isOpenElsewhere(locked())).toBe(true)
    expect(isOpenElsewhere(new Error('Access Handles cannot be created'))).toBe(true)
    expect(isOpenElsewhere(new Error('Missing required OPFS APIs.'))).toBe(false)
    expect(isOpenElsewhere(undefined)).toBe(false)
  })

  it('tries again with growing waits while another tab lets go', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    let tries = 0
    const open = vi.fn(async () => {
      if (++tries < 3) throw locked()
      return 'db'
    })
    expect(await openWithRetry(open, { sleep })).toBe('db')
    expect(open).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual(OPEN_RETRY_DELAYS_MS.slice(0, 2))
    expect([...OPEN_RETRY_DELAYS_MS]).toEqual([...OPEN_RETRY_DELAYS_MS].sort((a, b) => a - b))
  })

  it('gives up with the lock error after the last wait', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const open = vi.fn(async () => {
      throw locked()
    })
    const err = await openWithRetry(open, { delays: [1, 2], sleep }).catch((e: unknown) => e)
    expect(isOpenElsewhere(err)).toBe(true)
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('does not retry any other failure', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const open = vi.fn(async () => {
      throw new Error('Missing required OPFS APIs.')
    })
    await expect(openWithRetry(open, { sleep })).rejects.toThrow('Missing required OPFS APIs.')
    expect(open).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
