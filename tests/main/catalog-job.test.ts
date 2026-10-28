import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { refreshCatalog } from '../../src/main/sync/catalog'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import type { YugipediaClient } from '../../src/main/yugipedia/client'
import { CATALOG_TABLES, type CatalogTable } from '../../src/shared/catalogTables'
import { diffTable } from '../../scripts/catalog/diff'
import { uploadCatalog } from '../../scripts/catalog/upload'
import type { AccuracyReport } from '../../scripts/catalog/accuracy'
import { runJob } from '../../scripts/catalog/build'
import fixture from '../fixtures/cardinfo.sample.json'

const NOW = new Date('2026-10-23T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const URL_BASE = 'https://portal.example'
const TOKEN = 'secret-token'

const table = (name: string): CatalogTable => CATALOG_TABLES.find((t) => t.name === name)!

const SETS = [
  { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB', tcg_date: '2002-03-08' },
  { set_name: 'Starter Deck: Yugi', set_code: 'SDY', tcg_date: '2002-03-29' }
]

function fakeYgo(): { client: YgoClient; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    client: {
      fetchDbVersion: async () => {
        calls.push('fetchDbVersion')
        return { databaseVersion: '1.2', lastUpdate: '2026-10-22' }
      },
      fetchCardInfo: async () => {
        calls.push('fetchCardInfo')
        return fixture.data as ApiCard[]
      },
      fetchCardSets: async () => {
        calls.push('fetchCardSets')
        return SETS
      }
    }
  }
}

const LB = 'Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)'

function fakeYugipedia(): { client: YugipediaClient; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    client: {
      listSetListTitles: async () => {
        calls.push('listSetListTitles')
        return [LB]
      },
      fetchPages: async (titles) => {
        calls.push('fetchPages')
        return new Map(
          titles
            .filter((t) => t === LB)
            .map((t) => [t, '{{Set list|\nLB-05; Dark Magician; UR\n}}'])
        )
      },
      fetchImageUrls: async (files) => {
        calls.push('fetchImageUrls')
        return new Map(files.map((n) => [n, `https://ms.yugipedia.com/x/${n}`]))
      },
      listPageImages: async () => {
        calls.push('listPageImages')
        return new Map()
      }
    }
  }
}

/** TCGCSV, the Konami product listings and the Konami news list, as the refreshers fetch them. */
const webFetch = vi.fn(async (input: string | URL | Request): Promise<Response> => {
  const url = String(input)
  if (url.endsWith('/groups')) {
    return Response.json({ success: true, results: [{ groupId: 10, modifiedOn: 'a' }] })
  }
  if (url.endsWith('/10/products')) {
    return Response.json({
      success: true,
      results: [
        {
          productId: 1,
          name: 'Blue-Eyes White Dragon',
          imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg',
          extendedData: [
            { name: 'Number', value: 'LOB-EN005' },
            { name: 'Rarity', value: 'Ultra Rare' }
          ]
        }
      ]
    })
  }
  if (url.endsWith('/10/prices')) {
    return Response.json({
      success: true,
      results: [{ productId: 1, subTypeName: '1st Edition', marketPrice: 1234.5 }]
    })
  }
  if (url.startsWith('https://www.konami.com/')) {
    return new Response(
      `<script>x({data:${JSON.stringify({ api_name: 'topics', max_page: 1, list: [] })}});</script>`
    )
  }
  if (url.startsWith('https://www.yugioh-card.com/')) return new Response('<html></html>')
  return new Response('unexpected', { status: 404 })
})

const count = (db: Database.Database, t: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'catalog-job-'))
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  webFetch.mockClear()
  rmSync(dir, { recursive: true, force: true })
})

/** A file-backed work DB loaded with the fixture through the real sync path. */
async function workDb(): Promise<Database.Database> {
  const db = openDatabase(join(dir, 'work.sqlite'))
  await runSync(db, fakeYgo().client, () => {}, NOW)
  return db
}

/** Snapshots `work` to base.sqlite, the way the job advances its base. */
function snapshot(work: Database.Database): Database.Database {
  const path = join(dir, 'base.sqlite')
  work.prepare('VACUUM INTO ?').run(path)
  return openDatabase(path)
}

interface Call {
  path: string
  body: { table?: string; rows?: unknown[]; keys?: unknown[]; meta?: unknown }
  auth: string | null
}

function recordingFetch(respond: (call: Call, n: number) => Response): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      path: new URL(String(input)).pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      auth: new Headers(init?.headers).get('authorization')
    }
    calls.push(call)
    return respond(call, calls.length)
  }
  return { fetch: fn as typeof fetch, calls }
}

/** Card art isn't under test here: every image is missing, so only portal calls reach `fetch`. */
const noImages = (async () => new Response('', { status: 404 })) as typeof fetch

const ok = (): Response => Response.json({ ok: true })
/** An accuracy gate that passes, so jobs over the tiny fixture catalog upload their fingerprints. */
const passing = async (): Promise<AccuracyReport> => ({ shots: 1, right: 1, wrong: [], missed: [] })

describe('refreshCatalog', () => {
  it('refreshCatalog runs the same steps desktop startup ran', async () => {
    vi.stubGlobal('fetch', webFetch)
    const db = openDatabase(':memory:')
    const ygo = fakeYgo()
    const wiki = fakeYugipedia()
    const onChanged = vi.fn()
    const progress: string[] = []

    const first = await refreshCatalog(db, {
      client: ygo.client,
      yugipedia: wiki.client,
      version: '0.0.0-test',
      now: () => NOW,
      onSyncProgress: (s) => progress.push(s.state),
      onChanged
    })

    expect(first).toEqual({ changed: true })
    expect(progress.at(-1)).toBe('idle')
    expect(count(db, 'cards')).toBe(3)
    expect(
      db.prepare("SELECT set_name FROM sets WHERE language = 'en' ORDER BY set_name").pluck().all()
    ).toEqual(SETS.map((s) => s.set_name))
    expect(count(db, "card_printings WHERE language = 'ja'")).toBe(1)
    expect(count(db, 'tcgplayer_groups')).toBe(1)
    for (const key of [
      'last_sync_at',
      'tcgplayer_synced_at',
      'pack_art_synced_at',
      'set_logos_synced_at',
      'konami_logos_synced_at',
      'intl_sets_synced_at'
    ] as const) {
      expect(getMeta(db, key), key).toBe(NOW.toISOString())
    }
    expect(onChanged).toHaveBeenCalled()

    const calls = [ygo.calls.length, wiki.calls.length, webFetch.mock.calls.length]
    const second = await refreshCatalog(db, {
      client: ygo.client,
      yugipedia: wiki.client,
      version: '0.0.0-test',
      now: () => new Date(NOW.getTime() + HOUR)
    })
    expect(second).toEqual({ changed: false })
    expect([ygo.calls.length, wiki.calls.length, webFetch.mock.calls.length]).toEqual(calls)
    db.close()
  })
  it('the nightly job keeps TCGplayer prices for every set and matches them to printings', async () => {
    vi.stubGlobal('fetch', webFetch)
    const db = openDatabase(':memory:')
    const deps = {
      client: fakeYgo().client,
      yugipedia: fakeYugipedia().client,
      version: '0.0.0-test',
      now: () => NOW
    }
    await refreshCatalog(db, deps)
    // Desktop (owned scope) with nothing owned fetches no prices.
    expect(webFetch.mock.calls.some(([u]) => String(u).endsWith('/prices'))).toBe(false)
    await refreshCatalog(db, { ...deps, tcgPrices: 'all' })
    expect(
      db
        .prepare("SELECT market_price FROM card_printings WHERE set_code = 'LOB-EN005'")
        .pluck()
        .get()
    ).toBe(1234.5)
    db.close()
  })
  it('without a fixed clock, the TCGplayer catalog is stamped when it finishes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const later = new Date(NOW.getTime() + 60_000)
    vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
      if (String(input).endsWith('/10/products')) vi.setSystemTime(later)
      return webFetch(input)
    })
    const db = openDatabase(':memory:')
    await refreshCatalog(db, {
      client: fakeYgo().client,
      yugipedia: fakeYugipedia().client,
      version: '0.0.0-test'
    })
    expect(getMeta(db, 'last_sync_at')).toBe(NOW.toISOString())
    expect(getMeta(db, 'tcgplayer_synced_at')).toBe(later.toISOString())
    db.close()
  })
})

describe('diffTable', () => {
  it('diff with no base uploads everything', async () => {
    const work = await workDb()
    for (const t of CATALOG_TABLES) {
      const d = diffTable(work, null, t)
      expect(d.upserts, t.name).toHaveLength(count(work, t.name))
      expect(d.deletes, t.name).toEqual([])
    }
    const printing = diffTable(work, null, table('card_printings')).upserts[0]
    expect(Object.keys(printing).sort()).toEqual([...table('card_printings').columns].sort())
    work.close()
  })

  it('diff sends only changed rows and deletions', async () => {
    const work = await workDb()
    const base = snapshot(work)
    work.prepare("UPDATE card_printings SET set_price = 99.5 WHERE set_code = 'LOB-EN005'").run()
    work.prepare("DELETE FROM sets WHERE language = 'en' AND set_name = 'Starter Deck: Yugi'").run()

    const printings = diffTable(work, base, table('card_printings'))
    expect(printings.deletes).toEqual([])
    expect(printings.upserts).toHaveLength(1)
    expect(printings.upserts[0]).toMatchObject({
      set_code: 'LOB-EN005',
      set_price: 99.5,
      language: 'en'
    })
    expect(printings.upserts[0]).not.toHaveProperty('id')
    expect(printings.upserts[0]).not.toHaveProperty('pkey')

    expect(diffTable(work, base, table('sets'))).toEqual({
      upserts: [],
      deletes: [['en', 'Starter Deck: Yugi']]
    })
    for (const t of CATALOG_TABLES.filter((x) => !['card_printings', 'sets'].includes(x.name))) {
      expect(diffTable(work, base, t), t.name).toEqual({ upserts: [], deletes: [] })
    }
    // The work connection is left as it was found.
    expect(work.prepare('PRAGMA database_list').all()).not.toContainEqual(
      expect.objectContaining({ name: 'base' })
    )
    base.close()
    work.close()
  })
})

describe('uploadCatalog', () => {
  it('upload batches, retries a 503 then succeeds', async () => {
    const work = openDatabase(join(dir, 'work.sqlite'))
    const insert = work.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, ?, 'Spell Card', 'spell', 'Normal', '', 'x')`
    )
    work.transaction(() => {
      for (let i = 1; i <= 2001; i++) insert.run(i, `Card ${i}`)
    })()
    setMeta(work, 'db_version', '9.9')
    setMeta(work, 'last_sync_at', NOW.toISOString())

    let failed = false
    const { fetch, calls } = recordingFetch(() => {
      if (!failed) {
        failed = true
        return new Response('busy', { status: 503 })
      }
      return ok()
    })
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const result = uploadCatalog({ url: URL_BASE, token: TOKEN, work, base: null, fetch })
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ upserted: 2001, deleted: 0 })

    expect(
      calls.map((c) => `${c.path} ${c.body.table ?? ''} ${c.body.rows?.length ?? ''}`)
    ).toEqual([
      '/admin/catalog/rows cards 2000',
      '/admin/catalog/rows cards 2000',
      '/admin/catalog/rows cards 1',
      '/admin/catalog/finish  '
    ])
    expect(calls.at(-1)!.body.meta).toEqual({ db_version: '9.9', last_sync_at: NOW.toISOString() })
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true)
    work.close()
  })

  it('sends deletions before upserts', async () => {
    const work = await workDb()
    const base = snapshot(work)
    work.prepare("UPDATE card_printings SET set_price = 99.5 WHERE set_code = 'LOB-EN005'").run()
    work.prepare("DELETE FROM sets WHERE language = 'en' AND set_name = 'Starter Deck: Yugi'").run()
    const { fetch, calls } = recordingFetch(ok)
    expect(await uploadCatalog({ url: URL_BASE, token: TOKEN, work, base, fetch })).toEqual({
      upserted: 1,
      deleted: 1
    })
    expect(calls.map((c) => `${c.path} ${c.body.table ?? ''}`)).toEqual([
      '/admin/catalog/delete sets',
      '/admin/catalog/rows card_printings',
      '/admin/catalog/finish '
    ])
    base.close()
    work.close()
  })

  it('does not retry a 400', async () => {
    const work = await workDb()
    const { fetch, calls } = recordingFetch(() =>
      Response.json({ error: 'Unknown column x' }, { status: 400 })
    )
    await expect(
      uploadCatalog({ url: URL_BASE, token: TOKEN, work, base: null, fetch })
    ).rejects.toThrow(/400/)
    expect(calls).toHaveLength(1)
    work.close()
  })

  it('failed upload leaves base untouched', async () => {
    const work = await workDb()
    const { fetch, calls } = recordingFetch(() => new Response('down', { status: 500 }))
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const upload = expect(
      uploadCatalog({ url: URL_BASE, token: TOKEN, work, base: null, fetch })
    ).rejects.toThrow(/500/)
    await vi.runAllTimersAsync()
    await upload
    expect(calls).toHaveLength(4) // the first try and three retries

    snapshot(work).close()
    work.prepare("UPDATE card_printings SET set_price = 99.5 WHERE set_code = 'LOB-EN005'").run()
    work.close()

    const job = expect(
      runJob({
        dir,
        url: URL_BASE,
        token: TOKEN,
        fetch,
        imageFetch: noImages,
        checkAccuracy: passing,
        refresh: async () => {},
        log: () => {}
      })
    ).rejects.toThrow(/500/)
    await vi.runAllTimersAsync()
    await job

    const base = openDatabase(join(dir, 'base.sqlite'))
    expect(
      base
        .prepare("SELECT set_price FROM card_printings WHERE set_code = 'LOB-EN005'")
        .pluck()
        .get()
    ).not.toBe(99.5)
    base.close()
    expect(readdirSync(dir).filter((f) => f.includes('tmp'))).toEqual([])
  })

  it('a successful job advances base to the uploaded work', async () => {
    ;(await workDb()).close()
    const { fetch, calls } = recordingFetch(ok)
    await runJob({
      dir,
      url: URL_BASE,
      token: TOKEN,
      fetch,
      imageFetch: noImages,
      checkAccuracy: passing,
      refresh: async () => {},
      log: () => {}
    })
    expect(calls.map((c) => c.path).slice(-2)).toEqual([
      '/admin/catalog/finish',
      '/admin/scan/fingerprints'
    ])
    expect(existsSync(join(dir, 'base.sqlite'))).toBe(true)

    const work = openDatabase(join(dir, 'work.sqlite'))
    const base = openDatabase(join(dir, 'base.sqlite'))
    for (const t of CATALOG_TABLES) {
      expect(diffTable(work, base, t), t.name).toEqual({ upserts: [], deletes: [] })
    }
    base.close()
    work.close()
  })

  it('a failing fingerprint upload is logged and the catalog base still advances', async () => {
    ;(await workDb()).close()
    const { fetch } = recordingFetch((call) =>
      call.path === '/admin/scan/fingerprints' ? new Response('', { status: 404 }) : ok()
    )
    const { problems } = await runJob({
      dir,
      url: URL_BASE,
      token: TOKEN,
      fetch,
      imageFetch: noImages,
      checkAccuracy: passing,
      refresh: async () => {},
      log: () => {}
    })
    expect(existsSync(join(dir, 'base.sqlite'))).toBe(true)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^Fingerprints failed: .*404/)
  })

  it('a fingerprint file that fails the accuracy gate is held back, and the catalog still uploads', async () => {
    ;(await workDb()).close()
    const { fetch, calls } = recordingFetch(ok)
    const { problems } = await runJob({
      dir,
      url: URL_BASE,
      token: TOKEN,
      fetch,
      imageFetch: noImages,
      checkAccuracy: async () => ({
        shots: 2,
        right: 1,
        wrong: ['1.jpg (Dark Magician) as Dark Magician Girl (38033121)'],
        missed: []
      }),
      refresh: async () => {},
      log: () => {}
    })
    expect(calls.map((c) => c.path)).toContain('/admin/catalog/finish')
    expect(calls.map((c) => c.path)).not.toContain('/admin/scan/fingerprints')
    expect(existsSync(join(dir, 'base.sqlite'))).toBe(true)
    expect(problems).toEqual([
      'Fingerprints held back: took 1 shot(s) for the wrong card: 1.jpg (Dark Magician) as Dark Magician Girl (38033121)'
    ])
  })

  it('a failed card sync is reported as a problem without stopping the upload', async () => {
    ;(await workDb()).close()
    const { fetch, calls } = recordingFetch(ok)
    const { problems } = await runJob({
      dir,
      url: URL_BASE,
      token: TOKEN,
      fetch,
      imageFetch: noImages,
      checkAccuracy: passing,
      refresh: async (_work, onProblem) => onProblem('Card sync failed: HTTP 500'),
      log: () => {}
    })
    expect(problems).toEqual(['Card sync failed: HTTP 500'])
    expect(calls.some((c) => c.path === '/admin/catalog/finish')).toBe(true)
  })

  it('refuses to upload a refresh that deletes a large share of a table', async () => {
    const work = await workDb()
    const group = work.prepare(
      "INSERT INTO tcgplayer_groups (group_id, modified_on, name) VALUES (?, 'a', ?)"
    )
    for (let i = 0; i < 200; i++) group.run(1000 + i, `Group ${i}`)
    snapshot(work).close()
    work.prepare('DELETE FROM tcgplayer_groups WHERE group_id >= 1100').run()
    work.close()

    const { fetch, calls } = recordingFetch(ok)
    const job = {
      dir,
      url: URL_BASE,
      token: TOKEN,
      fetch,
      imageFetch: noImages,
      checkAccuracy: passing,
      log: () => {}
    }
    await expect(runJob({ ...job, refresh: async () => {} })).rejects.toThrow(
      /tcgplayer_groups would lose 100 of 200 rows/
    )
    expect(calls).toEqual([])

    const out = await runJob({ ...job, refresh: async () => {}, allowShrink: true })
    expect(out.uploaded?.deleted).toBe(100)
  })

  it('a small, ordinary shrink uploads without the override', async () => {
    const work = await workDb()
    const group = work.prepare(
      "INSERT INTO tcgplayer_groups (group_id, modified_on, name) VALUES (?, 'a', ?)"
    )
    for (let i = 0; i < 200; i++) group.run(1000 + i, `Group ${i}`)
    snapshot(work).close()
    work.prepare('DELETE FROM tcgplayer_groups WHERE group_id >= 1190').run()
    work.close()

    const { fetch } = recordingFetch(ok)
    const out = await runJob({
      dir,
      url: URL_BASE,
      token: TOKEN,
      fetch,
      imageFetch: noImages,
      checkAccuracy: passing,
      refresh: async () => {},
      log: () => {}
    })
    expect(out.uploaded?.deleted).toBe(10)
  })

  it('a dry run counts changes without uploading or writing base', async () => {
    ;(await workDb()).close()
    const { fetch, calls } = recordingFetch(ok)
    const out = await runJob({
      dir,
      dryRun: true,
      fetch,
      imageFetch: noImages,
      checkAccuracy: passing,
      refresh: async () => {},
      log: () => {}
    })
    expect(out.counts?.cards).toEqual({ upserts: 3, deletes: 0 })
    expect(calls).toEqual([])
    expect(existsSync(join(dir, 'base.sqlite'))).toBe(false)
  })
})
