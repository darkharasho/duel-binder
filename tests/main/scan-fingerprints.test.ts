import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFingerprintStore } from '../../src/main/scan/fingerprints'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'

const body = (n: number): Uint8Array =>
  encodeFingerprints(
    Array.from({ length: n }, (_, i) => ({ imageId: i + 1, hash: new Uint32Array(8).fill(i + 1) }))
  )

const ok = (bytes: Uint8Array, etag = '"v1"'): Response =>
  new Response(bytes as BodyInit, { status: 200, headers: { ETag: etag } })

describe('fingerprint store', () => {
  let dir: string
  let clock: number
  const now = (): Date => new Date(clock)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-'))
    clock = Date.parse('2026-10-26T00:00:00Z')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const make = (fetch: typeof globalThis.fetch): ReturnType<typeof createFingerprintStore> =>
    createFingerprintStore({ dir, portal: 'https://p.test', fetch, now })

  it('is missing before anything is downloaded', async () => {
    const store = make(vi.fn())
    expect(store.status()).toEqual({ state: 'missing', count: 0 })
    expect(await store.read()).toBeNull()
  })

  it('downloads a fresh file and becomes ready', async () => {
    const bytes = body(3)
    const fetch = vi.fn(async () => ok(bytes))
    const store = make(fetch)
    expect(await store.refresh()).toEqual({ state: 'ready', count: 3 })
    expect(fetch).toHaveBeenCalledWith(
      'https://p.test/scan/fingerprints',
      expect.objectContaining({ headers: {} })
    )
    const read = await store.read()
    expect(new Uint8Array(read!)).toEqual(bytes)
    expect(read!.byteLength).toBe(bytes.length)
    expect(JSON.parse(readFileSync(join(dir, 'fingerprints.json'), 'utf8'))).toMatchObject({
      etag: '"v1"',
      count: 3
    })
    expect(existsSync(join(dir, 'fingerprints.bin'))).toBe(true)
    // A new store reads the same state back from disk.
    expect(make(vi.fn()).status()).toEqual({ state: 'ready', count: 3 })
  })

  it('reports downloading while the first download is in flight', async () => {
    let release!: (r: Response) => void
    const store = make(() => new Promise<Response>((r) => (release = r)))
    const p = store.refresh()
    expect(store.status()).toEqual({ state: 'downloading', count: 0 })
    release(ok(body(1)))
    expect(await p).toEqual({ state: 'ready', count: 1 })
  })

  it('does not fetch again within 24 hours unless forced', async () => {
    const fetch = vi.fn(async () => ok(body(2)))
    const store = make(fetch)
    await store.refresh()
    clock += 23 * 3600_000
    expect(await store.refresh()).toEqual({ state: 'ready', count: 2 })
    expect(fetch).toHaveBeenCalledTimes(1)
    clock += 2 * 3600_000
    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }))
    await store.refresh()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('sends If-None-Match and keeps the file on 304', async () => {
    const bytes = body(2)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok(bytes, '"abc"'))
    const store = make(fetch)
    await store.refresh()
    clock += 1000
    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
    expect(fetch.mock.calls[1][1]).toMatchObject({ headers: { 'If-None-Match': '"abc"' } })
    expect(new Uint8Array((await store.read())!)).toEqual(bytes)
    const meta = JSON.parse(readFileSync(join(dir, 'fingerprints.json'), 'utf8'))
    expect(meta.checkedAt).toBe(new Date(clock).toISOString())
    expect(meta.etag).toBe('"abc"')
  })

  it('keeps the old file when a 200 body is corrupt', async () => {
    const bytes = body(2)
    const fetch = vi.fn(async () => ok(bytes))
    const store = make(fetch)
    await store.refresh()
    fetch.mockResolvedValueOnce(ok(new Uint8Array([1, 2, 3]), '"bad"'))
    expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
    expect(new Uint8Array((await store.read())!)).toEqual(bytes)
  })

  it('gives error when the network fails and there is no file', async () => {
    const store = make(async () => {
      throw new Error('offline')
    })
    expect(await store.refresh()).toEqual({ state: 'error', count: 0 })
  })

  it('stays ready when the network fails but a file exists', async () => {
    const fetch = vi.fn(async () => ok(body(2)))
    const store = make(fetch)
    await store.refresh()
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
  })

  it('treats 404 as no file on the server', async () => {
    const store = make(async () => new Response('{"error":"No fingerprints yet"}', { status: 404 }))
    expect(await store.refresh()).toEqual({ state: 'missing', count: 0 })
  })

  it('treats a corrupt file on disk as missing', async () => {
    writeFileSync(join(dir, 'fingerprints.bin'), 'junk')
    writeFileSync(
      join(dir, 'fingerprints.json'),
      JSON.stringify({ etag: 'x', count: 5, checkedAt: '' })
    )
    const store = make(vi.fn())
    expect(store.status()).toEqual({ state: 'missing', count: 0 })
    expect(await store.read()).toBeNull()
  })

  it('shares one request between concurrent refreshes', async () => {
    const fetch = vi.fn(async () => ok(body(1)))
    const store = make(fetch)
    const [a, b] = await Promise.all([store.refresh(), store.refresh()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })
})
