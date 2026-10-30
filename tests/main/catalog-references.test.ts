import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { buildFingerprints } from '../../scripts/catalog/fingerprints'
import { buildReferences, scanHash, wantsReference } from '../../scripts/catalog/references'
import { openDatabase } from '../../src/main/db/database'
import { NEW_ART_VARIANT } from '../../src/main/yugipedia/parse'
import { ART_BOXES, crop } from '../../src/renderer/src/features/scan/vision/regions'
import { artHash } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { hashHex, parseFingerprintRefs } from '../../src/shared/scan/fingerprintRefs'
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
    ['Ultra Rare', NEW_ART_VARIANT, true],
    ['Prismatic Secret Rare', NEW_ART_VARIANT, true],
    ['Super Rare', null, false],
    ['Secret Rare', '', false],
    ['Rare (Green)', null, false],
    ['Ultra Rare', 'Blue', false],
    ['Ultra Rare (25th Anniversary Edition)', null, true]
  ])('%s / %s: %s', (rarity, variant, wanted) => {
    expect(wantsReference(rarity, variant)).toBe(wanted)
  })

  it("takes every printing of an Original Artwork Duel Set, whose art is the manga's", () => {
    expect(wantsReference('Ultra Rare', null, 'Original Artwork Duel Set: Joey')).toBe(true)
    expect(wantsReference('Secret Rare', null, 'Original Artwork Collection')).toBe(true)
    expect(wantsReference('Ultra Rare', null, 'Starter Deck: Joey')).toBe(false)
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

const FILES = ['ShiEn-BLGG-EN-StR-1E.png', 'ShiEn-BLGG-EN-ScR-1E.png', 'ShiEn-STOR-EN-UR-1E-EA.png']

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
    expect(first.entries).toEqual([{ imageId: 11, hash: SCAN_HASH, printings: [] }])
    expect(first).toMatchObject({ fetched: 1, failed: 1 })
    // The Secret Rare isn't wanted; the overframe's scan is missing.
    expect(requested.sort()).toEqual(['ShiEn-BLGG-EN-StR-1E.png', 'ShiEn-STOR-EN-UR-1E-EA.png'])

    requested.length = 0
    const second = await run()
    expect(second.entries).toEqual(first.entries)
    expect(second).toMatchObject({ fetched: 0, failed: 0 })
    expect(requested).toEqual([])
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(1)
  })

  describe('a scan like none of its artworks', () => {
    /** SCAN_HASH with its first `bits` bits flipped: that far from the scan. */
    const flipped = (bits: number): Uint32Array => {
      const h = SCAN_HASH.slice()
      for (let i = 0; i < bits; i++) h[i >> 5] ^= 1 << (i & 31)
      return h
    }
    const setArt = (id: number, h: Uint32Array): void => {
      cache
        .prepare('UPDATE fp SET hash = ? WHERE image_id = ?')
        .run(Buffer.from(h.buffer, h.byteOffset, h.byteLength), id)
    }
    const run = (): ReturnType<typeof buildReferences> =>
      buildReferences({
        work,
        cache,
        yugipedia: fakeYugipedia(['ShiEn-BLGG-EN-StR-1E.png']),
        fetch: scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(SCAN) }),
        userAgent: 'test'
      })

    it("goes under the card's first artwork, not the least unlike one", async () => {
      // BLMM's Blue-Eyes: an art YGOPRODeck doesn't have, 122 from the art it was filed under.
      setArt(10, flipped(140))
      setArt(11, flipped(122))
      expect((await run()).entries).toEqual([{ imageId: 10, hash: SCAN_HASH, printings: [] }])
    })

    it('still goes under the closest artwork when that one is close enough', async () => {
      // A foil or overframe of the second art, a little further off than a plain scan.
      setArt(10, flipped(130))
      setArt(11, flipped(96))
      expect((await run()).entries).toEqual([{ imageId: 11, hash: SCAN_HASH, printings: [] }])
    })
  })

  it('names every art variant printing that took the scan, by its natural key', async () => {
    // No Secret Rare overframe scan: that printing takes the Ultra Rare one, whose art it shares.
    work
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
         VALUES (1, 'Storm of Ragnarok', 'STOR-EN041', 'Secret Rare', '', 'en', 'Overframe')`
      )
      .run()
    const result = await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia(['ShiEn-STOR-EN-UR-1E-EA.png']),
      fetch: scans({ 'ShiEn-STOR-EN-UR-1E-EA.png': png(SCAN) }),
      userAgent: 'test'
    })
    expect(result.entries).toEqual([
      {
        imageId: 11,
        hash: SCAN_HASH,
        printings: ['en|1|STOR-EN041|Ultra Rare', 'en|1|STOR-EN041|Secret Rare']
      }
    ])
  })

  it('names no overframe printing on the plain scan it fell back to', async () => {
    // STOR's overframe Ultra Rare has no scan of its own; the plain Super Rare one isn't of it.
    const plain = 'ShiEn-STOR-EN-SR-1E.png'
    const result = await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia([plain]),
      fetch: scans({ [plain]: png(SCAN) }),
      userAgent: 'test'
    })
    expect(result.entries).toEqual([{ imageId: 11, hash: SCAN_HASH, printings: [] }])
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
    expect(result.entries).toContainEqual({
      imageId: 11,
      hash: SCAN_HASH,
      printings: ['ja|1|Limit Over Collection: The Rivals|LOCR-JP016|Ultra Rare (Overframe)']
    })
  })

  it("files an uncoded printing under its set's prefix, from the set's coded printings", async () => {
    const add = work.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
       VALUES (1, 'Original Artwork Collection', ?, 'Ultra Rare', '', 'ja', ?)`
    )
    add.run('YAC1-JP006', null)
    add.run('', 'Manga-Style')
    const files = [...FILES, 'ShiEn-YAC1-JP-UR-MangaStyle-Color.png']
    const requested: string[] = []
    const fetch = scans({ 'ShiEn-YAC1-JP-UR-MangaStyle-Color.png': png(SCAN) }, requested)
    const result = await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia(files),
      fetch,
      userAgent: 'test'
    })
    expect(requested).toContain('ShiEn-YAC1-JP-UR-MangaStyle-Color.png')
    expect(result.entries).toContainEqual({
      imageId: 11,
      hash: SCAN_HASH,
      printings: ['ja|1|Original Artwork Collection||Ultra Rare']
    })
  })

  it('fetches the plain scan of a New artwork printing, and not of a plain reprint', async () => {
    const add = work.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
       VALUES (1, 'Limit Over Collection: The Rivals', ?, ?, '', 'ja', ?)`
    )
    add.run('LOCR-JP032', 'Ultra Rare', NEW_ART_VARIANT)
    add.run('LOCR-JP032', 'Secret Rare', NEW_ART_VARIANT)
    add.run('LOCR-JP039', 'Super Rare', null)
    const files = [
      ...FILES,
      'ShiEn-LOCR-JP-UR.png',
      'ShiEn-LOCR-JP-ScR.png',
      'ShiEn-LOCR-JP-SR.png',
      'ShiEn-LOCR-KR-UR.png'
    ]
    const requested: string[] = []
    const fetch = scans({ 'ShiEn-LOCR-JP-UR.png': png(SCAN) }, requested)
    const result = await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia(files),
      fetch,
      userAgent: 'test'
    })
    expect(requested).toEqual(
      expect.arrayContaining(['ShiEn-LOCR-JP-UR.png', 'ShiEn-LOCR-JP-ScR.png'])
    )
    expect(requested).not.toContain('ShiEn-LOCR-JP-SR.png')
    expect(requested).not.toContain('ShiEn-LOCR-KR-UR.png')
    expect(result.entries).toContainEqual({
      imageId: 11,
      hash: SCAN_HASH,
      printings: ['ja|1|Limit Over Collection: The Rivals|LOCR-JP032|Ultra Rare']
    })
  })

  it('looks a printing up again after three days when its gallery had no scan for it', async () => {
    // The gallery has the Starlight scan but none for the Overframe printing.
    const yugipedia = fakeYugipedia(['ShiEn-BLGG-EN-StR-1E.png'])
    const fetch = scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(SCAN) })
    let now = new Date('2026-01-01T00:00:00Z')
    const run = (): ReturnType<typeof buildReferences> =>
      buildReferences({ work, cache, yugipedia, fetch, userAgent: 'test', now: () => now })
    await run()
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(1)

    now = new Date('2026-01-03T00:00:00Z')
    await run()
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(1)

    now = new Date('2026-01-05T00:00:00Z')
    await run()
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(2)
  })

  it("takes a gallery titled with '(card)' when the plain one is missing", async () => {
    const yugipedia = fakeYugipedia()
    yugipedia.listPageImages.mockImplementation(
      async (titles: string[]) =>
        new Map(titles.filter((t) => t.endsWith(' (card)')).map((t) => [t, FILES]))
    )
    const fetch = scans({ 'ShiEn-BLGG-EN-StR-1E.png': png(SCAN) })
    const result = await buildReferences({ work, cache, yugipedia, fetch, userAgent: 'test' })
    expect(result.entries).toEqual([{ imageId: 11, hash: SCAN_HASH, printings: [] }])
    expect(yugipedia.listPageImages).toHaveBeenCalledTimes(2)
  })

  it('downloads a scan that failed again a month on', async () => {
    const yugipedia = fakeYugipedia()
    const requested: string[] = []
    const fetch = scans({}, requested)
    let now = new Date('2026-01-01T00:00:00Z')
    const run = (): ReturnType<typeof buildReferences> =>
      buildReferences({ work, cache, yugipedia, fetch, userAgent: 'test', now: () => now })
    await run()
    const first = requested.length
    expect(first).toBeGreaterThan(0)

    now = new Date('2026-01-20T00:00:00Z')
    await run()
    expect(requested).toHaveLength(first)

    now = new Date('2026-02-05T00:00:00Z')
    await run()
    expect(requested).toHaveLength(2 * first)
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

  it("downloads the newest set's scans first when there are more than maxDownloads", async () => {
    work
      .prepare(
        `INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES
           ('en', 'Gold Glory', 'BLGG', '2021-01-01'), ('en', 'Storm of Ragnarok', 'STOR', '2011-01-01'),
           ('ja', 'Original Artwork Collection', '', '2026-09-26')`
      )
      .run()
    work
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, language, variant)
         VALUES (1, 'Original Artwork Collection', 'YAC1-JP006', 'Ultra Rare', '', 'ja', 'Overframe')`
      )
      .run()
    const requested: string[] = []
    await buildReferences({
      work,
      cache,
      yugipedia: fakeYugipedia([...FILES, 'ShiEn-YAC1-JP-UR-EA.png']),
      fetch: scans({}, requested),
      userAgent: 'test',
      maxDownloads: 1
    })
    expect(requested).toEqual(['ShiEn-YAC1-JP-UR-EA.png'])
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

  it("writes a refs file naming the art variant scans' printings, and not the foils'", async () => {
    cache.close()
    const cachePath = join(dir, 'fingerprints.sqlite')
    const overframe = image(118, 172, 'y')
    const fetch = scans({
      'ShiEn-BLGG-EN-StR-1E.png': png(SCAN),
      'ShiEn-STOR-EN-UR-1E-EA.png': png(overframe)
    })
    const out = await buildFingerprints({
      work,
      cachePath,
      fetch: cardArt,
      references: { yugipedia: fakeYugipedia(), fetch, userAgent: 'test' }
    })
    expect(out.references.count).toBe(2)
    const file = parseFingerprintRefs(new TextDecoder().decode(out.refs))
    expect(file.refs).toEqual([
      {
        h: hashHex(scanHash(overframe, 'effect')!),
        imageId: expect.any(Number),
        printings: ['en|1|STOR-EN041|Ultra Rare']
      }
    ])
    cache = new Database(cachePath)
  })
})
