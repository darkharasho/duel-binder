import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { getPrefs, setPrefs } from '../../workers/portal/src/prefs'
import type { Prefs } from '../../src/shared/prefs'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'

const NOW = new Date('2026-11-14T12:00:00.000Z')

const LOCKED = {
  fams: [{ lab: [50, 10, -20] as [number, number, number], share: 1 }],
  dark: [10, 0, 0] as [number, number, number],
  vivid: 0.5
}

describe('portal prefs', () => {
  let db: Database.Database
  let deps: AppDeps
  let me: number
  let bob: number

  const session = (userId: number, token: string): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update(token).digest('hex'),
      userId,
      'desktop',
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }
  const rpc = async (
    token: string,
    channel: string,
    ...args: unknown[]
  ): Promise<{ status: number; result: Prefs }> => {
    const res = await handle(
      new Request(`https://portal.test/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ args })
      }),
      deps
    )
    const body = (await res.json().catch(() => ({}))) as { result: Prefs }
    return { status: res.status, result: body.result }
  }

  beforeEach(async () => {
    db = await seededServerDb()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: 'https://portal.test',
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: fetch
    } as AppDeps
    me = addUser(db, '1', 'me')
    bob = addUser(db, '2', 'bob')
    session(me, 'me-token')
    session(bob, 'bob-token')
  })

  it('gives a new user the defaults', async () => {
    const res = await rpc('me-token', 'prefs:get')
    expect(res.status).toBe(200)
    expect(res.result).toEqual({ wash: { mode: 'random' } })
  })

  it('stores a set value and reads it back', async () => {
    const set = await rpc('me-token', 'prefs:set', { wash: { mode: 'colourless' } })
    expect(set.status).toBe(200)
    expect(set.result).toEqual({ wash: { mode: 'colourless' } })
    expect((await rpc('me-token', 'prefs:get')).result).toEqual({ wash: { mode: 'colourless' } })
  })

  it('replaces wash as a whole object, so locked survives only when sent', async () => {
    await rpc('me-token', 'prefs:set', { wash: { mode: 'locked', locked: LOCKED } })
    expect((await rpc('me-token', 'prefs:get')).result.wash.locked).toEqual(LOCKED)
    const res = await rpc('me-token', 'prefs:set', { wash: { mode: 'random' } })
    expect(res.result).toEqual({ wash: { mode: 'random' } })
    expect((await rpc('me-token', 'prefs:get')).result.wash.locked).toBeUndefined()
  })

  it('treats an empty patch as a no-op, not a reset', async () => {
    await rpc('me-token', 'prefs:set', { wash: { mode: 'colourless' } })
    const res = await rpc('me-token', 'prefs:set', {})
    expect(res.status).toBe(200)
    expect(res.result).toEqual({ wash: { mode: 'colourless' } })
  })

  it('rejects a bad patch with 400 and leaves the stored value', async () => {
    await rpc('me-token', 'prefs:set', { wash: { mode: 'colourless' } })
    expect((await rpc('me-token', 'prefs:set', { wash: { mode: 'neon' } })).status).toBe(400)
    expect((await rpc('me-token', 'prefs:set', { other: 1 })).status).toBe(400)
    expect((await rpc('me-token', 'prefs:set', 'nope')).status).toBe(400)
    expect((await rpc('me-token', 'prefs:get')).result).toEqual({ wash: { mode: 'colourless' } })
  })

  it('keeps users apart', async () => {
    await rpc('me-token', 'prefs:set', { wash: { mode: 'colourless' } })
    expect((await rpc('bob-token', 'prefs:get')).result).toEqual({ wash: { mode: 'random' } })
  })

  it('falls back to defaults when the stored text is corrupt', () => {
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run('{not json', me)
    expect(getPrefs(db, me)).toEqual({ wash: { mode: 'random' } })
    expect(setPrefs(db, me, {})).toEqual({ wash: { mode: 'random' } })
  })
})
