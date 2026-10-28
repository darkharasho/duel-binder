import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { currentUser } from '../../workers/portal/src/auth'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose view of the JSON body
type Stats = Record<string, any>

const BASE = 'https://portal.test'
const TOKEN = 'admin-secret'

describe('GET /admin/stats', () => {
  let db: Database.Database
  let deps: AppDeps
  let now: Date

  beforeEach(async () => {
    db = await seededServerDb()
    now = new Date('2026-10-28T12:00:00.000Z')
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: TOKEN,
        PRICE_WORKER_URL: 'https://prices.test'
      },
      storageBytes: () => 4096,
      now: () => now,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const stats = async (token: string | null = TOKEN): Promise<Response> =>
    handle(
      new Request(BASE + '/admin/stats', {
        headers: token === null ? {} : { authorization: `Bearer ${token}` }
      }),
      deps
    )

  function addSession(userId: number, token: string, kind = 'desktop'): void {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update(token).digest('hex'),
      userId,
      kind,
      '2026-10-01T00:00:00.000Z',
      '2027-10-01T00:00:00.000Z'
    )
  }
  const lastSeen = (id: number): string | null =>
    (
      db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(id) as {
        last_seen_at: string | null
      }
    ).last_seen_at
  const signedIn = (token: string): ReturnType<typeof currentUser> =>
    currentUser(new Request(BASE + '/x', { headers: { authorization: `Bearer ${token}` } }), deps)

  it('needs the admin token', async () => {
    expect((await stats(null)).status).toBe(401)
    expect((await stats('wrong')).status).toBe(401)
  })

  it('counts users, sign-in kinds, collections, friends and storage', async () => {
    const a = addUser(db, '111', 'alice')
    const b = addUser(db, 'apple:xyz', 'bob')
    db.prepare("UPDATE users SET created_at = '2026-09-01T00:00:00.000Z' WHERE id = ?").run(b)
    addSession(a, 'tok-a', 'web')
    addSession(b, 'tok-b')
    const p = db
      .prepare('SELECT id, image_id FROM card_printings JOIN card_images USING (card_id) LIMIT 2')
      .all() as { id: number; image_id: number }[]
    const add = db.prepare(
      "INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, 'x', 'x', ?)"
    )
    add.run(a, 'u1', p[0].id, p[0].image_id, 3, 1)
    add.run(a, 'u2', p[1].id, p[1].image_id, 1, 2)
    add.run(b, 'u3', p[0].id, p[0].image_id, 2, 3)
    db.prepare(
      "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'accepted', 'x', 'x')"
    ).run(a, b)

    const body = (await (await stats()).json()) as Stats
    expect(body.users).toEqual({ total: 2, discord: 1, apple: 1, new7d: 1, new30d: 1 })
    expect(body.sessions).toEqual({ web: 1, desktop: 1 })
    expect(body.collections).toMatchObject({ collectors: 2, entries: 3, cards: 6 })
    expect(body.collections.largest[0]).toEqual({ username: 'alice', entries: 2, cards: 4 })
    expect(body.friends).toEqual({ accepted: 1, pending: 0, blocks: 0 })
    expect(body.storage.databaseBytes).toBe(4096)
    expect(body.storage.rows.users).toBe(2)
    expect(body.active).toEqual({ day: 0, week: 0, month: 0 })
  })

  it('stamps last_seen_at on a signed-in request, at most hourly', async () => {
    const a = addUser(db, '111', 'alice')
    addSession(a, 'tok-a')
    expect(await signedIn('tok-a')).toMatchObject({ id: a })
    expect(lastSeen(a)).toBe('2026-10-28T12:00:00.000Z')

    now = new Date('2026-10-28T12:30:00.000Z')
    await signedIn('tok-a')
    expect(lastSeen(a)).toBe('2026-10-28T12:00:00.000Z')

    now = new Date('2026-10-28T13:01:00.000Z')
    await signedIn('tok-a')
    expect(lastSeen(a)).toBe('2026-10-28T13:01:00.000Z')

    const body = (await (await stats()).json()) as Stats
    expect(body.active).toEqual({ day: 1, week: 1, month: 1 })
  })
})

describe('GET /admin', () => {
  it('serves the dashboard shell with a nonce CSP and no data or token', async () => {
    const deps = { env: {} } as unknown as AppDeps
    const res = await handle(new Request(BASE + '/admin'), deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const csp = res.headers.get('content-security-policy') ?? ''
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).toContain("connect-src 'self'")
    const html = await res.text()
    const script = new RegExp(`<script nonce="${nonce}">([\\s\\S]*)</script>`).exec(html)?.[1]
    // The inline script must at least parse; it only runs in a browser.
    expect(() => new Function(script ?? 'throw 0')).not.toThrow()
    expect(html).toContain("fetch('/admin/stats'")
    expect(html).not.toContain(TOKEN)
  })
})
