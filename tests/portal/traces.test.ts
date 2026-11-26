import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { traceUploadRoute } from '../../workers/portal/src/traces'
import { signTraceToken } from '../../workers/portal/src/traceToken'
import { TRACE_DAILY_CAP, TRACE_UPLOAD_MS } from '../../src/shared/traces'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-25T12:00:00.000Z')
const SESSION = '2026-11-25T11-30-00-000Z'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const LOG = new TextEncoder().encode('{"seq":1}\n{"seq":2}\n')
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('donated scan traces', () => {
  let db: Database.Database
  let bucket: ReturnType<typeof memoryBucket>
  let deps: AppDeps
  let tess: number
  let tom: number

  beforeEach(async () => {
    db = await seededServerDb()
    bucket = memoryBucket()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      traces: bucket,
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: '999'
      },
      now: () => NOW,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
    const owner = addUser(db, '999', 'owner')
    tess = addUser(db, '1', 'tess')
    tom = addUser(db, '2', 'tom')
    for (const [id, name] of [
      [owner, 'owner'],
      [tess, 'tess'],
      [tom, 'tom']
    ] as const)
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      ).run(sha(name), id, NOW.toISOString(), '2099-01-01T00:00:00.000Z')
    db.prepare("INSERT INTO trace_testers (user_id, added_at) VALUES (?, '2026-11-25')").run(tess)
  })

  const call = (
    path: string,
    who: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${who}`,
          ...(init.body !== undefined && { 'content-type': 'application/json' })
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      }),
      deps
    )
  const start = (who = 'tess', over: Record<string, unknown> = {}): Promise<Response> =>
    call('/api/traces', who, {
      method: 'POST',
      body: {
        game: 'ygo',
        session: SESSION,
        note: 'Missed a Secret Rare',
        appVersion: '0.122.0',
        ...over
      }
    })
  const put = (
    id: number,
    name: string,
    token: string,
    body: Uint8Array = JPEG,
    now = NOW.getTime()
  ): Promise<Response | null> =>
    traceUploadRoute(
      new Request(`${BASE}/api/traces/${id}/files/${name}`, {
        method: 'PUT',
        headers: { 'x-trace-token': token },
        body: body as Uint8Array<ArrayBuffer>
      }),
      bucket,
      'admin',
      now
    )

  it('tells a trace tester they are one, and no one else', async () => {
    expect(await (await call('/api/me', 'tess')).json()).toMatchObject({ traceTester: true })
    expect(await (await call('/api/me', 'tom')).json()).not.toHaveProperty('traceTester')
  })

  it('lets only trace testers and admins start a trace', async () => {
    expect((await start('tom')).status).toBe(404)
    expect((await start('owner')).status).toBe(200)
    expect((await start('tess', { session: 'nope' })).status).toBe(400)
    expect((await start('tess', { game: 'chess' })).status).toBe(400)
  })

  it('takes a whole trace: the log and its frames straight to R2, then counts them', async () => {
    const { id, token } = (await (await start()).json()) as { id: number; token: string }
    expect((await put(id, 'trace.jsonl', token, LOG))!.status).toBe(204)
    for (const n of ['0000.jpg', '0001.jpg', '0002.jpg'])
      expect((await put(id, n, token))!.status).toBe(204)
    const done = await call(`/api/traces/${id}/done`, 'tess', { method: 'POST' })
    expect(await done.json()).toEqual({ id, files: 4, bytes: LOG.byteLength + 3 * JPEG.byteLength })
    const mine = (await (await call('/api/traces', 'tess')).json()) as { traces: unknown[] }
    expect(mine.traces).toMatchObject([
      {
        id,
        game: 'ygo',
        session: SESSION,
        note: 'Missed a Secret Rare',
        files: 4,
        doneAt: NOW.toISOString()
      }
    ])
  })

  it("turns away a file with another trace's token, an old token, a bad name or a non-JPEG frame", async () => {
    const { id, token } = (await (await start()).json()) as { id: number; token: string }
    expect((await put(id + 1, '0000.jpg', token))!.status).toBe(403)
    expect(
      (await put(id, '0000.jpg', token, JPEG, NOW.getTime() + TRACE_UPLOAD_MS + 1))!.status
    ).toBe(403)
    expect((await put(id, '0000.jpg', `${token.slice(0, -1)}0`))!.status).toBe(403)
    expect(await put(id, '../x.jpg', token)).toBeNull()
    expect((await put(id, 'notes.txt', token))!.status).toBe(400)
    expect((await put(id, '0000.jpg', token, LOG))!.status).toBe(415)
    expect(bucket.store.size).toBe(0)
  })

  it('a forged token for a trace that was never started is refused', async () => {
    const forged = await signTraceToken('not-the-secret', 1, tess, NOW.getTime() + 1000)
    expect((await put(1, '0000.jpg', forged))!.status).toBe(403)
  })

  it("never gives a deleted trace's id to a new one, so its old token can't reach it", async () => {
    const first = (await (await start()).json()) as { id: number; token: string }
    await call(`/api/traces/${first.id}`, 'tess', { method: 'DELETE' })
    const second = (await (await start('owner')).json()) as { id: number }
    expect(second.id).not.toBe(first.id)
  })

  it(`starts at most ${TRACE_DAILY_CAP} traces a day`, async () => {
    for (let i = 0; i < TRACE_DAILY_CAP; i++) expect((await start()).status).toBe(200)
    expect((await start()).status).toBe(429)
  })

  it("deletes one's own trace and its files, but not someone else's", async () => {
    const { id, token } = (await (await start()).json()) as { id: number; token: string }
    await put(id, '0000.jpg', token)
    await put(id, '0001.jpg', token)
    await put(id, '0002.jpg', token)
    expect((await call(`/api/traces/${id}`, 'owner', { method: 'DELETE' })).status).toBe(404)
    expect((await call(`/api/traces/${id}`, 'tess', { method: 'DELETE' })).status).toBe(204)
    expect(bucket.store.size).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM scan_traces').get()).toEqual({ n: 0 })
  })

  it('the owner lists traces, reads their files and manages the tester list', async () => {
    const { id, token } = (await (await start()).json()) as { id: number; token: string }
    await put(id, 'trace.jsonl', token, LOG)
    await put(id, '0000.jpg', token)
    expect((await call('/admin/traces', 'tess')).status).toBe(404)
    const list = (await (await call('/admin/traces', 'owner')).json()) as { traces: unknown[] }
    expect(list.traces).toMatchObject([{ id, username: 'tess', userId: tess }])
    const files = await (await call(`/admin/traces/${id}/files`, 'owner')).json()
    expect(files).toEqual({
      files: [
        { name: '0000.jpg', size: JPEG.byteLength },
        { name: 'trace.jsonl', size: LOG.byteLength }
      ]
    })
    const log = await call(`/admin/traces/${id}/files/trace.jsonl`, 'owner')
    expect(await log.text()).toBe('{"seq":1}\n{"seq":2}\n')
    // The admin token reads them too, for the pull script.
    expect((await call(`/admin/traces/${id}/files/0000.jpg`, 'admin')).status).toBe(200)

    const added = await call('/admin/trace-testers', 'owner', {
      method: 'POST',
      body: { username: '@tom' }
    })
    expect(
      ((await added.json()) as { testers: { username: string }[] }).testers.map((t) => t.username)
    ).toEqual(['tess', 'tom'])
    expect((await start('tom')).status).toBe(200)
    await call('/admin/trace-testers/remove', 'owner', { method: 'POST', body: { userId: tom } })
    expect((await start('tom')).status).toBe(404)
    expect(
      (
        await call('/admin/trace-testers', 'owner', {
          method: 'POST',
          body: { username: 'nobody' }
        })
      ).status
    ).toBe(404)

    await call('/admin/traces/remove', 'owner', { method: 'POST', body: { id } })
    expect(bucket.store.size).toBe(0)
  })

  it("a deleted account's traces go with it, files and all", async () => {
    const { id, token } = (await (await start()).json()) as { id: number; token: string }
    await put(id, '0000.jpg', token)
    const res = await call('/api/account/delete', 'tess', {
      method: 'POST',
      body: { confirm: 'delete' }
    })
    expect(res.status).toBe(204)
    expect(bucket.store.size).toBe(0)
  })
})
