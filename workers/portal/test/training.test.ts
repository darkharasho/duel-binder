import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SqlDb } from '../../../src/main/db/sql'
import type { TrainingSummary } from '../../../src/shared/training'
import { doSql } from '../src/doSql'

// The training routes' queries on workerd's Durable Object SQLite, with the IMAGES R2 binding.

const TS = '2026-11-04T10:00:00.000Z'
const HOUR = 60 * 60 * 1000
const CARD = 5000
const CID = '11111111-1111-4111-8111-111111111111'
const CID2 = '22222222-2222-4222-8222-222222222222'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])

async function hash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A store with a One Piece card and printing, tester 1 ('tess') and non-tester 2 ('nora'). */
async function seeded(name: string): Promise<{
  db: <R>(fn: (db: SqlDb) => R) => Promise<R>
  call: (token: string, method: string, path: string, body?: BodyInit) => Promise<Response>
  printing: number
}> {
  const stub = env.STORE.get(env.STORE.idFromName(name))
  const db = <R>(fn: (db: SqlDb) => R): Promise<R> =>
    runInDurableObject(stub, (_i, state) => fn(doSql(state.storage)))
  const hashes = await Promise.all(['tess', 'nora'].map(hash))
  const printing = await db((d) => {
    d.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'op', 'Luffy', 'Leader', 'op', '', '', ?)`
    ).run(CARD, TS)
    hashes.forEach((h, i) => {
      const id = i + 1
      d.prepare(
        'INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, `d${id}`, `user${id}`, TS, TS)
      d.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, '2999-01-01T00:00:00.000Z')"
      ).run(h, id, TS)
    })
    d.prepare("INSERT INTO game_testers (game, user_id) VALUES ('op', 1)").run()
    return Number(
      d
        .prepare(
          `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
           VALUES ('op', ?, 'en', 'ROMANCE DAWN [OP-01]', 'OP01-001', 'L')`
        )
        .run(CARD).lastInsertRowid
    )
  })
  const call = (token: string, method: string, path: string, body?: BodyInit): Promise<Response> =>
    stub.fetch(`https://app.duelbinder.com${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
      body
    })
  return { db, call, printing }
}

const labelQuery = (printing: number): string =>
  new URLSearchParams({
    game: 'op',
    card: String(CARD),
    printing: String(printing),
    holder: 'toploader',
    device: 'Pixel 9',
    app: '0.54.0',
    at: new Date().toISOString()
  }).toString()

describe('training photos on Durable Object SQLite and R2', () => {
  it('upload, summary, delete', async () => {
    const s = await seeded('training-routes')
    const path = `/api/training/photos/${CID}?${labelQuery(s.printing)}`
    const res = await s.call('tess', 'POST', path, JPEG)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total: 1, today: 1, dailyCap: 500 })
    // Again: the row exists, nothing changes.
    expect(await (await s.call('tess', 'POST', path, JPEG)).json()).toEqual({
      total: 1,
      today: 1,
      dailyCap: 500
    })
    const key = `training/op/1/${CID}.jpg`
    const stored = await env.IMAGES.get(key)
    expect(stored?.httpMetadata?.contentType).toBe('image/jpeg')
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(JPEG)

    expect((await s.call('nora', 'POST', path, JPEG)).status).toBe(404)
    expect((await s.call('nora', 'GET', '/api/training/summary?game=op')).status).toBe(404)
    const sum = await s.call('tess', 'GET', '/api/training/summary?game=op')
    expect(await sum.json()).toEqual({ total: 1, today: 1, dailyCap: 500 })

    expect((await s.call('tess', 'DELETE', `/api/training/photos/${CID}`)).status).toBe(204)
    expect(await env.IMAGES.get(key)).toBeNull()
    expect(await s.db((d) => d.prepare('SELECT COUNT(*) AS n FROM training_photos').get())).toEqual(
      {
        n: 0
      }
    )
  })

  it('counts the last 24 hours and stops at the cap', async () => {
    const s = await seeded('training-cap')
    const now = Date.now()
    await s.db((d) => {
      const ins = d.prepare(
        `INSERT INTO training_photos (user_id, client_id, game, card_id, printing_id, holder, device,
           app_version, taken_at, created_at, bytes, r2_key)
         VALUES (1, ?, 'op', ?, ?, 'bare', 'd', '0.54.0', ?, ?, 3, ?)`
      )
      for (let i = 0; i < 499; i++) {
        const at = new Date(now - HOUR).toISOString()
        ins.run(`c${i}`, CARD, s.printing, at, at, `training/op/1/c${i}.jpg`)
      }
      const old = new Date(now - 25 * HOUR).toISOString()
      ins.run('old', CARD, s.printing, old, old, 'training/op/1/old.jpg')
    })
    const sum = (await (
      await s.call('tess', 'GET', '/api/training/summary?game=op')
    ).json()) as TrainingSummary
    expect(sum).toEqual({ total: 500, today: 499, dailyCap: 500 })
    const ok = await s.call(
      'tess',
      'POST',
      `/api/training/photos/${CID}?${labelQuery(s.printing)}`,
      JPEG
    )
    expect(await ok.json()).toEqual({ total: 501, today: 500, dailyCap: 500 })
    const over = await s.call(
      'tess',
      'POST',
      `/api/training/photos/${CID2}?${labelQuery(s.printing)}`,
      JPEG
    )
    expect(over.status).toBe(429)
    expect(await env.IMAGES.get(`training/op/1/${CID2}.jpg`)).toBeNull()
  })

  it('a deleted account takes its photos and their objects with it', async () => {
    const s = await seeded('training-delete')
    await s.call('tess', 'POST', `/api/training/photos/${CID}?${labelQuery(s.printing)}`, JPEG)
    const key = `training/op/1/${CID}.jpg`
    expect(await env.IMAGES.get(key)).not.toBeNull()
    const res = await env.STORE.get(env.STORE.idFromName('training-delete')).fetch(
      'https://app.duelbinder.com/api/account/delete',
      {
        method: 'POST',
        headers: { authorization: 'Bearer tess', 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete' })
      }
    )
    expect(res.status).toBe(204)
    expect(await env.IMAGES.get(key)).toBeNull()
    expect(await s.db((d) => d.prepare('SELECT COUNT(*) AS n FROM training_photos').get())).toEqual(
      {
        n: 0
      }
    )
  })
})
