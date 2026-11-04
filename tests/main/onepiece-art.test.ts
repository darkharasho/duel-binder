import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeImage } from '../../scripts/catalog/references'
import {
  distance, FULL_LIMIT_RAISED_AT, hexHash, isFrozen, refreshArt, smallCopy, uploadArt, type ArtBatch, type ArtResult
} from '../../scripts/catalog/onepiece/art'
import { openOpCache, type OpCache } from '../../scripts/catalog/onepiece/cache'
import type { OnePieceSources } from '../../scripts/catalog/onepiece/sources'
import type { OpProduct } from '../../scripts/catalog/onepiece/tcgcsv'
import type { BandaiEntry } from '../../scripts/catalog/onepiece/types'
import { onePieceImageId } from '../../src/shared/games/ids'
import { hashHex } from '../../src/shared/scan/fingerprintRefs'

const DAY = 24 * 60 * 60 * 1000

/** A 60x84 card with transparent corners; pattern A is stripes, B is a checkerboard. */
function png(pattern: 'A' | 'B'): Uint8Array {
  const p = new PNG({ width: 60, height: 84 })
  for (let y = 0; y < 84; y++) {
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 4
      const on = pattern === 'A' ? Math.floor(x / 6) % 2 === 0 : (Math.floor(x / 10) + Math.floor(y / 14)) % 2 === 0
      const v = on ? 230 : 25
      p.data[i] = v
      p.data[i + 1] = pattern === 'A' ? v : 255 - v
      p.data[i + 2] = 120
      p.data[i + 3] = x < 4 && y < 4 ? 0 : 255
    }
  }
  return new Uint8Array(PNG.sync.write(p))
}

const entry = (id: string, number: string, seriesId = 's1'): BandaiEntry => ({
  bandaiId: id, number, rarity: 'C', cardType: 'CHARACTER', name: id, cost: 1, life: null, power: null, counter: null,
  colors: [], attribute: [], traits: [], block: null, effect: null, trigger: null, cardSets: '', seriesId
})
const product = (productId: number, number: string, imageUrl: string | null = `https://img/${productId}.jpg`): OpProduct =>
  ({ productId, groupId: 1, name: String(productId), number, rarity: 'C', imageUrl })

interface Served { bandai: Map<string, { pattern: 'A' | 'B'; lastModified: string }>; log: string[]; fail: Set<string> }
function fakeSources(s: Served): OnePieceSources {
  return {
    async bandaiImage(id, since) {
      s.log.push(`bandai ${id}${since ? ' cond' : ''}`)
      if (s.fail.has(id)) throw new Error('boom')
      const v = s.bandai.get(id) ?? { pattern: 'A' as const, lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' }
      if (since && since === v.lastModified) return null
      return { bytes: png(v.pattern), lastModified: v.lastModified }
    },
    async tcgImage(url) {
      s.log.push(`tcg ${url}`)
      return png('A')
    }
  } as unknown as OnePieceSources
}

let dir: string
let cache: OpCache
let served: Served
let sources: OnePieceSources
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'op-art-'))
  cache = openOpCache(join(dir, 'c.db'))
  served = { bandai: new Map(), log: [], fail: new Set() }
  sources = fakeSources(served)
})
afterEach(() => { cache.close(); rmSync(dir, { recursive: true, force: true }) })

interface Put { url: string; type: string; body: Uint8Array }
function portal(puts: Put[]): { url: string; token: string; fetch: typeof fetch } {
  return {
    url: 'https://portal.test/', token: 't',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PUT')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer t')
      puts.push({ url: String(input), type: (init?.headers as Record<string, string>)['content-type'], body: init?.body as Uint8Array })
      return new Response('ok')
    }) as typeof fetch
  }
}
const batch1 = (ids: string[] = ['100_p1'], candidates: OpProduct[] = []): ArtBatch =>
  ({ seriesId: 's1', entries: ids.map((id) => entry(id, 'OP17-005')), candidates })
const run = (o: Partial<Parameters<typeof refreshArt>[0]> & { now: number }): Promise<ArtResult> =>
  refreshArt({ cache, sources, batches: [batch1()], stored: new Map(), log: () => {}, ...o })

describe('One Piece art', () => {
  it('hashes and stores new art, uploads both sizes', async () => {
    const puts: Put[] = []
    const r = await run({ now: 1000, portal: portal(puts) })
    expect(r).toMatchObject({ fetched: 1, failed: 0, uploaded: 1 })
    expect(puts.map((p) => [p.url, p.type])).toEqual([
      [`https://portal.test/api/admin/op-art/full/${onePieceImageId('en', '100_p1')}`, 'image/png'],
      [`https://portal.test/api/admin/op-art/small/${onePieceImageId('en', '100_p1')}`, 'image/jpeg']
    ])
    const small = decodeImage(puts[1].body)!
    expect(small.width).toBe(60)
    expect(small.data[3]).toBe(255)
    const row = cache.getBandaiArt('100_p1')!
    expect(row.storedAt).toBe(1000)
    expect(row.checkedAt).toBe(1000)
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('smallCopy fills transparent corners from the row', () => {
    const img = decodeImage(smallCopy(png('A'))!)!
    expect(img.width).toBe(60)
    expect(img.data[0]).toBeGreaterThan(150)
    expect(smallCopy(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('dry run hashes but uploads nothing', async () => {
    const r = await run({ now: 1000 })
    expect(r).toMatchObject({ fetched: 1, uploaded: 0 })
    expect(cache.getBandaiArt('100_p1')!.storedAt).toBeNull()
  })

  it('changed art is frozen', async () => {
    await run({ now: 0 })
    const a = cache.getBandaiArt('100_p1')!.hash
    served.bandai.set('100_p1', { pattern: 'B', lastModified: 'Tue, 02 Feb 2027 00:00:00 GMT' })
    const r15 = await run({ now: 15 * DAY, batches: [batch1(['100_p1'])] })
    expect(r15.changed).toEqual(['100_p1'])
    expect(r15.firstNoticed).toEqual(['100_p1'])
    const row = cache.getBandaiArt('100_p1')!
    expect(row.hash).toBe(a)
    expect(row.changedHash).not.toBeNull()
    expect(isFrozen(cache, '100_p1')).toBe(true)
    const r30 = await run({ now: 30 * DAY })
    expect(r30.firstNoticed).toEqual([])
    expect(r30.changed).toEqual(['100_p1'])
  })

  it('re-encoded same art is not a change', async () => {
    await run({ now: 0 })
    served.bandai.set('100_p1', { pattern: 'A', lastModified: 'Tue, 02 Feb 2027 00:00:00 GMT' })
    const r = await run({ now: 15 * DAY })
    expect(r.changed).toEqual([])
    expect(isFrozen(cache, '100_p1')).toBe(false)
    expect(cache.getBandaiArt('100_p1')!.lastModified).toBe('Tue, 02 Feb 2027 00:00:00 GMT')
  })

  it('budget carries over', async () => {
    const batches = [batch1(['1', '2', '3'])]
    const r1 = await run({ now: 0, batches, budget: 2 })
    expect(r1.fetched).toBe(2)
    expect(cache.getBandaiArt('3')).toBeNull()
    const r2 = await run({ now: DAY, batches, budget: 2 })
    expect(r2.fetched).toBe(1)
    expect(cache.getBandaiArt('3')).not.toBeNull()
  })

  it('newest series first', async () => {
    const batches: ArtBatch[] = [
      { seriesId: 'op17', entries: [entry('1', 'OP17-001', 'op17'), entry('2', 'OP17-002', 'op17')], candidates: [product(9, 'OP17-001')] },
      { seriesId: 'st31', entries: [entry('3', 'ST31-001', 'st31'), entry('4', 'ST31-002', 'st31')], candidates: [] }
    ]
    await run({ now: 0, batches, budget: 3 })
    expect(served.log.sort()).toEqual(['bandai 1', 'bandai 2', 'tcg https://img/9.jpg'])
  })

  it('tcg images only for numbers that need them', async () => {
    const cands = [product(10, 'OP17-005'), product(11, 'OP17-005'), product(12, 'OP17-005')]
    const batches: ArtBatch[] = [{ seriesId: 's1', entries: [entry('100_p1', 'OP17-005'), entry('100_p2', 'OP17-005')], candidates: cands }]
    await run({ now: 0, batches, stored: new Map([['100_p1', 10]]) })
    expect(served.log.filter((l) => l.startsWith('tcg')).sort()).toEqual(cands.map((c) => `tcg ${c.imageUrl}`))

    served.log.length = 0
    cache.putTcgArt({ productId: 11, imageUrl: 'https://img/11.jpg', hash: '0'.repeat(64), fetchedAt: 0 })
    cache.putTcgArt({ productId: 12, imageUrl: 'https://img/12.jpg', hash: '0'.repeat(64), fetchedAt: 0 })
    // Product 10 is stored; give it a different row URL so only it is stale: delete by overwriting with a changed URL.
    cache.putTcgArt({ productId: 10, imageUrl: 'https://old/10.jpg', hash: '0'.repeat(64), fetchedAt: 0 })
    await run({ now: 1, batches, stored: new Map([['100_p1', 10], ['100_p2', 11]]) })
    expect(served.log.filter((l) => l.startsWith('tcg'))).toEqual(['tcg https://img/10.jpg'])
  })

  it('tcg: a stored product with a current row and no other need is not fetched', async () => {
    const cands = [product(10, 'OP17-005'), product(11, 'OP17-005')]
    const batches: ArtBatch[] = [{ seriesId: 's1', entries: [entry('100_p1', 'OP17-005')], candidates: cands }]
    cache.putTcgArt({ productId: 10, imageUrl: 'https://img/10.jpg', hash: '0'.repeat(64), fetchedAt: 0 })
    await run({ now: 0, batches, stored: new Map([['100_p1', 10]]) })
    expect(served.log.filter((l) => l.startsWith('tcg'))).toEqual([])
  })

  it('frozen entries are re-checked fortnightly and never uploaded', async () => {
    await run({ now: 0 })
    served.bandai.set('100_p1', { pattern: 'B', lastModified: 'Tue, 02 Feb 2027 00:00:00 GMT' })
    await run({ now: 15 * DAY })
    expect(isFrozen(cache, '100_p1')).toBe(true)
    const puts: Put[] = []
    served.log.length = 0
    await run({ now: 16 * DAY, portal: portal(puts) })
    expect(puts).toEqual([])
    expect(served.log).toEqual([])
    expect(cache.getBandaiArt('100_p1')!.storedAt).toBeNull()
  })

  it('a retried upload with changed art freezes instead', async () => {
    await run({ now: 0 })
    served.bandai.set('100_p1', { pattern: 'B', lastModified: 'Tue, 02 Feb 2027 00:00:00 GMT' })
    const puts: Put[] = []
    const r = await run({ now: DAY, portal: portal(puts) })
    expect(puts).toEqual([])
    expect(isFrozen(cache, '100_p1')).toBe(true)
    expect(r.firstNoticed).toEqual(['100_p1'])
    expect(r.uploaded).toBe(0)
  })

  it('uploads each image right after its hash, before the next download', async () => {
    const events: string[] = []
    const inner = sources
    sources = {
      ...inner,
      bandaiImage: async (id: string, since?: string) => { events.push(`get ${id}`); return inner.bandaiImage(id, since) }
    } as OnePieceSources
    const p = portal([])
    const f = p.fetch
    p.fetch = ((u: RequestInfo | URL, i?: RequestInit) => { events.push(`put ${String(u).split('/').slice(-2).join('/')}`); return f(u, i) }) as typeof fetch
    await run({ now: 0, batches: [batch1(['1', '2', '3', '4'])], portal: p })
    const first = events.findIndex((e) => e.startsWith('put small'))
    const third = events.indexOf('get 3')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(third)
    // never more than 2 images are downloaded and not yet stored
    let open = 0
    let max = 0
    for (const e of events) {
      if (e.startsWith('get')) open++
      else if (e.startsWith('put small')) open--
      max = Math.max(max, open)
    }
    expect(max).toBeLessThanOrEqual(2)
  })

  it('a retried upload of the same art uploads it', async () => {
    await run({ now: 0 })
    const puts: Put[] = []
    const r = await run({ now: DAY, portal: portal(puts) })
    expect(puts).toHaveLength(2)
    expect(r.uploaded).toBe(1)
    expect(cache.getBandaiArt('100_p1')!.storedAt).toBe(DAY)
  })

  it('a failed upload is not retried the same night', async () => {
    const bad = { url: 'https://p', token: 't', fetch: (async () => new Response('no', { status: 400 })) as typeof fetch }
    const r1 = await run({ now: 0, portal: bad })
    expect(r1).toMatchObject({ failed: 1, uploaded: 0 })
    expect(served.log).toEqual(['bandai 100_p1'])
    expect(cache.getBandaiArt('100_p1')!.storedAt).toBeNull()
    const puts: Put[] = []
    const r2 = await run({ now: DAY, portal: portal(puts) })
    expect(r2).toMatchObject({ failed: 0, uploaded: 1 })
    expect(puts).toHaveLength(2)
    expect(cache.getBandaiArt('100_p1')!.storedAt).toBe(DAY)
  })

  it('art the portal refuses as too large waits for its re-check, noted once', async () => {
    const T0 = FULL_LIMIT_RAISED_AT
    const tooBig = { url: 'https://p', token: 't', fetch: (async () => new Response('{"error":"too-large"}', { status: 413 })) as typeof fetch }
    const r1 = await run({ now: T0, portal: tooBig })
    expect(r1).toMatchObject({ failed: 1, uploaded: 0, tooLarge: ['100_p1'] })
    expect(cache.getBandaiArt('100_p1')!.tooLargeAt).toBe(T0)
    // The next nights don't download it again.
    const puts: Put[] = []
    const r2 = await run({ now: T0 + DAY, portal: portal(puts) })
    expect(r2).toMatchObject({ fetched: 0, failed: 0, tooLarge: [] })
    expect(served.log).toEqual(['bandai 100_p1'])
    // At its re-check it is tried again; still too large is no new note.
    const r3 = await run({ now: T0 + 15 * DAY, portal: tooBig })
    expect(r3).toMatchObject({ fetched: 1, failed: 1, tooLarge: [] })
    expect(cache.getBandaiArt('100_p1')!.tooLargeAt).toBe(T0 + 15 * DAY)
    // Once it fits, it is stored and the stamp cleared.
    const r4 = await run({ now: T0 + 30 * DAY, portal: portal(puts) })
    expect(r4).toMatchObject({ uploaded: 1, failed: 0 })
    expect(puts).toHaveLength(2)
    expect(cache.getBandaiArt('100_p1')).toMatchObject({ storedAt: T0 + 30 * DAY, tooLargeAt: null })
  })

  it('art refused as too large before the portal limit was raised is tried again the next night', async () => {
    const tooBig = { url: 'https://p', token: 't', fetch: (async () => new Response('{"error":"too-large"}', { status: 413 })) as typeof fetch }
    const before = FULL_LIMIT_RAISED_AT - DAY
    await run({ now: before, portal: tooBig })
    expect(cache.getBandaiArt('100_p1')!.tooLargeAt).toBe(before)
    const puts: Put[] = []
    const r = await run({ now: FULL_LIMIT_RAISED_AT + DAY, portal: portal(puts) })
    expect(r).toMatchObject({ uploaded: 1, failed: 0 })
    expect(cache.getBandaiArt('100_p1')).toMatchObject({ storedAt: FULL_LIMIT_RAISED_AT + DAY, tooLargeAt: null })
  })

  it('an upload that runs over its time limit is retried', async () => {
    let calls = 0
    const f = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (calls++ === 0) {
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        )
      }
      return new Response('ok')
    }) as typeof fetch
    await uploadArt({ url: 'https://p', token: 't', fetch: f, timeoutMs: 20 }, 'full', 1, new Uint8Array([1]))
    expect(calls).toBe(2)
  })

  it('a failed download is counted and tried again', async () => {
    served.fail.add('100_p1')
    const r = await run({ now: 0 })
    expect(r.failed).toBe(1)
    expect(cache.getBandaiArt('100_p1')).toBeNull()
  })

  it('uploadArt throws on a client error without retrying', async () => {
    let calls = 0
    const f = (async () => { calls++; return new Response('no', { status: 400 }) }) as typeof fetch
    await expect(uploadArt({ url: 'https://p', token: 't', fetch: f }, 'full', 1, new Uint8Array([1]))).rejects.toThrow(/HTTP 400/)
    expect(calls).toBe(1)
  })

  it('distance and hexHash', () => {
    const h = new Uint32Array([1, 0xdeadbeef, 3, 4, 5, 6, 7, 0x80000000])
    expect(hexHash(hashHex(h))).toEqual(h)
    expect(distance(hashHex(h), hashHex(h))).toBe(0)
    const flipped = new Uint32Array(h.map((w) => ~w >>> 0))
    expect(distance(hashHex(h), hashHex(flipped))).toBe(256)
  })
})
