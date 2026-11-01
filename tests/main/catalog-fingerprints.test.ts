import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { decode, encode } from 'jpeg-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runJob } from '../../scripts/catalog/build'
import { buildFingerprints, uploadFingerprints } from '../../scripts/catalog/fingerprints'
import { openDatabase } from '../../src/main/db/database'
import { scanProfile } from '../../src/shared/scan/profiles'
import { NEW_ART_VARIANT } from '../../src/main/yugipedia/parse'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { hashHex, parseFingerprintRefs } from '../../src/shared/scan/fingerprintRefs'
import { pokemonId } from '../../src/shared/games'
import { tokenId } from '../../src/shared/games/ids'
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
  it('leaves Pokémon art out: it is not on YGOPRODeck and the scanner is Yu-Gi-Oh only', async () => {
    const pkm = 2 ** 40 + 5
    work
      .prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
         VALUES (?, 'Pikachu', 'Pokemon', 'pokemon', '', '', '2026-01-01', 'pkm')`
      )
      .run(pkm)
    work
      .prepare(
        "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
      )
      .run(pkm + 1, pkm)
    const requested: string[] = []
    const out = await buildFingerprints({
      work,
      cachePath: join(dir, 'fingerprints.sqlite'),
      fetch: imageFetch(requested)
    })
    expect(requested.sort()).toEqual(['1', '2', '3'])
    expect(out).toMatchObject({ count: 2, fetched: 2, failed: 1 })
  })

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

describe('buildFingerprints with tokens close to other cards', () => {
  const cachePath = (): string => join(dir, 'fingerprints.sqlite')
  /** A hash `bits` flipped away from all zeroes: two of these differ by the difference in bits. */
  const hash = (bits: number): Uint32Array => {
    const words = new Uint32Array(8)
    for (let i = 0; i < bits; i++) words[i >> 5] |= 1 << (i & 31)
    return words
  }
  /** The top `bits` bits set: `bits` from hash(0), and `bits + n` from hash(n) if they don't overlap. */
  const flipped = (bits: number): Uint32Array => hash(256).map((w, i) => w ^ hash(256 - bits)[i])
  const blob = (h: Uint32Array): Buffer => Buffer.from(h.buffer, h.byteOffset, h.byteLength)
  const yugipedia = {
    listPageImages: async () => new Map<string, string[]>(),
    fetchImageUrls: async () => new Map<string, string>()
  }
  const references = { yugipedia, userAgent: 'test' }
  const noImages = (async () => new Response('', { status: 404 })) as typeof fetch

  /** Puts hashes in the cache for images of the catalog, as an earlier night left them. */
  function cached(hashes: Record<number, Uint32Array>): void {
    const cache = new Database(cachePath())
    for (const [id, h] of Object.entries(hashes))
      cache.prepare('INSERT OR REPLACE INTO fp (image_id, hash) VALUES (?, ?)').run(id, blob(h))
    cache.close()
  }

  /** Puts a scan of an art variant printing of the card in the cache. */
  function scan(card: number, file: string, h: Uint32Array): void {
    const { lastInsertRowid: id } = work
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
         VALUES (?, ?, ?, 'Ultra Rare', 'UR', 'en', ?)`
      )
      .run(card, file, `${file}-EN001`, NEW_ART_VARIANT)
    const cache = new Database(cachePath())
    cache
      .prepare('INSERT INTO ref_printing (printing_id, file, checked_at) VALUES (?, ?, ?)')
      .run(id, file, '2026-10-30')
    cache
      .prepare('INSERT INTO ref_file (file, hash, checked_at) VALUES (?, ?, ?)')
      .run(file, blob(h), '2026-10-30')
    cache.close()
  }

  function token(page: number, images = [page + 1000]): number[] {
    work
      .prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, ?, 'Token', 'token', 'Token', '', '2026-10-30')`
      )
      .run(tokenId(page), `Token ${page}`)
    for (const [i, image] of images.entries()) {
      work
        .prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, ?, ?)')
        .run(tokenId(image), tokenId(page), i)
    }
    return images.map(tokenId)
  }

  const ids = (bytes: Uint8Array): number[] => {
    const index = decodeFingerprints(bytes)
    return [...new Set(index.nearest(hash(0), 50).map((m) => m.imageId))].sort((a, b) => a - b)
  }

  beforeEach(async () => {
    // Makes the cache's tables; none of the catalog's images are fetched.
    await buildFingerprints({ work, cachePath: cachePath(), fetch: noImages, references })
    cached({ 1: hash(0) })
    work.prepare('DELETE FROM card_images WHERE image_id != 1').run()
  })

  it('leaves out a token within 80 of a normal card, and keeps one 81 away', async () => {
    const [close] = token(1)
    const [clear] = token(2)
    cached({ [close]: hash(80), [clear]: flipped(81) })
    const lines: string[] = []
    const out = await buildFingerprints({
      work,
      cachePath: cachePath(),
      fetch: noImages,
      log: (s) => lines.push(s)
    })
    expect(ids(out.bytes)).toEqual([1, clear])
    expect(out.count).toBe(2)
    expect(lines).toContain(
      'Tokens left out of the fingerprints, too close to other art (1): Token 1'
    )
  })

  it('leaves the other records byte for byte as they were, in format 1', async () => {
    const [close] = token(1)
    const [clear] = token(2)
    cached({ [close]: hash(46), [clear]: flipped(200) })
    const out = await buildFingerprints({ work, cachePath: cachePath(), fetch: noImages })
    expect(out.bytes).toEqual(
      encodeFingerprints([
        { imageId: 1, hash: hash(0) },
        { imageId: clear, hash: flipped(200) }
      ])
    )
    expect(out.bytes[4]).toBe(1)
  })

  it('leaves out both of two tokens close to each other, and neither is close to a card', async () => {
    const [a] = token(1)
    const [b] = token(2)
    const [c] = token(3)
    cached({ [a]: flipped(200), [b]: flipped(160), [c]: hash(120) })
    const out = await buildFingerprints({ work, cachePath: cachePath(), fetch: noImages })
    expect(ids(out.bytes)).toEqual([1, c])
  })

  it('does not hold two images of one token against each other', async () => {
    const [a, b] = token(1, [1001, 1002])
    cached({ [a]: flipped(200), [b]: flipped(190) })
    const out = await buildFingerprints({ work, cachePath: cachePath(), fetch: noImages })
    expect(ids(out.bytes)).toEqual([1, a, b])
  })

  it('counts a printing scan of a normal card among the records a token is held against', async () => {
    const [image] = token(1)
    cached({ [image]: flipped(200) })
    scan(1, 'Normal-Scan.png', flipped(170))
    const opts = { work, cachePath: cachePath(), fetch: noImages }
    const out = await buildFingerprints({ ...opts, references })
    expect(ids(out.bytes)).toEqual([1])
    expect(out.references.count).toBe(1)
  })

  it('takes every record and ref of a token whose own printing scan is close to a card', async () => {
    const [image] = token(1)
    cached({ [image]: flipped(200) })
    scan(tokenId(1), 'Token-Close.png', hash(30))
    scan(tokenId(1), 'Token-Far.png', flipped(190))
    const opts = { work, cachePath: cachePath(), fetch: noImages }
    const out = await buildFingerprints({ ...opts, references })
    expect(ids(out.bytes)).toEqual([1])
    expect(out).toMatchObject({ count: 1, references: { count: 0 } })
    expect(parseFingerprintRefs(new TextDecoder().decode(out.refs)).refs).toEqual([])
  })

  it('keeps the printing scans and refs of a token that is clear of every card', async () => {
    const [image] = token(1)
    cached({ [image]: flipped(200) })
    scan(tokenId(1), 'Token-Far.png', flipped(190))
    const opts = { work, cachePath: cachePath(), fetch: noImages }
    const out = await buildFingerprints({ ...opts, references })
    expect(out).toMatchObject({ count: 3, references: { count: 1 } })
    expect(parseFingerprintRefs(new TextDecoder().decode(out.refs)).refs).toMatchObject([
      { h: hashHex(flipped(190)), imageId: image }
    ])
  })
})

describe('uploadFingerprints', () => {
  it('throws on a non-2xx response', async () => {
    const fetch = (async () => new Response('nope', { status: 403 })) as typeof globalThis.fetch
    await expect(
      uploadFingerprints({
        url: 'https://p.example',
        token: 't',
        bytes: new Uint8Array(4),
        game: 'ygo',
        fetch
      })
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
      pokemon: async () => ({ reports: [], error: null }),
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
    expect(paths.at(-3)).toBe('/admin/catalog/finish')
    expect(calls.slice(-2)).toEqual([
      { method: 'PUT', path: '/admin/scan/fingerprints', type: 'application/octet-stream' },
      { method: 'PUT', path: '/admin/scan/fingerprint-refs', type: 'application/json' }
    ])
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

describe('buildFingerprints for Pokémon', () => {
  it('drops the hash of art taken off a card', async () => {
    const cardId = pokemonId('en/30th-c-005')
    const imageId = pokemonId('en/30th-c-005#img')
    work
      .prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
         VALUES (?, 'Misty', 'Trainer', 'pokemon', '', '', '2026-01-01', 'pkm')`
      )
      .run(cardId)
    work
      .prepare(
        "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
      )
      .run(imageId, cardId)
    work
      .prepare(
        `INSERT INTO pokemon_cards (card_id, category, source_id, image_url) VALUES (?, 'Trainer', ?, ?)`
      )
      .run(cardId, 'en/30th-c-005', 'https://assets.tcgdex.net/en/me/30th-c/005')
    const fetchFn = (async () => new Response(jpeg(false) as BodyInit)) as typeof fetch
    const build = (): ReturnType<typeof buildFingerprints> =>
      buildFingerprints({
        work,
        cachePath: join(dir, 'fingerprints-pkm.sqlite'),
        fetch: fetchFn,
        game: 'pkm'
      })
    expect(await build()).toMatchObject({ count: 1, fetched: 1 })
    work.prepare('UPDATE pokemon_cards SET image_url = NULL WHERE card_id = ?').run(cardId)
    expect(await build()).toMatchObject({ count: 0, fetched: 0 })
  })

  it('leaves Traditional Chinese Pokémon cards out of the pkm file', async () => {
    for (const sourceId of ['en/sv03-045', 'zh-hant/SV4K-001']) {
      const cardId = pokemonId(sourceId)
      work
        .prepare(
          `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
           VALUES (?, 'P', 'Pokemon', 'pokemon', '', '', '2026-01-01', 'pkm')`
        )
        .run(cardId)
      work
        .prepare(
          "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
        )
        .run(pokemonId(`${sourceId}#img`), cardId)
      work
        .prepare(
          `INSERT INTO pokemon_cards (card_id, category, source_id, image_url) VALUES (?, 'Pokemon', ?, ?)`
        )
        .run(cardId, sourceId, `https://assets.tcgdex.net/${sourceId}`)
    }
    const urls: string[] = []
    const out = await buildFingerprints({
      work,
      cachePath: join(dir, 'fingerprints-pkm.sqlite'),
      fetch: (async (input: string | URL | Request) => {
        urls.push(String(input))
        return new Response(jpeg(false) as BodyInit)
      }) as typeof fetch,
      game: 'pkm'
    })
    expect(out).toMatchObject({ count: 1, fetched: 1, failed: 0 })
    expect(urls).toEqual(['https://assets.tcgdex.net/en/sv03-045/low.jpg'])
  })

  it('never hashes art a Chinese card borrows, only the English card it belongs to', async () => {
    const ids_: number[] = []
    for (const [n, sourceId, url, twin] of [
      [1, 'en/sv03-125', 'https://assets.tcgdex.net/en/sv/sv03/125', null],
      [2, 'zh-hans/CSV5C-101', null, 2 ** 40 + 1]
    ] as const) {
      const id = 2 ** 40 + n
      ids_.push(id)
      work
        .prepare(
          `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
           VALUES (?, 'P', 'Pokemon', 'pokemon', '', '', '2026-01-01', 'pkm')`
        )
        .run(id)
      work
        .prepare(
          "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
        )
        .run(id + 1000, id)
      work
        .prepare(
          "INSERT INTO pokemon_cards (card_id, category, source_id, image_url, art_twin_id) VALUES (?, 'Pokemon', ?, ?, ?)"
        )
        .run(id, sourceId, url, twin)
    }
    const asked: string[] = []
    const out = await buildFingerprints({
      work,
      cachePath: join(dir, 'fingerprints-pkm.sqlite'),
      fetch: (async (url: string) => {
        asked.push(String(url))
        return new Response(null, { status: 404 })
      }) as typeof fetch,
      game: 'pkm'
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('/en/sv/sv03/125')
    expect(out.count).toBe(0)
  })

  it('pkm build hashes full-card art and writes v2', async () => {
    const sources = ['en/sv03-045', 'ja/SV1S-001']
    const bases = [
      'https://assets.tcgdex.net/en/sv/sv03/045',
      'https://assets.tcgdex.net/ja/SV/SV1S/001'
    ]
    const ids: number[] = []
    sources.forEach((sourceId, i) => {
      const cardId = pokemonId(sourceId)
      const imageId = pokemonId(`${sourceId}#img`)
      ids.push(imageId)
      work
        .prepare(
          `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
           VALUES (?, 'P', 'Pokemon', 'pokemon', '', '', '2026-01-01', 'pkm')`
        )
        .run(cardId)
      work
        .prepare(
          "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
        )
        .run(imageId, cardId)
      work
        .prepare(
          `INSERT INTO pokemon_cards (card_id, category, source_id, image_url) VALUES (?, 'Pokemon', ?, ?)`
        )
        .run(cardId, sourceId, bases[i])
    })
    const urls: string[] = []
    const fetchFn = (async (input: string | URL | Request) => {
      urls.push(String(input))
      return new Response((urls.length % 2 ? jpeg(false) : jpeg(true)) as BodyInit)
    }) as typeof fetch
    const out = await buildFingerprints({
      work,
      cachePath: join(dir, 'fingerprints-pkm.sqlite'),
      fetch: fetchFn,
      game: 'pkm'
    })
    expect(out).toMatchObject({ count: 2, fetched: 2, failed: 0 })
    expect(out.bytes[4]).toBe(2)
    const index = decodeFingerprints(out.bytes)
    // The fetch answers the first request with the x ramp and the second with the y ramp.
    const hashOf = (bytes: Uint8Array): Uint32Array =>
      artHash(
        fingerprintSource(
          decode(bytes, { useTArray: true, formatAsRGBA: true }),
          'pokemon',
          scanProfile('pkm')
        )
      )
    expect(index.nearest(hashOf(jpeg(false)), 1)[0].distance).toBe(0)
    expect(index.nearest(hashOf(jpeg(true)), 1)[0].distance).toBe(0)
    expect(
      [
        index.nearest(hashOf(jpeg(false)), 1)[0].imageId,
        index.nearest(hashOf(jpeg(true)), 1)[0].imageId
      ].sort()
    ).toEqual([...ids].sort())
    expect(urls.sort()).toEqual(bases.map((b) => `${b}/low.jpg`).sort())
    expect(urls.some((u) => u.includes('ygoprodeck'))).toBe(false)
  })
})
