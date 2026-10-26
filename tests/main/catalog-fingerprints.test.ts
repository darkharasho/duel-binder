import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { encode } from 'jpeg-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runJob } from '../../scripts/catalog/build'
import { buildFingerprints, uploadFingerprints } from '../../scripts/catalog/fingerprints'
import { openDatabase } from '../../src/main/db/database'
import { decodeFingerprints } from '../../src/shared/scan/fingerprintFile'

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

const IMAGES: Record<string, Uint8Array> = { '1': jpeg(false), '2': jpeg(true) }

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
