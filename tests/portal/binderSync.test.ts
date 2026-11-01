import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { MAX_BINDER_EDITS, MAX_BINDERS } from '../../src/shared/binders'
import {
  binderEditKey,
  type BinderEditPullResponse,
  type BinderPullResponse,
  type WireBinder,
  type WireBinderEdit
} from '../../src/shared/cloud'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  applyBinderEditPush,
  applyBinderPush,
  binderEditPullSince,
  binderPullSince,
  checkBinderEditPush,
  checkBinderPush
} from '../../workers/portal/src/binderSync'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'

const NOW = new Date('2026-10-24T12:00:00.000Z')
const T1 = '2026-10-24T10:00:00.000Z'
const T2 = '2026-10-24T11:00:00.000Z'
const BOTH = ['ygo', 'pkm'] as const

const binder = (extra: Partial<WireBinder> = {}): WireBinder => ({
  uid: 'b1',
  game: 'ygo',
  name: 'Blue-Eyes',
  rules: '{"v":1}',
  goal: 'card',
  languages: '["en"]',
  friendsVisible: true,
  sortOrder: 0,
  createdAt: T1,
  updatedAt: T1,
  deletedAt: null,
  ...extra
})
const edit = (extra: Partial<WireBinderEdit> = {}): WireBinderEdit => ({
  binderUid: 'b1',
  level: 'card',
  target: '100',
  game: 'ygo',
  action: 'add',
  createdAt: T1,
  updatedAt: T1,
  deletedAt: null,
  ...extra
})

describe('portal binder sync', () => {
  let db: Database.Database
  let deps: AppDeps
  let me: number

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
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update('me-token').digest('hex'),
      me,
      'desktop',
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  })

  describe('binders', () => {
    it('latest edit wins, and a stale push gets the current row', () => {
      applyBinderPush(db, me, [binder()], BOTH)
      expect(applyBinderPush(db, me, [binder({ name: 'New', updatedAt: T2 })], BOTH)).toEqual([
        { uid: 'b1', status: 'applied' }
      ])
      const stale = applyBinderPush(db, me, [binder({ name: 'Old' })], BOTH)
      expect(stale).toEqual([{ uid: 'b1', status: 'stale', current: binder({ name: 'New', updatedAt: T2 }) }])
      expect(binderPullSince(db, me, 0).entries).toEqual([binder({ name: 'New', updatedAt: T2 })])
    })

    it('a tombstone for an unknown row is not stored; for a known one it is', () => {
      applyBinderPush(db, me, [binder({ deletedAt: T1 })], BOTH)
      expect(binderPullSince(db, me, 0).entries).toEqual([])
      applyBinderPush(db, me, [binder()], BOTH)
      applyBinderPush(db, me, [binder({ updatedAt: T2, deletedAt: T2 })], BOTH)
      expect(binderPullSince(db, me, 0).entries).toMatchObject([{ deletedAt: T2 }])
    })

    it('skips a game outside games, and pulls per game and paged', () => {
      expect(applyBinderPush(db, me, [binder({ game: 'pkm' })], ['ygo'])).toEqual([
        { uid: 'b1', status: 'skipped' }
      ])
      applyBinderPush(
        db, me,
        [binder({ uid: 'a' }), binder({ uid: 'b', game: 'pkm' }), binder({ uid: 'c' })],
        BOTH
      )
      const page1 = binderPullSince(db, me, 0, 1, 'ygo')
      expect(page1).toMatchObject({ more: true, entries: [{ uid: 'a' }] })
      const page2 = binderPullSince(db, me, page1.cursor, 1, 'ygo')
      expect(page2).toMatchObject({ more: false, entries: [{ uid: 'c' }], cursor: 3 })
    })

    it('stores a version 2 rule unchanged', () => {
      const rules = '{"v":2,"future":{"x":[1,2]}}'
      applyBinderPush(db, me, [binder({ rules })], BOTH)
      expect(binderPullSince(db, me, 0).entries[0].rules).toBe(rules)
    })

    it('refuses a new live binder past MAX_BINDERS, but not a tombstone or an update', () => {
      const many = Array.from({ length: MAX_BINDERS }, (_, i) => binder({ uid: `u${i}` }))
      applyBinderPush(db, me, many, BOTH)
      expect(applyBinderPush(db, me, [binder({ uid: 'extra' })], BOTH)).toEqual([
        { uid: 'extra', status: 'skipped' }
      ])
      // The other game has its own allowance.
      expect(applyBinderPush(db, me, [binder({ uid: 'p', game: 'pkm' })], BOTH)).toEqual([
        { uid: 'p', status: 'applied' }
      ])
      expect(applyBinderPush(db, me, [binder({ uid: 'u0', name: 'x', updatedAt: T2 })], BOTH)).toEqual([
        { uid: 'u0', status: 'applied' }
      ])
      applyBinderPush(db, me, [binder({ uid: 'u1', updatedAt: T2, deletedAt: T2 })], BOTH)
      expect(applyBinderPush(db, me, [binder({ uid: 'extra' })], BOTH)).toEqual([
        { uid: 'extra', status: 'applied' }
      ])
    })

    it('validates a push', () => {
      const check = (v: unknown): unknown => checkBinderPush({ entries: [v] }, NOW)
      expect(check(binder())).toEqual([binder()])
      for (const bad of [
        binder({ uid: '' }),
        binder({ uid: 'x'.repeat(65) }),
        binder({ game: 'mtg' as never }),
        binder({ name: '' }),
        binder({ name: 'x'.repeat(81) }),
        binder({ rules: 'x'.repeat(8 * 1024 + 1) }),
        binder({ goal: 'x'.repeat(300) }),
        binder({ languages: 'x'.repeat(300) }),
        binder({ sortOrder: 1.5 }),
        binder({ friendsVisible: 1 as never }),
        binder({ updatedAt: 'nope' })
      ])
        expect(() => check(bad)).toThrow()
      expect(() => checkBinderPush({}, NOW)).toThrow()
    })
  })

  describe('binder edits', () => {
    it('latest edit wins, and a stale push gets the current row', () => {
      applyBinderEditPush(db, me, [edit()], BOTH)
      applyBinderEditPush(db, me, [edit({ action: 'remove', updatedAt: T2 })], BOTH)
      const stale = applyBinderEditPush(db, me, [edit()], BOTH)
      expect(stale).toEqual([
        {
          key: binderEditKey(edit()),
          status: 'stale',
          current: edit({ action: 'remove', updatedAt: T2 })
        }
      ])
    })

    it('equal times: a tombstone replaces a live row, not the other way', () => {
      applyBinderEditPush(db, me, [edit()], BOTH)
      applyBinderEditPush(db, me, [edit({ deletedAt: T1 })], BOTH)
      expect(binderEditPullSince(db, me, 0).entries).toMatchObject([{ deletedAt: T1 }])
      expect(applyBinderEditPush(db, me, [edit()], BOTH)[0].status).toBe('stale')
    })

    it('a tombstone for an unknown row is not stored', () => {
      applyBinderEditPush(db, me, [edit({ deletedAt: T1 })], BOTH)
      expect(binderEditPullSince(db, me, 0).entries).toEqual([])
    })

    it('edits to different cards from two devices both survive', () => {
      applyBinderEditPush(db, me, [edit({ target: '1' })], BOTH)
      applyBinderEditPush(db, me, [edit({ target: '2', action: 'remove' })], BOTH)
      expect(binderEditPullSince(db, me, 0).entries.map((e) => e.target)).toEqual(['1', '2'])
    })

    it('an edit for a binder the server lacks is stored', () => {
      expect(applyBinderEditPush(db, me, [edit({ binderUid: 'ghost' })], BOTH)[0].status).toBe('applied')
      expect(binderEditPullSince(db, me, 0).entries).toHaveLength(1)
    })

    it('skips a game outside games; pulls per game and paged', () => {
      expect(applyBinderEditPush(db, me, [edit({ game: 'pkm' })], ['ygo'])[0].status).toBe('skipped')
      applyBinderEditPush(
        db, me,
        [edit({ target: 'a' }), edit({ target: 'b', game: 'pkm' }), edit({ target: 'c' })],
        BOTH
      )
      const page1 = binderEditPullSince(db, me, 0, 1, 'ygo')
      expect(page1).toMatchObject({ more: true, entries: [{ target: 'a' }] })
      expect(binderEditPullSince(db, me, page1.cursor, 1, 'ygo')).toMatchObject({
        more: false,
        entries: [{ target: 'c' }],
        cursor: 3
      })
    })

    it('refuses a new live edit past MAX_BINDER_EDITS for a binder, but not a tombstone or an update', () => {
      const many = Array.from({ length: MAX_BINDER_EDITS }, (_, i) => edit({ target: `t${i}` }))
      applyBinderEditPush(db, me, many, BOTH)
      expect(applyBinderEditPush(db, me, [edit({ target: 'extra' })], BOTH)[0].status).toBe('skipped')
      expect(applyBinderEditPush(db, me, [edit({ binderUid: 'b2', target: 'extra' })], BOTH)[0].status).toBe(
        'applied'
      )
      expect(
        applyBinderEditPush(db, me, [edit({ target: 't0', action: 'remove', updatedAt: T2 })], BOTH)[0].status
      ).toBe('applied')
      applyBinderEditPush(db, me, [edit({ target: 't1', updatedAt: T2, deletedAt: T2 })], BOTH)
      expect(applyBinderEditPush(db, me, [edit({ target: 'extra' })], BOTH)[0].status).toBe('applied')
    })

    it('validates a push', () => {
      const check = (v: unknown): unknown => checkBinderEditPush({ entries: [v] }, NOW)
      expect(check(edit())).toEqual([edit()])
      for (const bad of [
        edit({ binderUid: '' }),
        edit({ binderUid: 'x'.repeat(65) }),
        edit({ target: '' }),
        edit({ target: 'x'.repeat(301) }),
        edit({ level: 'set' as never }),
        edit({ action: 'toggle' as never }),
        edit({ game: 'mtg' as never }),
        edit({ createdAt: 'nope' })
      ])
        expect(() => check(bad)).toThrow()
    })
  })

  describe('routes', () => {
    const call = (path: string, entries?: unknown, token = 'me-token'): Promise<Response> =>
      handle(
        new Request(`https://portal.test/api/sync/${path}`, {
          method: entries === undefined ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: entries === undefined ? undefined : JSON.stringify({ entries })
        }),
        deps
      )

    it('want a desktop token, refuse over-long pushes and bad bodies, and round-trip', async () => {
      expect((await call('binders-push', [], 'nobody')).status).toBe(401)
      expect((await call('binders-push', Array(501).fill(binder()))).status).toBe(413)
      expect((await call('binder-edits-push', Array(501).fill(edit()))).status).toBe(413)
      expect((await call('binders-push', [binder({ rules: 'x'.repeat(9000) })])).status).toBe(400)
      expect((await call('binders-push', [binder()])).status).toBe(200)
      expect((await call('binder-edits-push', [edit()])).status).toBe(200)
      const b = (await (await call('binders-pull?cursor=0&game=ygo')).json()) as BinderPullResponse
      const e = (await (await call('binder-edits-pull?cursor=0&game=ygo')).json()) as BinderEditPullResponse
      expect(b.entries).toEqual([binder()])
      expect(e.entries).toEqual([edit()])
      expect((await call('binders-pull?cursor=x')).status).toBe(400)
      expect((await call('binders-pull?cursor=0', undefined, 'nobody')).status).toBe(401)
    })
  })
})
