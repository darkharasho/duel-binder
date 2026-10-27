import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import type { PushResult, WireEntry } from '../../src/shared/cloud'
import {
  CONTRIBUTE_DAILY_CAP,
  MAX_CONTRIBUTE,
  type CatalogChangesResponse,
  type ContributeResult,
  type ContributedPrinting
} from '../../src/shared/catalogFeed'
import { addUser, seededServerDb, memoryBucket, noPrintingArt } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const ALICE = 'Bearer alice-desktop-token'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('POST /api/catalog/contribute', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number
  let cardId: number
  let imageId: number

  const session = (userId: number, token: string, kind: 'web' | 'desktop'): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex(token),
      userId,
      kind,
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }
  const printing = (over: Partial<ContributedPrinting> = {}): ContributedPrinting => ({
    card_id: cardId,
    set_name: 'Desktop Only Set',
    set_code: 'DESK-EN001',
    set_rarity: 'Rare',
    set_rarity_code: '(R)',
    language: 'en',
    variant: null,
    tcg_product_id: null,
    ...over
  })
  const post = (body: unknown, auth: string | null = ALICE, raw = false): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/catalog/contribute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: raw ? (body as string) : JSON.stringify(body)
      }),
      deps
    )
  const contribute = async (printings: unknown[]): Promise<ContributeResult[]> => {
    const res = await post({ printings })
    expect(res.status).toBe(200)
    return ((await res.json()) as { results: ContributeResult[] }).results
  }
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    session(alice, 'alice-desktop-token', 'desktop')
    session(alice, 'alice-web-token', 'web')
    const first = db
      .prepare(
        `SELECT card_id AS cardId,
           (SELECT image_id FROM card_images i WHERE i.card_id = p.card_id ORDER BY sort_order LIMIT 1) AS imageId
         FROM card_printings p ORDER BY card_id, id LIMIT 1`
      )
      .get() as { cardId: number; imageId: number }
    cardId = first.cardId
    imageId = first.imageId
    deps = {
      db,
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: { soon: async () => {} },
      env: {},
      now: () => NOW,
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch
    } as unknown as AppDeps
  })

  it('adds an unknown printing as contributed and a push for it then applies', async () => {
    const pkey = `en|${cardId}|DESK-EN001|Rare`
    const e: WireEntry = {
      uid: crypto.randomUUID(),
      pkey,
      imageId,
      quantity: 1,
      notes: '',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      deletedAt: null
    }
    const push = async (): Promise<PushResult[]> => {
      const res = await handle(
        new Request(`${BASE}/api/sync/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: ALICE },
          body: JSON.stringify({ entries: [e] })
        }),
        deps
      )
      expect(res.status).toBe(200)
      return ((await res.json()) as { results: PushResult[] }).results
    }
    expect(await push()).toEqual([{ uid: e.uid, status: 'unknown-printing' }])
    expect(await contribute([printing()])).toEqual([{ pkey, status: 'added' }])
    expect(await push()).toEqual([{ uid: e.uid, status: 'applied' }])
    const row = db
      .prepare('SELECT contributed, missing_from_api AS m FROM card_printings WHERE pkey = ?')
      .get(pkey)
    expect(row).toEqual({ contributed: 1, m: 0 })
    expect(
      db
        .prepare(
          `SELECT c.user_id AS u, c.created_at AS t FROM printing_contributions c
           JOIN card_printings p ON p.id = c.printing_id WHERE p.pkey = ?`
        )
        .get(pkey)
    ).toEqual({ u: alice, t: NOW.toISOString() })
  })

  it('computes non-English pkeys server-side', async () => {
    const r = await contribute([printing({ language: 'ja', set_code: 'DESK-JP001' })])
    expect(r).toEqual([{ pkey: `ja|${cardId}|Desktop Only Set|DESK-JP001|Rare`, status: 'added' }])
  })

  it('answers exists for a pkey the catalog has', async () => {
    const p = db
      .prepare('SELECT * FROM card_printings ORDER BY id LIMIT 1')
      .get() as Record<string, string | number>
    const before = count('SELECT count(*) AS n FROM card_printings')
    const r = await contribute([
      printing({
        card_id: p.card_id as number,
        set_name: p.set_name as string,
        set_code: p.set_code as string,
        set_rarity: p.set_rarity as string,
        language: p.language as string
      })
    ])
    expect(r).toEqual([{ pkey: p.pkey, status: 'exists' }])
    expect(count('SELECT count(*) AS n FROM card_printings')).toBe(before)
    expect(count('SELECT count(*) AS n FROM printing_contributions')).toBe(0)
  })

  it('rejects an unknown card, a bad language and oversized fields', async () => {
    const r = await contribute([
      printing({ card_id: 987654321 }),
      printing({ language: 'xx' }),
      printing({ set_name: 'x'.repeat(201) }),
      printing({ set_code: '' }),
      printing({ set_rarity: 5 as unknown as string }),
      printing({ set_rarity_code: 'x'.repeat(201) }),
      printing({ variant: 3 as unknown as string }),
      printing({ tcg_product_id: 1.5 }),
      printing({ tcg_product_id: 0 }),
      printing({ card_id: 'a' as unknown as number }),
      null
    ])
    expect(r.map((x) => [x.status, x.reason])).toEqual([
      ['rejected', 'unknown-card'],
      ['rejected', 'bad-language'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field'],
      ['rejected', 'bad-field']
    ])
    expect(r[10].pkey).toBe('')
    expect(count('SELECT count(*) AS n FROM printing_contributions')).toBe(0)
  })

  it('rejects a pipe, control characters and untrimmed or blank text in the text fields', async () => {
    const fields = ['set_name', 'set_code', 'set_rarity', 'set_rarity_code', 'variant'] as const
    const bad = ['A|B', 'A\u0000B', 'A\nB', 'A\u007fB', 'A\u0085B', ' A', 'A ', '   ', '']
    const rows = fields.flatMap((f) => bad.map((v) => printing({ [f]: v })))
    const r = await contribute(rows)
    expect(r.map((x) => [x.status, x.reason])).toEqual(rows.map(() => ['rejected', 'bad-field']))
    expect(count('SELECT count(*) AS n FROM printing_contributions')).toBe(0)
    // Null optional fields are still fine.
    expect((await contribute([printing({ set_rarity_code: null, variant: null })]))[0].status).toBe('added')
  })

  it('one bad row does not stop the others; a repeated pkey in one request is exists', async () => {
    const r = await contribute([printing(), printing({ language: 'xx' }), printing()])
    expect(r.map((x) => x.status)).toEqual(['added', 'rejected', 'exists'])
    expect(count('SELECT count(*) AS n FROM printing_contributions')).toBe(1)
  })

  it('stops at the daily cap', async () => {
    const seed = db.prepare(
      'INSERT INTO printing_contributions (printing_id, user_id, created_at) VALUES (?, ?, ?)'
    )
    // Contributions need distinct printings; add synthetic rows to hold them.
    const ins = db.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, missing_from_api, contributed)
       VALUES (?, 'Seed', ?, 'Common', 'en', 0, 1)`
    )
    const old = new Date(NOW.getTime() - 3_600_000).toISOString()
    db.transaction(() => {
      for (let i = 0; i < CONTRIBUTE_DAILY_CAP; i++)
        seed.run(Number(ins.run(cardId, `SEED-${i}`).lastInsertRowid), alice, old)
    })()
    expect(await contribute([printing()])).toEqual([
      {
        pkey: `en|${cardId}|DESK-EN001|Rare`,
        status: 'rejected',
        reason: 'daily-limit'
      }
    ])
  })

  it('counts only the last 24 hours, and one request cannot overshoot the cap', async () => {
    const seed = db.prepare(
      'INSERT INTO printing_contributions (printing_id, user_id, created_at) VALUES (?, ?, ?)'
    )
    const ins = db.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, missing_from_api, contributed)
       VALUES (?, 'Seed', ?, 'Common', 'en', 0, 1)`
    )
    const stale = new Date(NOW.getTime() - 25 * 3_600_000).toISOString()
    const recent = new Date(NOW.getTime() - 3_600_000).toISOString()
    db.transaction(() => {
      // 1999 inside the window plus 5 outside it: exactly one slot is left.
      for (let i = 0; i < CONTRIBUTE_DAILY_CAP + 4; i++)
        seed.run(
          Number(ins.run(cardId, `SEED-${i}`).lastInsertRowid),
          alice,
          i < CONTRIBUTE_DAILY_CAP - 1 ? recent : stale
        )
    })()
    const r = await contribute([printing({ set_code: 'B-1' }), printing({ set_code: 'B-2' })])
    expect(r.map((x) => [x.status, x.reason])).toEqual([
      ['added', undefined],
      ['rejected', 'daily-limit']
    ])
  })

  it('ignores client prices', async () => {
    const res = await post({
      printings: [{ ...printing(), set_price: '9.99', market_price: 12.5 }]
    })
    expect(res.status).toBe(200)
    expect(
      db
        .prepare('SELECT set_price AS s, market_price AS m FROM card_printings WHERE contributed = 1')
        .get()
    ).toEqual({ s: null, m: null })
  })

  it('shows the contributed printing in the change feed', async () => {
    const before = (await (
      await handle(
        new Request(`${BASE}/api/catalog/changes?since=0&limit=1`, { headers: { authorization: ALICE } }),
        deps
      )
    ).json()) as CatalogChangesResponse
    const high = (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
    expect(before.changes.length).toBe(1)
    await contribute([printing()])
    const res = await handle(
      new Request(`${BASE}/api/catalog/changes?since=${high}`, { headers: { authorization: ALICE } }),
      deps
    )
    const feed = (await res.json()) as CatalogChangesResponse
    expect(feed.changes).toHaveLength(1)
    const c = feed.changes[0]
    expect(c.table).toBe('card_printings')
    expect('row' in c && c.row.pkey).toBe(`en|${cardId}|DESK-EN001|Rare`)
    expect('row' in c && c.row.contributed).toBe(1)
  })

  it('answers 400 for a bad body, 413 for too many, 401 without a desktop token, 405 for GET', async () => {
    expect((await post('not json', ALICE, true)).status).toBe(400)
    expect((await post({ printings: 'x' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    const big = await post({ printings: new Array(MAX_CONTRIBUTE + 1).fill(printing()) })
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'too-many' })
    expect((await post({ printings: [] }, null)).status).toBe(401)
    expect((await post({ printings: [] }, 'Bearer alice-web-token')).status).toBe(401)
    const get = await handle(
      new Request(`${BASE}/api/catalog/contribute`, { headers: { authorization: ALICE } }),
      deps
    )
    expect(get.status).toBe(405)
  })
})
