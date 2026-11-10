import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logMagicSymbols, runMagicStep } from '../../scripts/catalog/magic'
import { mtgRows } from '../../scripts/catalog/magic/rows'
import { isKept, parseBulkLines } from '../../scripts/catalog/magic/scryfall'
import { syncMagicSymbols, whiteSymbolPng } from '../../scripts/catalog/magic/symbols'
import type { ScryCard, ScrySet, ScryfallSource } from '../../scripts/catalog/magic/types'
import { writeMagic } from '../../scripts/catalog/magic/write'
import { openDatabase } from '../../src/main/db/database'
import { MAX_SYMBOL_PNG_BYTES, mtgSymbolKey } from '../../src/shared/imageSources'

const SYM = 'https://svgs.scryfall.io/sets/'
/** Left half drawn (in red, to show the colour is replaced), right half empty. */
const HALF =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="10" fill="#c00"/></svg>'

async function* lines(text: string): AsyncIterable<string> {
  for (const l of text.split('\n')) yield l
}
const OBJECTS: ScryCard[] = []
let SETS: ScrySet[] = []

let dir: string
let db: Database.Database

beforeEach(async () => {
  if (OBJECTS.length === 0) {
    for await (const c of parseBulkLines(
      lines(readFileSync('tests/fixtures/scryfall/default-cards.sample.json', 'utf8'))
    ))
      if (isKept(c)) OBJECTS.push(c)
    SETS = (
      JSON.parse(readFileSync('tests/fixtures/scryfall/sets.sample.json', 'utf8')) as {
        data: ScrySet[]
      }
    ).data
  }
  dir = mkdtempSync(join(tmpdir(), 'mtg-symbols-'))
  db = openDatabase(join(dir, 'work.sqlite'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** The fixture's sets, MH3 and its tokens with MH3's symbol, everything else with Scryfall's star. */
const withSymbols = (version = '1700000000'): ScrySet[] =>
  SETS.map((s) => ({
    ...s,
    icon_svg_uri: ['mh3', 'tmh3'].includes(s.code)
      ? `${SYM}mh3.svg?${version}`
      : `${SYM}star.svg?${version}`
  }))

const write = (sets: ScrySet[]): void => {
  writeMagic(db, mtgRows(OBJECTS, sets), {
    now: 0,
    nowIso: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10'
  })
}
const setArt = (): { set_code: string; image_url: string | null; image_key: string | null }[] =>
  db
    .prepare(
      "SELECT set_code, image_url, image_key FROM sets WHERE game = 'mtg' AND language = 'en' ORDER BY set_code"
    )
    .all() as { set_code: string; image_url: string | null; image_key: string | null }[]

describe('mtgSymbolKey', () => {
  it('one key per symbol and version; placeholders and other hosts have none', () => {
    expect(mtgSymbolKey(`${SYM}dsk.svg?1794200400`)).toBe('ms-dsk-1794200400')
    expect(mtgSymbolKey(`${SYM}dci.svg?1794200400`)).toBe('ms-dci-1794200400')
    expect(mtgSymbolKey(`${SYM}dsk.svg`)).toBe('ms-dsk')
    for (const url of [
      `${SYM}star.svg?1`,
      `${SYM}default.svg?1`,
      'https://evil.example/sets/dsk.svg?1',
      `${SYM}../x.svg?1`,
      `${SYM}dsk.svg?1&x=2`,
      `${SYM}dsk.png?1`,
      null,
      undefined,
      ''
    ])
      expect(mtgSymbolKey(url)).toBeNull()
  })
})

describe('whiteSymbolPng', () => {
  it('draws the symbol white over transparency, at the asked height', () => {
    const img = PNG.sync.read(Buffer.from(whiteSymbolPng(HALF, 16)))
    expect([img.width, img.height]).toEqual([16, 16])
    const px = (x: number, y: number): number[] => [
      ...img.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)
    ]
    expect(px(1, 8)).toEqual([255, 255, 255, 255])
    expect(px(14, 8)[3]).toBe(0)
  })

  it('throws on anything that is not an SVG document', () => {
    expect(() => whiteSymbolPng('<html></html>')).toThrow('not an SVG')
    expect(() => whiteSymbolPng('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow('not an SVG')
  })
})

describe('Magic set symbol rows', () => {
  it('a set shows its symbol (a borrowed one too) in every language; a placeholder shows none', () => {
    const rows = mtgRows(OBJECTS, withSymbols())
    expect(rows.sets.get('en|MH3')).toMatchObject({
      symbolUrl: `${SYM}mh3.svg?1700000000`,
      symbolKey: 'ms-mh3-1700000000'
    })
    expect(rows.sets.get('en|TMH3')?.symbolKey).toBe('ms-mh3-1700000000')
    expect(rows.sets.get('en|CMR')).toMatchObject({ symbolUrl: null, symbolKey: null })
    for (const [key, s] of rows.sets)
      if (key.endsWith('|MH3')) expect(s.symbolKey).toBe('ms-mh3-1700000000')
  })

  it('written to sets, shared by key, and moved to a redrawn symbol', () => {
    write(withSymbols())
    const art = setArt()
    expect(art.find((s) => s.set_code === 'MH3')).toEqual({
      set_code: 'MH3',
      image_url: `${SYM}mh3.svg?1700000000`,
      image_key: 'ms-mh3-1700000000'
    })
    expect(art.find((s) => s.set_code === 'TMH3')?.image_key).toBe('ms-mh3-1700000000')
    expect(art.find((s) => s.set_code === 'CMR')?.image_key).toBeNull()

    write(withSymbols('1800000000'))
    expect(setArt().find((s) => s.set_code === 'MH3')?.image_key).toBe('ms-mh3-1800000000')
    // A symbol Scryfall drops for a placeholder goes too.
    write(SETS.map((s) => ({ ...s, icon_svg_uri: `${SYM}default.svg?1` })))
    expect(setArt().every((s) => s.image_key === null && s.image_url === null)).toBe(true)
  })
})

/** A fake portal: R2 as a map, with the two symbol routes. */
function fakePortal(held: string[] = []): {
  fetch: typeof fetch
  r2: Map<string, Uint8Array>
  asked: string[][]
} {
  const r2 = new Map<string, Uint8Array>(held.map((k) => [k, new Uint8Array([1])]))
  const asked: string[][] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
    if (url === 'https://portal.test/admin/img/set-symbols/missing') {
      const { keys } = JSON.parse(String(init!.body)) as { keys: string[] }
      asked.push(keys)
      return Response.json({ missing: keys.filter((k) => !r2.has(k)) })
    }
    const key = url.slice('https://portal.test/admin/img/set-symbols/'.length)
    r2.set(key, init!.body as Uint8Array)
    return Response.json({ result: 'stored' })
  })
  return { fetch: fetchFn as unknown as typeof fetch, r2, asked }
}

const addSet = (name: string, code: string, url: string | null, language = 'en'): void => {
  db.prepare(
    "INSERT INTO sets (game, language, set_name, set_code, image_url, image_key) VALUES ('mtg', ?, ?, ?, ?, ?)"
  ).run(language, name, code, url, mtgSymbolKey(url))
}

describe('syncMagicSymbols', () => {
  const sync = (
    portal: ReturnType<typeof fakePortal>,
    svg: (url: string) => Promise<string>,
    rasterize?: (svg: string) => Uint8Array
  ): ReturnType<typeof syncMagicSymbols> =>
    syncMagicSymbols(db, {
      portal: { url: 'https://portal.test/', token: 'tok', fetch: portal.fetch },
      svg,
      rasterize
    })

  it('uploads only the symbols R2 lacks, each once however many sets show it', async () => {
    addSet('Modern Horizons 3', 'MH3', `${SYM}mh3.svg?1`)
    addSet('Modern Horizons 3 Tokens', 'TMH3', `${SYM}mh3.svg?1`)
    addSet('Modern Horizons 3', 'MH3', `${SYM}mh3.svg?1`, 'ja')
    addSet('Limited Edition Alpha', 'LEA', `${SYM}lea.svg?1`)
    addSet('Promos', 'PX', null)
    db.prepare(
      "INSERT INTO sets (game, language, set_name, set_code, image_url, image_key) VALUES ('op', 'en', 'OP', 'OP01', 'x', 'ob-x')"
    ).run()
    const portal = fakePortal(['ms-lea-1'])
    const svg = vi.fn(async () => HALF)
    const r = await sync(portal, svg)
    expect(r).toEqual({ inUse: 2, stored: 1, uploaded: 1, failed: 0, notes: [] })
    expect(portal.asked).toEqual([['ms-lea-1', 'ms-mh3-1']])
    expect(svg.mock.calls).toEqual([[`${SYM}mh3.svg?1`]])
    const png = portal.r2.get('ms-mh3-1')!
    expect(PNG.sync.read(Buffer.from(png)).height).toBe(256)

    // The next night: nothing new, nothing fetched.
    svg.mockClear()
    expect(await sync(portal, svg)).toMatchObject({ inUse: 2, stored: 2, uploaded: 0, failed: 0 })
    expect(svg).not.toHaveBeenCalled()
  })

  it('asks about at most 100 keys at a time', async () => {
    for (let i = 0; i < 101; i++) addSet(`Set ${i}`, `S${i}`, `${SYM}s${i}.svg?1`)
    const portal = fakePortal(Array.from({ length: 101 }, (_, i) => `ms-s${i}-1`))
    const r = await sync(portal, async () => HALF)
    expect(portal.asked.map((k) => k.length)).toEqual([100, 1])
    expect(r).toMatchObject({ inUse: 101, stored: 101, uploaded: 0 })
  })

  it('a failed symbol is noted, the rest still go up, and nothing throws', async () => {
    addSet('A', 'A', `${SYM}aaa.svg?1`)
    addSet('B', 'B', `${SYM}bbb.svg?1`)
    addSet('C', 'C', `${SYM}ccc.svg?1`)
    const portal = fakePortal()
    const r = await sync(portal, async (url) => {
      if (url.includes('aaa')) throw new Error('GET returned 503')
      return url.includes('bbb') ? '<html>' : HALF
    })
    expect(r.uploaded).toBe(1)
    expect(r.failed).toBe(2)
    expect(r.notes).toEqual(['ms-aaa-1: GET returned 503', 'ms-bbb-1: not an SVG document'])
    expect([...portal.r2.keys()]).toEqual(['ms-ccc-1'])
  })

  it('an oversized PNG is not sent', async () => {
    addSet('A', 'A', `${SYM}aaa.svg?1`)
    const portal = fakePortal()
    const r = await sync(
      portal,
      async () => HALF,
      () => new Uint8Array(MAX_SYMBOL_PNG_BYTES + 1)
    )
    expect(r).toMatchObject({ uploaded: 0, failed: 1 })
    expect(portal.r2.size).toBe(0)
  })

  it('a portal that cannot say what it holds fails the batch, not the night', async () => {
    addSet('A', 'A', `${SYM}aaa.svg?1`)
    const svg = vi.fn(async () => HALF)
    const r = await syncMagicSymbols(db, {
      portal: {
        url: 'https://portal.test',
        token: 'tok',
        fetch: (async () => new Response('down', { status: 502 })) as unknown as typeof fetch
      },
      svg
    })
    expect(r).toEqual({
      inUse: 1,
      stored: 0,
      uploaded: 0,
      failed: 1,
      notes: ['ms-aaa-1: not checked (portal returned 502)']
    })
    expect(svg).not.toHaveBeenCalled()
  })

  it('logs a line, then each failure', () => {
    const log: string[] = []
    logMagicSymbols({ inUse: 3, stored: 1, uploaded: 1, failed: 1, notes: ['ms-a-1: boom'] }, (l) =>
      log.push(l)
    )
    expect(log).toEqual([
      'Magic set symbols: 3 in use, 1 already stored, 1 uploaded, 1 failed',
      'Magic set symbol failed: ms-a-1: boom'
    ])
  })
})

describe('runMagicStep and symbols', () => {
  const source = (sets: ScrySet[], svg: (url: string) => Promise<string>): ScryfallSource => ({
    bulkInfo: async () => ({
      downloadUri: 'https://x/bulk.json',
      updatedAt: '2026-11-10T09:00:00Z'
    }),
    async *cards() {
      yield* OBJECTS
    },
    sets: async () => sets,
    symbolSvg: svg
  })

  it('uploads tonight’s symbols through the source once the rows are written', async () => {
    const portal = fakePortal()
    const svg = vi.fn(async () => HALF)
    const out = await runMagicStep(db, {
      cachePath: join(dir, 'magic-src.sqlite'),
      version: 'test',
      log: () => {},
      source: source(withSymbols(), svg),
      portal: { url: 'https://portal.test', token: 'tok', fetch: portal.fetch }
    })
    expect(out.error).toBeNull()
    expect(out.problems).toEqual([])
    expect(out.symbols).toMatchObject({ inUse: 1, uploaded: 1, failed: 0 })
    expect(svg.mock.calls).toEqual([[`${SYM}mh3.svg?1700000000`]])
    expect([...portal.r2.keys()]).toEqual(['ms-mh3-1700000000'])
  })

  it('a symbol failure is no problem and no error', async () => {
    const portal = fakePortal()
    const out = await runMagicStep(db, {
      cachePath: join(dir, 'magic-src.sqlite'),
      version: 'test',
      log: () => {},
      source: source(withSymbols(), async () => {
        throw new Error('Scryfall down')
      }),
      portal: { url: 'https://portal.test', token: 'tok', fetch: portal.fetch }
    })
    expect(out.error).toBeNull()
    expect(out.problems).toEqual([])
    expect(out.symbols).toMatchObject({ uploaded: 0, failed: 1 })
    expect(out.report?.sets).toBeGreaterThan(0)
  })

  it('fetches no symbol without a portal (a dry run)', async () => {
    const svg = vi.fn(async () => HALF)
    const out = await runMagicStep(db, {
      cachePath: join(dir, 'magic-src.sqlite'),
      version: 'test',
      log: () => {},
      source: source(withSymbols(), svg)
    })
    expect(out.error).toBeNull()
    expect(out.symbols).toBeNull()
    expect(svg).not.toHaveBeenCalled()
  })
})
