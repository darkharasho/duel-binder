import { describe, expect, it, vi } from 'vitest'
import { refreshAllFingerprints } from '../../src/phone/refreshFingerprints'
import { createMockApi } from './mockApi'
import type { PhoneStore } from '../../src/phone/data/store'

describe('refreshAllFingerprints', () => {
  it('asks for a fingerprint file only for games that scan', async () => {
    window.api = createMockApi({ games: { available: async () => ['ygo', 'pkm', 'op', 'mtg'] } })
    const refreshFingerprints = vi.fn(async () => ({ state: 'ready' as const, count: 1 }))
    await refreshAllFingerprints({ refreshFingerprints } as unknown as PhoneStore)
    expect(
      refreshFingerprints.mock.calls.map((c) => (c as unknown as [{ game: string }])[0].game)
    ).toEqual(['ygo', 'pkm', 'op'])
  })
})
