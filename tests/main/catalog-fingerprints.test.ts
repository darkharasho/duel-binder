import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { decode, encode } from 'jpeg-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runJob } from '../../scripts/catalog/build'
import { buildFingerprints, uploadFingerprints } from '../../scripts/catalog/fingerprints'
import { openDatabase } from '../../src/main/db/database'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import type { RgbaImage } from '../../src/shared/scan/types'

let dir: string
let work: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-'))
  work = openDatabase(join(dir, 'work.sqlite'))
  work
    .prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'A', 'Normal Monster', 'normal', 'Warrior', '', '2026-01-01')`
    )
    .run()
  for (const id of [1, 2, 3]) {
    work
      .prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, 1, ?)')
      .run(id, id)
  }
})

afterEach(() => {
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A 32x32 JPEG whose brightness ramps along x (or y), so different seeds hash differently. */
function jpeg(vertical: boolean): Uint8Array {
  const size = 32
  const data = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(((vertical ? y : x) / (size - 1)) * 255)
      data.set([v, v, v, 255], (y * size + x) * 4)
    }
  }
  return new Uint8Array(encode({ data, width: size, height: size }, 90).data)
}

/** Pendulum-shaped art: a ramp in the visible top, a different picture below. */
function pendulumJpeg(): Uint8Array {
  const width = 32
  const height = 48
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = y < height / 2 ? Math.round((x / (width - 1)) * 255) : (x * 37 + y * 11) % 256
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  }
  return new Uint8Array(encode({ data, width, height }, 90).data)
}

const IMAGES: Record<string, Uint8Array> = {
  '1': jpeg(false),
  '2': jpeg(true),
  '4': pendulumJpeg()
}

function imageFetch(requested: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const id = /\/(\d+)\.jpg$/.exec(String(input))![1]
    requested.push(id)
    const body = IMAGES[id]
    return body ? new Response(body as BodyInit) : new Response('', { status: 404 })
  }) as typeof fetch
}

describe('buildFingerprints', () => {
  it('hashes new images, reuses the cache, and skips failures until next time', async () => {
    const cachePath = join(dir, 'fingerprints.sqlite')
    const requested: string[] = []
    const first = await buildFingerprints({ work, cachePath, fetch: imageFetch(requested) })
    expect(first).toMatchObject({ count: 2, fetched: 2, failed: 1 })
    const index = decodeFingerprints(first.bytes)
    expect(index.count).toBe(2)
    const expected = artHash(decode(IMAGES['1'], { useTArray: true, formatAsRGBA: true }))
    expect(index.nearest(expected, 1)[0]).toEqual({ imageId: 1, distance: 0 })

    requested.length = 0
    const second = await buildFingerprints({ work, cachePath, fetch: imageFetch(requested) })
    expect(second).toMatchObject({ count: 2, fetched: 0, failed: 1 })
    expect(requested).toEqual(['3'])
    expect(second.bytes).toEqual(first.bytes)
  })

  it('leaves out ids that are no longer in card_images', async () => {
    const cachePath = join(dir, 'fingerprints.sqlite')
    await buildFingerprints({ work, cachePath, fetch: imageFetch() })
    work.prepare('DELETE FROM card_images WHERE image_id = 2').run()
    const out = await buildFingerprints({ work, cachePath, fetch: imageFetch() })
    expect(out.count).toBe(1)
  })
})

describe('buildFingerprints with Pendulum art', () => {
  beforeEach(() => {
    work
      .prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
         VALUES (2, 'P', 'Pendulum Effect Monster', 'effect_pendulum', 'Dragon', '', '2026-01-01')`
      )
      .run()
    work.prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (4, 2, 0)').run()
  })

  it('hashes only the visible top of Pendulum art', async () => {
    const out = await buildFingerprints({
      work,
      cachePath: join(dir, 'fingerprints.sqlite'),
      fetch: imageFetch()
    })
    const img = decode(IMAGES['4'], { useTArray: true, formatAsRGBA: true })
    const visible = artHash(fingerprintSource(img, 'effect_pendulum'))
    expect(visible).not.toEqual(artHash(img))
    expect(decodeFingerprints(out.bytes).nearest(visible, 1)[0]).toEqual({
      imageId: 4,
      distance: 0
    })
  })

  it('rehashes Pendulum images cached before the visible-top change, once', async () => {
    const cachePath = join(dir, 'fingerprints.sqlite')
    const old = new Database(cachePath)
    old.exec('CREATE TABLE fp (image_id INTEGER PRIMARY KEY, hash BLOB NOT NULL)')
    for (const id of [1, 4]) {
      old.prepare('INSERT INTO fp (image_id, hash) VALUES (?, ?)').run(id, Buffer.alloc(32))
    }
    old.close()
    const requested: string[] = []
    await buildFingerprints({ work, cachePath, fetch: imageFetch(requested) })
    expect(requested.sort()).toEqual(['2', '3', '4'])

    requested.length = 0
    await buildFingerprints({ work, cachePath, fetch: imageFetch(requested) })
    expect(requested).toEqual(['3'])
  })
})

describe('buildFingerprints resilience', () => {
  it('retries a 429 and counts the image once it succeeds', async () => {
    vi.useFakeTimers()
    try {
      work.prepare('DELETE FROM card_images WHERE image_id != 1').run()
      let n = 0
      const flaky = (async () =>
        ++n === 1
          ? new Response('', { status: 429 })
          : new Response(IMAGES['1'] as BodyInit)) as typeof fetch
      const run = buildFingerprints({
        work,
        cachePath: join(dir, 'fingerprints.sqlite'),
        fetch: flaky
      })
      await vi.runAllTimersAsync()
      expect(await run).toMatchObject({ count: 1, fetched: 1, failed: 0 })
      expect(n).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a cached hash of the wrong size and fetches it again', async () => {
    const cachePath = join(dir, 'fingerprints.sqlite')
    await buildFingerprints({ work, cachePath, fetch: imageFetch() })
    const cache = new Database(cachePath)
    cache.prepare('UPDATE fp SET hash = ? WHERE image_id = 1').run(Buffer.alloc(5))
    cache.close()
    const requested: string[] = []
    const out = await buildFingerprints({ work, cachePath, fetch: imageFetch(requested) })
    expect(out).toMatchObject({ count: 2, fetched: 1 })
    expect(requested).toContain('1')
  })
})

describe('uploadFingerprints', () => {
  it('throws on a non-2xx response', async () => {
    const fetch = (async () => new Response('nope', { status: 403 })) as typeof globalThis.fetch
    await expect(
      uploadFingerprints({ url: 'https://p.example', token: 't', bytes: new Uint8Array(4), fetch })
    ).rejects.toThrow(/403/)
  })
})

describe('runJob', () => {
  it('uploads fingerprints after the catalog finishes', async () => {
    const calls: { method: string; path: string; type: string | null }[] = []
    const portal = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.hostname !== 'portal.example') return imageFetch()(input)
      calls.push({
        method: init?.method ?? 'GET',
        path: url.pathname,
        type: new Headers(init?.headers).get('content-type')
      })
      return Response.json({ ok: true, count: 2 })
    }) as typeof fetch
    const lines: string[] = []
    await runJob({
      dir,
      url: 'https://portal.example',
      token: 'tok',
      fetch: portal,
      // The real gate runs OpenCV over the scan fixtures; this test is about the upload order.
      checkAccuracy: async () => ({ shots: 1, right: 1, wrong: [], missed: [] }),
      refresh: async () => {},
      log: (l) => lines.push(l)
    })
    const paths = calls.map((c) => c.path)
    expect(paths.at(-2)).toBe('/admin/catalog/finish')
    expect(calls.at(-1)).toEqual({
      method: 'PUT',
      path: '/admin/scan/fingerprints',
      type: 'application/octet-stream'
    })
    expect(lines).toContain('Fingerprints: 2 (2 new, 1 failed)')
  })
})

describe('fingerprintSource', () => {
  const art = (width: number, height: number): RgbaImage => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  })

  it('keeps the visible top of a whole Pendulum picture', () => {
    // YGOPRODeck's usual Pendulum crop: the whole picture, part of it behind the Pendulum box.
    expect(fingerprintSource(art(712, 908), 'effect_pendulum').height).toBe(527)
  })

  it('keeps all of a Pendulum crop that is already just the visible window', () => {
    // About one Pendulum crop in six (Twilight Specter Rayrage among them) is cut to the window.
    const wide = art(712, 528)
    expect(fingerprintSource(wide, 'effect_pendulum')).toBe(wide)
  })

  it('keeps any other frame whole', () => {
    const square = art(624, 624)
    expect(fingerprintSource(square, 'link')).toBe(square)
  })
})
