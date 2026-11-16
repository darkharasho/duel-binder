import { describe, expect, it } from 'vitest'
import { cachedSupporterNames } from '../../workers/portal/src/site/supporterNames'
import type { EdgeCache } from '../../workers/portal/src/images'

const URL_ = 'https://app.test/api/supporters/names'

function memoryCache(): EdgeCache & { size: () => number } {
  const m = new Map<string, Response>()
  return {
    match: async (req) => m.get(req.url)?.clone(),
    put: async (req, res) => void m.set(req.url, res),
    size: () => m.size
  }
}

const answer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' }
  })

describe('cachedSupporterNames', () => {
  it('asks the store once and serves later views from the edge', async () => {
    const cache = memoryCache()
    let loads = 0
    const load = async (): Promise<Response> => (loads++, answer({ names: ['alice', 7, 'Bobby'] }))
    expect(await cachedSupporterNames(cache, URL_, load)).toEqual(['alice', 'Bobby'])
    expect(await cachedSupporterNames(cache, URL_, load)).toEqual(['alice', 'Bobby'])
    expect(loads).toBe(1)
  })

  it('lists nobody and keeps nothing when the store fails', async () => {
    const cache = memoryCache()
    expect(await cachedSupporterNames(cache, URL_, async () => answer({}, 500))).toEqual([])
    expect(cache.size()).toBe(0)
  })
})
