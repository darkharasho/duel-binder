import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFingerprintStore } from '../../src/main/scan/fingerprints'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { encodeFingerprintRefs } from '../../src/shared/scan/fingerprintRefs'

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

  /** The server has no refs file unless a test gives `refsFetch` to answer for it. */
  const noRefs: typeof globalThis.fetch = async () => new Response('{}', { status: 404 })
  const make = (
    fetch: typeof globalThis.fetch,
    timeoutMs?: number,
    refsFetch: typeof globalThis.fetch = noRefs
  ): ReturnType<typeof createFingerprintStore> =>
    createFingerprintStore({
      dir,
      portal: 'https://p.test',
      game: 'ygo',
      fetch: (url, init) =>
        String(url).endsWith('/scan/fingerprint-refs') ? refsFetch(url, init) : fetch(url, init),
      now,
      timeoutMs
    })

  /** A fetch that never answers, but gives up when its signal aborts, as fetch does. */
  const stalled = vi.fn<typeof globalThis.fetch>(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })
  )

  it('is missing before anything is downloaded', async () => {
    const store = make(vi.fn())
    expect(store.status()).toEqual({ state: 'missing', count: 0 })
    expect(await store.read()).toBeNull()
  })

  it('pkm store uses its own files', async () => {
    const urls: string[] = []
    const fetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url))
      return ok(body(2))
    })
    const pkm = createFingerprintStore({
      dir,
      portal: 'https://p.test',
      game: 'pkm',
      fetch: fetch as unknown as typeof globalThis.fetch,
      now
    })
    expect(await pkm.refresh()).toEqual({ state: 'ready', count: 2, updated: true })
    expect(urls).toEqual(['https://p.test/scan/fingerprints?game=pkm'])
    expect(existsSync(join(dir, 'fingerprints-pkm.bin'))).toBe(true)
    expect(existsSync(join(dir, 'fingerprints-pkm.json'))).toBe(true)
    expect(existsSync(join(dir, 'fingerprints.bin'))).toBe(false)

    const ygo = make(fetch as unknown as typeof globalThis.fetch)
    expect(ygo.status()).toEqual({ state: 'missing', count: 0 })
    await ygo.refresh()
    expect(urls.at(-1)).toBe('https://p.test/scan/fingerprints')
  })

  it('downloads a fresh file and becomes ready', async () => {
    const bytes = body(3)
    const fetch = vi.fn(async () => ok(bytes))
    const store = make(fetch)
    expect(await store.refresh()).toEqual({ state: 'ready', count: 3, updated: true })
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
    expect(await p).toEqual({ state: 'ready', count: 1, updated: true })
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

  it('gives up on a stalled download after the timeout', async () => {
    const store = make(stalled, 20)
    expect(await store.refresh()).toEqual({ state: 'error', count: 0 })
    expect(stalled.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the file on disk when a download stalls', async () => {
    const store = make(
      vi.fn(async () => ok(body(2))),
      20
    )
    await store.refresh()
    const again = make(stalled, 20)
    expect(await again.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
    expect(await again.read()).not.toBeNull()
  })

  it('says when a refresh wrote a new file', async () => {
    const fetch = vi.fn(async () => ok(body(2)))
    const store = make(fetch)
    expect(await store.refresh()).toEqual({ state: 'ready', count: 2, updated: true })
    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
    // Within a day, nothing is fetched and nothing changes.
    expect(await store.refresh()).toEqual({ state: 'ready', count: 2 })
  })

  it('keeps the file on disk when the server has none (404)', async () => {
    const fetch = vi.fn(async () => ok(body(2)))
    const store = make(fetch)
    await store.refresh()
    fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
    expect(await store.read()).not.toBeNull()
  })

  it('tries again on the next refresh after a failed one', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('offline')
    })
    const store = make(fetch)
    expect(await store.refresh()).toEqual({ state: 'error', count: 0 })
    fetch.mockResolvedValueOnce(ok(body(1)))
    expect(await store.refresh()).toEqual({ state: 'ready', count: 1, updated: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('leaves no temporary file behind', async () => {
    const store = make(vi.fn(async () => ok(body(1))))
    await store.refresh()
    expect(readdirSync(dir).sort()).toEqual(['fingerprints.bin', 'fingerprints.json'])
  })

  describe('the refs file', () => {
    const KEY = 'ja|1|Original Artwork Collection|YAC1-JP006|Prismatic Secret Rare'
    const refs = encodeFingerprintRefs([
      { imageId: 1, hash: new Uint32Array(8).fill(1), printings: [KEY] }
    ])
    const okRefs = (etag = '"r1"'): Response =>
      new Response(refs as BodyInit, { status: 200, headers: { ETag: etag } })

    it('is downloaded beside the fingerprints and read back', async () => {
      const refsFetch = vi.fn<typeof globalThis.fetch>(async () => okRefs())
      const store = make(
        vi.fn(async () => ok(body(2))),
        undefined,
        refsFetch
      )
      expect(await store.readRefs()).toBeNull()
      expect(await store.refresh()).toEqual({ state: 'ready', count: 2, updated: true })
      expect((await store.readRefs())?.refs).toEqual([
        { h: '01000000'.repeat(8), imageId: 1, printings: [KEY] }
      ])
      // A new store reads it back from disk.
      expect(await make(vi.fn()).readRefs()).toEqual(await store.readRefs())
    })

    it('is revalidated by its own ETag, and a new one alone counts as an update', async () => {
      const fp = vi.fn<typeof globalThis.fetch>(async () => ok(body(2)))
      const refsFetch = vi.fn<typeof globalThis.fetch>(async () => okRefs())
      const store = make(fp, undefined, refsFetch)
      await store.refresh()
      fp.mockResolvedValue(new Response(null, { status: 304 }))
      refsFetch.mockResolvedValueOnce(new Response(null, { status: 304 }))
      expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
      expect(refsFetch.mock.calls[1][1]).toMatchObject({ headers: { 'If-None-Match': '"r1"' } })
      refsFetch.mockResolvedValueOnce(okRefs('"r2"'))
      expect(await store.refresh({ force: true })).toEqual({
        state: 'ready',
        count: 2,
        updated: true
      })
    })

    it("leaves the fingerprints' state alone when it fails, and keeps the one on disk", async () => {
      const refsFetch = vi.fn<typeof globalThis.fetch>(async () => okRefs())
      const fp = vi.fn<typeof globalThis.fetch>(async () => ok(body(2)))
      const store = make(fp, undefined, refsFetch)
      await store.refresh()
      fp.mockResolvedValue(new Response(null, { status: 304 }))
      refsFetch.mockResolvedValueOnce(new Response('junk', { status: 200 }))
      expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
      refsFetch.mockRejectedValueOnce(new Error('offline'))
      expect(await store.refresh({ force: true })).toEqual({ state: 'ready', count: 2 })
      expect(await store.readRefs()).not.toBeNull()
    })

    it('is not asked for without a fingerprint file', async () => {
      const refsFetch = vi.fn<typeof globalThis.fetch>(async () => okRefs())
      const store = make(async () => new Response('{}', { status: 404 }), undefined, refsFetch)
      await store.refresh()
      expect(refsFetch).not.toHaveBeenCalled()
    })

    it('reads as none when the file on disk goes bad', async () => {
      const store = make(
        vi.fn(async () => ok(body(2))),
        undefined,
        async () => okRefs()
      )
      await store.refresh()
      writeFileSync(join(dir, 'fingerprint-refs.json'), '{')
      expect(await store.readRefs()).toBeNull()
    })

    it('is asked for within the day by an install from before the refs, then daily', async () => {
      // A file checked an hour ago by an app that knew nothing of refs.
      writeFileSync(join(dir, 'fingerprints.bin'), body(2))
      writeFileSync(
        join(dir, 'fingerprints.json'),
        JSON.stringify({
          etag: '"v1"',
          count: 2,
          checkedAt: new Date(clock - 3600_000).toISOString()
        })
      )
      const fp = vi.fn<typeof globalThis.fetch>(async () => ok(body(2)))
      const refsFetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response('{}', { status: 404 })
      )
      const store = make(fp, undefined, refsFetch)
      expect(await store.refresh()).toEqual({ state: 'ready', count: 2 })
      expect(fp).not.toHaveBeenCalled()
      expect(refsFetch).toHaveBeenCalledTimes(1)
      // The portal has none yet: asked again at the daily check, not on every refresh.
      await store.refresh()
      expect(refsFetch).toHaveBeenCalledTimes(1)

      // Another old install, once the portal has them.
      refsFetch.mockResolvedValue(okRefs())
      writeFileSync(
        join(dir, 'fingerprints.json'),
        JSON.stringify({ etag: '"v1"', count: 2, checkedAt: new Date(clock).toISOString() })
      )
      const again = make(fp, undefined, refsFetch)
      expect(await again.refresh()).toEqual({ state: 'ready', count: 2, updated: true })
      expect(fp).not.toHaveBeenCalled()
      expect(await again.readRefs()).not.toBeNull()
    })
  })

  it('downloads again on the next refresh when the file on disk goes bad', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok(body(2)))
    const store = make(fetch)
    await store.refresh()
    writeFileSync(join(dir, 'fingerprints.bin'), 'junk')
    expect(await store.read()).toBeNull()
    expect(store.status()).toEqual({ state: 'missing', count: 0 })
    expect(existsSync(join(dir, 'fingerprints.json'))).toBe(false)
    // Within the day: the bad file doesn't wait for tomorrow, and nothing stale is revalidated.
    expect(await store.refresh()).toEqual({ state: 'ready', count: 2, updated: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1]).toMatchObject({ headers: {} })
    expect(await store.read()).not.toBeNull()
  })
})
