import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SqlDb } from '../../../src/main/db/sql'
import type {
  ScanSession,
  ScanSessionPullResponse,
  ScanSessionPushResult,
  WireScanSession
} from '../../../src/shared/scanSessions'
import { doSql } from '../src/doSql'
import { migrateServer } from '../src/migrate'

// Scan sessions on workerd's Durable Object SQLite, which refuses some queries better-sqlite3 runs.

const TS = '2026-11-05T10:00:00.000Z'
const LATER = '2026-11-05T10:01:00.000Z'

async function hash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function store(name: string): {
  db: <R>(fn: (db: SqlDb) => R) => Promise<R>
  call: <T>(token: string, path: string, body?: unknown) => Promise<{ status: number; data: T }>
} {
  const stub = env.STORE.get(env.STORE.idFromName(name))
  return {
    db: (fn) => runInDurableObject(stub, (_i, state) => fn(doSql(state.storage))),
    call: async <T>(token: string, path: string, body?: unknown) => {
      const res = await stub.fetch(`https://app.duelbinder.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const text = await res.text()
      return { status: res.status, data: (text ? JSON.parse(text) : null) as T }
    }
  }
}

function addUser(db: SqlDb, id: number, tokenHash: string): void {
  db.prepare(
    `INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, `d${id}`, `user${id}`, TS, TS)
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)`
  ).run(tokenHash, id, TS, '2999-01-01T00:00:00.000Z')
}

const session = (extra: Partial<WireScanSession> = {}): WireScanSession => ({
  uid: 's1',
  game: 'ygo',
  cards: [
    {
      cardId: 1,
      pkey: 'en|1|LOB-005|Ultra Rare',
      printingId: 2,
      imageId: 3,
      photoId: null,
      name: 'Dark Magician',
      setCode: 'LOB-005',
      rarity: 'Ultra Rare',
      quantity: 1,
      price: 4.5,
      guess: false,
      addedAt: 1_762_340_000_000
    }
  ],
  friendsVisible: true,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
  ...extra
})

describe('scan sessions on Durable Object SQLite', () => {
  it('server-38 creates scan_sessions with its indexes, and is idempotent', async () => {
    const s = store('server-38')
    const out = await s.db((db) => {
      db.exec(`DROP TABLE scan_sessions; DELETE FROM server_migrations WHERE name = 'server-38';`)
      migrateServer(db)
      migrateServer(db)
      return (
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'scan_sessions' AND sql IS NOT NULL ORDER BY name"
          )
          .all() as { name: string }[]
      ).map((r) => r.name)
    })
    expect(out).toEqual(['ix_scan_sessions_user_seq', 'ux_scan_sessions_seq'])
  })

  it('push, pull, stale, friend read and account delete go through the routes', async () => {
    const s = store('routes')
    const hashes = await Promise.all(['me', 'pal'].map(hash))
    await s.db((db) => {
      hashes.forEach((h, i) => addUser(db, i + 1, h))
      db.prepare(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (1, 2, 'accepted', ?, ?)`
      ).run(TS, TS)
    })
    const pushed = await s.call<{ results: ScanSessionPushResult[] }>(
      'pal',
      '/api/sync/sessions-push',
      {
        entries: [session(), session({ uid: 'hid', friendsVisible: false })]
      }
    )
    expect(pushed.data.results.map((r) => r.status)).toEqual(['applied', 'applied'])

    const stale = await s.call<{ results: ScanSessionPushResult[] }>(
      'pal',
      '/api/sync/sessions-push',
      {
        entries: [session({ updatedAt: LATER, friendsVisible: false }), session({ uid: 's1' })]
      }
    )
    expect(stale.data.results[0]).toEqual({ uid: 's1', status: 'applied' })
    expect(stale.data.results[1]).toMatchObject({ uid: 's1', status: 'stale' })

    // An older push brings its price into the stored session, not its flags.
    const first = session().cards[0]
    await s.call('pal', '/api/sync/sessions-push', {
      entries: [
        session({
          uid: 'fill',
          cards: [{ ...first, price: null }],
          updatedAt: LATER,
          friendsVisible: false
        })
      ]
    })
    const filled = await s.call<{ results: ScanSessionPushResult[] }>(
      'pal',
      '/api/sync/sessions-push',
      { entries: [session({ uid: 'fill', cards: [{ ...first, price: 3 }] })] }
    )
    expect(filled.data.results[0]).toMatchObject({
      status: 'stale',
      current: { friendsVisible: false, cards: [{ price: 3 }] }
    })

    const pull = await s.call<ScanSessionPullResponse>(
      'pal',
      '/api/sync/sessions-pull?cursor=0&game=ygo'
    )
    expect(pull.data.sessions.map((x) => [x.uid, x.friendsVisible])).toEqual([
      ['hid', false],
      ['s1', false],
      ['fill', false]
    ])

    await s.call('pal', '/api/sync/sessions-push', {
      entries: [session({ updatedAt: '2026-11-05T10:02:00.000Z', friendsVisible: true })]
    })
    const read = await s.call<{ result: ScanSession[] }>('me', '/api/rpc/friends:sessions', {
      args: [2]
    })
    expect(read.status).toBe(200)
    expect(read.data.result.map((x) => x.uid)).toEqual(['s1'])
    expect(read.data.result[0]).not.toHaveProperty('deletedAt')
    // Printings come from the server catalog by pkey; this one has none, so no stored id is kept.
    expect(read.data.result[0].cards[0]).toMatchObject({ printingId: null, photoId: null })

    expect((await s.call('pal', '/api/account/delete', { confirm: 'delete' })).status).toBe(204)
    expect(await s.db((db) => db.prepare('SELECT user_id FROM scan_sessions').all())).toEqual([])
  })
})
