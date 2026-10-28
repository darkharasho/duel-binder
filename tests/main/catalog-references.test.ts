import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { buildFingerprints } from '../../scripts/catalog/fingerprints'
import { buildReferences, scanHash, wantsReference } from '../../scripts/catalog/references'
import { openDatabase } from '../../src/main/db/database'
import { ART_BOXES, crop } from '../../src/renderer/src/features/scan/vision/regions'
import { artHash } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import type { RgbaImage } from '../../src/shared/scan/types'

describe('wantsReference', () => {
  it.each([
    ['Starlight Rare', null, true],
    ['Ghost Rare', null, true],
    ["Collector's Rare", null, true],
    ['Ultra Rare', 'Overframe', true],
    ['Prismatic Secret Rare', 'Alternate Art', true],
    ['Platinum Secret Rare (7th Art)', null, true],
    ['Ultra Rare (Overframe)', '', true],
    ['Super Rare', null, false],
    ['Secret Rare', '', false],
    ['Rare (Green)', null, false],
    ['Ultra Rare', 'Blue', false]
  ])('%s / %s: %s', (rarity, variant, wanted) => {
    expect(wantsReference(rarity, variant)).toBe(wanted)
  })
})

/** A card-shaped image (or any size) whose brightness ramps along x, or y, or a checker. */
function image(width: number, height: number, kind: 'x' | 'y' | 'checker'): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v =
        kind === 'x'
          ? Math.round((x / (width - 1)) * 255)
          : kind === 'y'
            ? Math.round((y / (height - 1)) * 255)
            : ((x >> 3) + (y >> 3)) % 2
              ? 230
              : 20
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

const png = (img: RgbaImage): Uint8Array => {
  const out = new PNG({ width: img.width, height: img.height })
  out.data = Buffer.from(img.data)
  return new Uint8Array(PNG.sync.write(out))
}

// 118 x 172 is a card's shape (59 x 86 mm).
const SCAN = image(118, 172, 'checker')
const SCAN_HASH = artHash(crop(SCAN, ART_BOXES.normal))

describe('scanHash', () => {
  it("hashes a card scan's art box, the Pendulum one for Pendulum cards", () => {
    expect(scanHash(SCAN, 'effect')).toEqual(SCAN_HASH)
    expect(scanHash(SCAN, 'effect_pendulum')).toEqual(artHash(crop(SCAN, ART_BOXES.pendulum)))
  })

  it('takes nothing not shaped like a card', () => {
    expect(scanHash(image(200, 200, 'x'), 'effect')).toBeNull()
  })
})

let dir: string
let work: Database.Database
let cache: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'refs-'))
  work = openDatabase(join(dir, 'work.sqlite'))
  cache = new Database(join(dir, 'fingerprints.sqlite'))
  cache.exec('CREATE TABLE fp (image_id INTEGER PRIMARY KEY, hash BLOB NOT NULL)')
  work
    .prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Shi En', 'Effect Monster', 'effect', 'Warrior', '', '2026-01-01')`
    )
    .run()
  // Two artworks: the scan looks like the second.
  const arts: [number, RgbaImage][] = [
    [10, image(64, 64, 'x')],
    [11, crop(SCAN, ART_BOXES.normal)]
  ]
  for (const [i, [id, art]] of arts.entries()) {
    work
      .prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, 1, ?)')
      .run(id, i)
    const h = artHash(art)
    cache
      .prepare('INSERT INTO fp (image_id, hash) VALUES (?, ?)')
      .run(id, Buffer.from(h.buffer, h.byteOffset, h.byteLength))
  }
  const printing = work.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
     VALUES (1, ?, ?, ?, '', 'en', ?)`
  )
  printing.run('Gold Glory', 'BLGG-EN007', 'Starlight Rare', null)
  printing.run('Gold Glory', 'BLGG-EN007', 'Secret Rare', null)
  printing.run('Storm of Ragnarok', 'STOR-EN041', 'Ultra Rare', 'Overframe')
})

afterEach(() => {
  cache.close()
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

const FILES = ['ShiEn-BLGG-EN-StR-1E.png', 'ShiEn-BLGG-EN-ScR-1E.png', 'ShiEn-STOR-EN-UR-1E.png']

function fakeYugipedia(files: string[] = FILES): {
  listPageImages: Mock<(titles: string[]) => Promise<Map<string, string[]>>>
  fetchImageUrls: Mock<(names: string[]) => Promise<Map<string, string>>>
} {
  return {
    listPageImages: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, files]))),
    fetchImageUrls: vi.fn(
      async (names: string[]) => new Map(names.map((f) => [f, `https://ms.yugipedia.com/a/${f}`]))
    )
  }
}

function scans(bodies: Record<string, Uint8Array>, requested: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const file = String(input).split('/').pop()!
    requested.push(file)
    const body = bodies[file]
    return body ? new Response(body as BodyInit) : new Response('', { status: 404 })
  }) as typeof fetch
}

describe('buildReferences', () => {
  it("hashes each wanted printing's scan once, under its card's closest artwork", async () => {
    const yugipedia = fakeYugipedia()
    const requested: string[] = []
    const fetch = scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(SCAN) }, requested)
    const run = (): ReturnType<typeof buildReferences> =>
      buildReferences({ work, cache, yugipedia, fetch, userAgent: 'test' })
    const first = await run()
    expect(first.entries).toEqual([{ imageId: 11, hash: SCAN_HASH }])
    expect(first).toMatchObject({ fetched: 1, failed: 1 })
    // The Secret Rare isn't wanted; the overframe's scan is missing.
    expect(requested.sort()).toEqual(['ShiEn-BLGG-EN-StR-1E.png', 'ShiEn-STOR-EN-UR-1E.png'])

    requested.length = 0
    const second = await run()
    expect(second.entries).toEqual(first.entries)
    expect(second).toMatchObject({ fetched: 0, failed: 0 })
    expect(requested).toEqual([])
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(1)
  })

  it('takes Japanese printings too, and no other language', async () => {
    const add = work.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
       VALUES (1, 'Limit Over Collection: The Rivals', ?, 'Ultra Rare (Overframe)', '', ?, NULL)`
    )
    add.run('LOCR-JP016', 'ja')
    add.run('LOCR-KR016', 'ko')
    const files = [...FILES, 'ShiEn-LOCR-JP-UR-EA.png', 'ShiEn-LOCR-KR-UR-UE-EA.png']
    const requested: string[] = []
    const fetch = scans({ 'ShiEn-LOCR-JP-UR-EA.png': png(SCAN) }, requested)
    const result = await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia(files),
      fetch,
      userAgent: 'test'
    })
    expect(requested).toContain('ShiEn-LOCR-JP-UR-EA.png')
    expect(requested).not.toContain('ShiEn-LOCR-KR-UR-UE-EA.png')
    expect(result.entries).toContainEqual({ imageId: 11, hash: SCAN_HASH })
  })

  it('looks again, a month on, for a printing with no scan or a scan that failed', async () => {
    const yugipedia = fakeYugipedia(['ShiEn-BLGG-EN-StR-1E.png'])
    const requested: string[] = []
    const fetch = scans({}, requested)
    let now = new Date('2026-01-01T00:00:00Z')
    const run = (): ReturnType<typeof buildReferences> =>
      buildReferences({ work, cache, yugipedia, fetch, userAgent: 'test', now: () => now })
    await run()
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(1)
    expect(requested).toEqual(['ShiEn-BLGG-EN-StR-1E.png'])

    now = new Date('2026-01-20T00:00:00Z')
    await run()
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(1)
    expect(requested).toHaveLength(1)

    now = new Date('2026-02-05T00:00:00Z')
    await run()
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(2)
    expect(requested).toHaveLength(2)
  })

  it('tries a scan again next run when Yugipedia was down', async () => {
    vi.useFakeTimers()
    try {
      const requested: string[] = []
      const down = (async (input: string | URL | Request) => {
        requested.push(String(input))
        return new Response('', { status: 503 })
      }) as typeof fetch
      const opts = {
        work,
        cache,
        yugipedia: fakeYugipedia(['ShiEn-BLGG-EN-StR-1E.png']),
        userAgent: 'test'
      }
      const run = buildReferences({ ...opts, fetch: down })
      await vi.runAllTimersAsync()
      expect(await run).toMatchObject({ fetched: 0, failed: 1 })
      expect(requested).toHaveLength(3)
      const fetch = scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(SCAN) })
      expect(await buildReferences({ ...opts, fetch })).toMatchObject({ fetched: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('downloads at most maxDownloads scans a run', async () => {
    const requested: string[] = []
    const fetch = scans({}, requested)
    const opts = { work, cache, yugipedia: fakeYugipedia(), fetch, userAgent: 'test' }
    await buildReferences({ ...opts, maxDownloads: 1 })
    expect(requested).toHaveLength(1)
    await buildReferences({ ...opts, maxDownloads: 1 })
    expect(requested).toHaveLength(2)
  })

  it('counts a file not shaped like a card as failed and keeps nothing for it', async () => {
    const fetch = scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(image(200, 200, 'x')) })
    const out = await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia(['ShiEn-BLGG-EN-StR-1E.png']),
      fetch,
      userAgent: 'test'
    })
    expect(out).toMatchObject({ entries: [], fetched: 0, failed: 1 })
  })
})

describe('buildFingerprints with printing scans', () => {
  const cardArt = (async () => new Response('', { status: 404 })) as typeof fetch

  it('adds the scans to the file, and keeps them when Yugipedia is down', async () => {
    cache.close()
    const cachePath = join(dir, 'fingerprints.sqlite')
    const fetch = scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(SCAN) })
    const out = await buildFingerprints({
      work,
      cachePath,
      fetch: cardArt,
      references: { yugipedia: fakeYugipedia(), fetch, userAgent: 'test' }
    })
    expect(out).toMatchObject({ count: 3, references: { count: 1, fetched: 1, failed: 1 } })
    expect(decodeFingerprints(out.bytes).nearest(SCAN_HASH, 1)).toEqual([
      { imageId: 11, distance: 0 }
    ])

    const broken = fakeYugipedia()
    broken.listPageImages.mockRejectedValue(new Error('down'))
    // A new printing to look up.
    work
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language)
         VALUES (1, 'Ghosts', 'GHOS-EN001', 'Ghost Rare', 'en')`
      )
      .run()
    const lines: string[] = []
    const again = await buildFingerprints({
      work,
      cachePath,
      fetch: cardArt,
      log: (l) => lines.push(l),
      references: { yugipedia: broken, fetch, userAgent: 'test' }
    })
    expect(again).toMatchObject({ count: 3, references: { count: 1, fetched: 0, failed: 0 } })
    expect(lines).toContain('Printing scan lookup failed: down')
    cache = new Database(cachePath)
  })
})
