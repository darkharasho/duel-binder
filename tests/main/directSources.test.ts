import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directImageSources } from '../../src/main/dev/directSources'
import { createImageCache } from '../../src/main/images/cache'
import { createLimiter } from '../../src/main/images/limiter'
import type { SqlDb } from '../../src/main/db/sql'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ygo-direct-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const dbWith = (url: string | null): SqlDb =>
  ({
    prepare: () => ({ get: () => (url === null ? undefined : { image_url: url }) })
  }) as unknown as SqlDb
const brokenDb = {
  prepare: () => {
    throw new Error('database closed')
  }
} as unknown as SqlDb

const image = (): Response =>
  new Response('x', { status: 200, headers: { 'content-type': 'image/png' } })
const make = (
  db: SqlDb,
  resolvePrintingArt?: (id: number) => Promise<string | null>
): { cache: ReturnType<typeof createImageCache>; fetchFn: ReturnType<typeof vi.fn> } => {
  const fetchFn = vi.fn(async () => image())
  const cache = createImageCache({
    dir,
    fetchFn: fetchFn as unknown as typeof fetch,
    limit: createLimiter({ concurrency: 4, minIntervalMs: 0 }),
    prepareLogo: async () => undefined,
    sources: directImageSources({ db, version: '1.0.0', resolvePrintingArt })
  })
  return { cache, fetchFn }
}

describe('directImageSources', () => {
  it('fetches a resolved URL inside the allowed host with the User-Agent', async () => {
    const { cache, fetchFn } = make(dbWith('https://ms.yugipedia.com/a/b/X.png'))
    expect(await cache.getSet('yp-0123456789abcdef0123')).not.toBeNull()
    expect(fetchFn.mock.calls[0][0]).toBe('https://ms.yugipedia.com/a/b/X.png')
  })

  it.each(['yp-0123456789abcdef0123', 'yc-0123456789abcdef0123', 'km-0123456789abcdef0123'])(
    'refuses a %s URL outside its host',
    async (key) => {
      const { cache, fetchFn } = make(dbWith('https://evil.example/x.png'))
      expect(await cache.getSet(key)).toBeNull()
      expect(fetchFn).not.toHaveBeenCalled()
    }
  )

  it('refuses printing art outside Yugipedia and TCGplayer', async () => {
    const { cache, fetchFn } = make(dbWith(null), async () => 'https://evil.example/x.png')
    expect(await cache.getPrinting(1)).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('answers null when a resolver throws', async () => {
    const closed = make(brokenDb)
    expect(await closed.cache.getSet('yp-0123456789abcdef0123')).toBeNull()
    const failing = make(dbWith(null), async () => {
      throw new Error('lookup failed')
    })
    expect(await failing.cache.getPrinting(1)).toBeNull()
    expect(closed.fetchFn).not.toHaveBeenCalled()
    expect(failing.fetchFn).not.toHaveBeenCalled()
  })
})
