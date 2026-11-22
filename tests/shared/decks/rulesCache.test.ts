import { describe, expect, it, vi } from 'vitest'
import {
  loadRulesPack,
  PACK_REFRESH_MS,
  type CachedPack,
  type PackStore
} from '../../../src/shared/decks/rulesCache'

const NOW = new Date('2026-11-22T12:00:00Z')
const pack = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: 1,
    game: 'ygo',
    version: '2026-11-20',
    builtAt: '2026-11-20T00:00:00Z',
    sources: [],
    formats: {
      advanced: { limits: {}, notReleased: {} },
      ocg: { limits: {}, notReleased: {} }
    },
    ...extra
  })
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

function setup(cached: CachedPack | null, fetchImpl: typeof fetch) {
  let stored = cached
  const store: PackStore = {
    read: async () => stored,
    write: async (_g, c) => {
      stored = c
    }
  }
  const fetchMock = vi.fn(fetchImpl)
  const run = () =>
    loadRulesPack('ygo', {
      store,
      fetch: fetchMock as unknown as typeof fetch,
      origin: 'https://app.duelbinder.com',
      now: () => NOW
    })
  return { run, fetchMock, stored: () => stored }
}

describe('loadRulesPack', () => {
  it('uses a fresh cache without fetching', async () => {
    const t = setup(
      { body: pack(), etag: '"a"', checkedAt: ago(PACK_REFRESH_MS - 1000) },
      async () => {
        throw new Error('no')
      }
    )
    expect((await t.run()).state).toBe('ready')
    expect(t.fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a stale cache when the fetch rejects', async () => {
    const t = setup(
      { body: pack(), etag: null, checkedAt: ago(PACK_REFRESH_MS + 1000) },
      async () => {
        throw new Error('offline')
      }
    )
    expect((await t.run()).state).toBe('ready')
  })

  it('keeps the old pack when a 200 body is corrupt', async () => {
    const old = { body: pack(), etag: '"a"', checkedAt: ago(PACK_REFRESH_MS + 1000) }
    const t = setup(old, async () => new Response('{oops', { status: 200 }))
    expect((await t.run()).state).toBe('ready')
    expect(t.stored()).toEqual(old)
  })

  it('is missing with no cache and a 500', async () => {
    const t = setup(null, async () => new Response('x', { status: 500 }))
    expect(await t.run()).toEqual({ state: 'missing' })
  })

  it('bumps checkedAt on a 304, sending If-None-Match', async () => {
    const t = setup(
      { body: pack(), etag: '"a"', checkedAt: ago(PACK_REFRESH_MS + 1000) },
      async () => new Response(null, { status: 304 })
    )
    expect((await t.run()).state).toBe('ready')
    expect(t.stored()!.checkedAt).toBe(NOW.toISOString())
    const init = t.fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('if-none-match')).toBe('"a"')
    expect(t.fetchMock.mock.calls[0][0]).toBe('https://app.duelbinder.com/api/rules/ygo')
  })

  it('stores a fresh 200 with its ETag', async () => {
    const t = setup(
      null,
      async () => new Response(pack(), { status: 200, headers: { etag: '"b"' } })
    )
    expect((await t.run()).state).toBe('ready')
    expect(t.stored()).toEqual({ body: pack(), etag: '"b"', checkedAt: NOW.toISOString() })
  })

  it('stores a schema 2 pack as tooNew', async () => {
    const body = pack({ schema: 2 })
    const t = setup(null, async () => new Response(body, { status: 200 }))
    expect(await t.run()).toEqual({ state: 'tooNew' })
    expect(t.stored()!.body).toBe(body)
  })

  it('never throws when the store does', async () => {
    const res = await loadRulesPack('ygo', {
      store: {
        read: async () => {
          throw new Error('db')
        },
        write: async () => {
          throw new Error('db')
        }
      },
      fetch: (async () => new Response(pack())) as unknown as typeof fetch,
      origin: '',
      now: () => NOW
    })
    expect(['ready', 'missing']).toContain(res.state)
  })
})
