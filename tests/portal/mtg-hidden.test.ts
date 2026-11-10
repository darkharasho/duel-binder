import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addEntry } from '../../src/main/repo/collection'
import { setWish } from '../../src/main/repo/wishlist'
import { setFavourite } from '../../src/main/repo/favourites'
import { userScope } from '../../workers/portal/src/scope'
import { applyBinderPush } from '../../workers/portal/src/binderSync'
import { GAME_HEADER } from '../../src/shared/cloud'
import { gamesFor } from '../../workers/portal/src/auth'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'
import { seedMagic } from '../fixtures/magic'
import { seedPokemon } from '../fixtures/pokemon'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-04T12:00:00.000Z')
const T = '2026-11-04T10:00:00.000Z'
const Z1 = '11111111-1111-4111-8111-111111111111'
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Magic is a tester-only game: no route may show its rows to anyone off the list. */
describe('Magic is hidden on every route', () => {
  let db: Database.Database
  let deps: AppDeps & { images: ReturnType<typeof memoryBucket> }
  let owner: number
  let luffy: number
  let zoro: number
  let nami: number
  let mtg: { cardIds: number[]; printingIds: number[]; imageIds: number[] }
  let mtgPkey: string

  const bearer = (name: string): Record<string, string> => ({ authorization: `Bearer ${name}` })
  const send = (
    path: string,
    who: string | null,
    init: RequestInit & { game?: string } = {}
  ): Promise<Response> => {
    const { game, ...rest } = init
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (who) Object.assign(headers, bearer(who))
    if (game) headers[GAME_HEADER] = game
    return handle(new Request(BASE + path, { ...rest, headers }), deps)
  }
  const rpc = async (
    channel: string,
    args: unknown[],
    who: string,
    game: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ status: number; body: any }> => {
    const res = await send(`/api/rpc/${channel}`, who, {
      method: 'POST',
      body: JSON.stringify({ args }),
      game
    })
    return { status: res.status, body: await res.json() }
  }

  beforeEach(async () => {
    db = await seededServerDb()
    seedPokemon(db)
    mtg = seedMagic(db)
    mtgPkey = (
      db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(mtg.printingIds[0]) as {
        pkey: string
      }
    ).pkey
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
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: '999'
      },
      now: () => NOW,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
    owner = addUser(db, '999', 'owner')
    luffy = addUser(db, '1', 'luffy')
    zoro = addUser(db, '2', 'zoro')
    nami = addUser(db, '3', 'nami')
    for (const [id, name] of [
      [owner, 'owner'],
      [luffy, 'luffy'],
      [zoro, 'zoro'],
      [nami, 'nami']
    ] as const)
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      ).run(sha(name), id, NOW.toISOString(), '2099-01-01T00:00:00.000Z')
    for (const id of [luffy, nami])
      db.prepare("INSERT INTO game_testers (game, user_id) VALUES ('mtg', ?)").run(id)
    for (const id of [zoro, nami])
      db.prepare(
        "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'accepted', ?, ?)"
      ).run(id, luffy, T, T)

    const scope = userScope(luffy, 'mtg')
    addEntry(
      db,
      { printingId: mtg.printingIds[0], imageId: mtg.imageIds[0], quantity: 2 },
      NOW,
      scope
    )
    setWish(db, mtg.printingIds[1], null, NOW, scope)
    setFavourite(db, mtg.cardIds[0], true, NOW, scope)
    applyBinderPush(
      db,
      luffy,
      [
        {
          uid: 'b-mtg',
          game: 'mtg',
          name: 'Binder of Angels',
          rules: '{"v":1}',
          goal: 'card',
          languages: '["en"]',
          friendsVisible: true,
          sortOrder: 0,
          createdAt: T,
          updatedAt: T,
          deletedAt: null
        }
      ],
      ['ygo', 'pkm', 'op', 'mtg']
    )
  })

  const mtgRows = (): unknown[] =>
    ['collection_entries', 'wishlist_entries', 'favourites', 'binders'].map((t) =>
      db.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY 1`).all(zoro)
    )

  it('non-tester gets 403 everywhere', async () => {
    const forbidden = async (res: Response): Promise<void> => {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'game-not-allowed' })
    }
    await forbidden(
      await send('/api/rpc/collection:list', 'zoro', {
        method: 'POST',
        body: JSON.stringify({ args: [{ sort: 'added', dir: 'desc' }] }),
        game: 'mtg'
      })
    )
    for (const p of [
      'pull?cursor=0',
      'wishlist-pull?cursor=0',
      'favourites-pull?cursor=0',
      'binders-pull?cursor=0'
    ])
      await forbidden(await send(`/api/sync/${p}&game=mtg`, 'zoro'))
    await forbidden(await send('/api/catalog/changes?since=0&game=mtg', 'zoro'))
  })

  it('non-tester pushes are not stored', async () => {
    const before = mtgRows()
    const post = async (path: string, entries: unknown[]): Promise<{ status: string }[]> =>
      (
        (await (
          await send(`/api/sync/${path}`, 'zoro', {
            method: 'POST',
            body: JSON.stringify({ entries })
          })
        ).json()) as { results: { status: string }[] }
      ).results
    expect(
      await post('push', [
        {
          uid: Z1,
          pkey: mtgPkey,
          imageId: mtg.imageIds[0],
          quantity: 1,
          notes: '',
          createdAt: T,
          updatedAt: T,
          deletedAt: null
        }
      ])
    ).toEqual([{ uid: Z1, status: 'unknown-printing' }])
    expect(
      await post('wishlist-push', [
        { pkey: mtgPkey, game: 'mtg', quantity: null, createdAt: T, updatedAt: T, deletedAt: null }
      ])
    ).toEqual([{ pkey: mtgPkey, status: 'skipped' }])
    expect(
      await post('favourites-push', [
        { cardId: mtg.cardIds[0], game: 'mtg', createdAt: T, updatedAt: T, deletedAt: null }
      ])
    ).toEqual([{ cardId: mtg.cardIds[0], status: 'skipped' }])
    expect(
      await post('binders-push', [
        {
          uid: 'z-b',
          game: 'mtg',
          name: 'x',
          rules: '{"v":1}',
          goal: 'card',
          languages: '["en"]',
          friendsVisible: true,
          sortOrder: 0,
          createdAt: T,
          updatedAt: T,
          deletedAt: null
        }
      ])
    ).toEqual([{ uid: 'z-b', status: 'skipped' }])
    expect(mtgRows()).toEqual(before)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM collection_entries WHERE uid = ?').get(Z1)
    ).toEqual({
      n: 0
    })
  })

  describe('fingerprints are hidden', () => {
    const get = (path: string, who: string | null): Promise<Response> =>
      send(path, who, { headers: undefined })
    beforeEach(async () => {
      for (const key of [
        'scan/mtg/fingerprints.bin',
        'scan/pkm/fingerprints.bin',
        'scan/op/fingerprints.bin',
        'scan/fingerprints.bin'
      ])
        await deps.images.put(key, new Uint8Array([1, 2, 3]).buffer, {
          httpMetadata: { contentType: 'application/octet-stream' }
        })
    })

    it('404 for signed out and non-testers, 200 for the owner and testers', async () => {
      for (const who of [null, 'zoro']) {
        const res = await get('/scan/fingerprints?game=mtg', who)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'No fingerprints yet' })
      }
      expect((await get('/scan/fingerprints?game=mtg', 'owner')).status).toBe(200)
      expect((await get('/scan/fingerprints?game=mtg', 'luffy')).status).toBe(200)
    })

    it('stays the same when nothing is stored, so it gives nothing away', async () => {
      deps.images.store.delete('scan/mtg/fingerprints.bin')
      const hidden = await get('/scan/fingerprints?game=mtg', 'zoro')
      const owners = await get('/scan/fingerprints?game=mtg', 'owner')
      expect(hidden.status).toBe(404)
      expect(owners.status).toBe(404)
      expect(await hidden.text()).toBe(await owners.text())
    })

    it('Pokémon and Yu-Gi-Oh! stay public', async () => {
      expect((await get('/scan/fingerprints?game=pkm', null)).status).toBe(200)
      expect((await get('/scan/fingerprints', null)).status).toBe(200)
    })
  })

  describe("friend views use the viewer's games", () => {
    it('with ygo, zoro sees no Magic row', async () => {
      const F = { sort: 'added', dir: 'desc' }
      const calls: [string, unknown[]][] = [
        ['friends:collection', [luffy, F]],
        ['friends:stats', [luffy]],
        ['friends:sets', [luffy]],
        ['friends:binders', [luffy]],
        ['friends:wishlist', [luffy]],
        ['friends:forCard', [mtg.cardIds[0]]]
      ]
      for (const [channel, args] of calls) {
        const r = await rpc(channel, args, 'zoro', 'ygo')
        expect(r.status, channel).toBe(200)
        const text = JSON.stringify(r.body)
        expect(text, channel).not.toContain('Serra Angel')
        expect(text, channel).not.toContain('Binder of Angels')
        expect(text, channel).not.toContain('M15')
      }
      expect((await rpc('friends:collection', [luffy, F], 'zoro', 'ygo')).body.result).toEqual([])
      expect((await rpc('friends:binders', [luffy], 'zoro', 'ygo')).body.result).toEqual([])
    })

    it('with mtg, zoro gets 403', async () => {
      for (const channel of ['friends:collection', 'friends:binders', 'friends:wishlist'])
        expect(
          (await rpc(channel, [luffy, { sort: 'added', dir: 'desc' }], 'zoro', 'mtg')).status
        ).toBe(403)
    })

    it("with mtg, a tester friend sees luffy's entry", async () => {
      const r = await rpc(
        'friends:collection',
        [luffy, { sort: 'added', dir: 'desc' }],
        'nami',
        'mtg'
      )
      expect(r.status).toBe(200)
      expect(r.body.result).toHaveLength(1)
      expect(r.body.result[0].card.name).toBe('Serra Angel')
      const b = await rpc('friends:binders', [luffy], 'nami', 'mtg')
      expect(b.body.result.map((x: { name: string }) => x.name)).toEqual(['Binder of Angels'])
    })
  })

  it('art is not hidden', async () => {
    const res = await send(`/img/small/${mtg.imageIds[0]}`, null)
    expect(res.status).not.toBe(403)
  })

  it('removed tester', async () => {
    const before = db
      .prepare('SELECT server_seq, deleted_at FROM collection_entries WHERE user_id = ?')
      .get(luffy) as { server_seq: number; deleted_at: string | null }
    db.prepare('DELETE FROM game_testers WHERE user_id = ?').run(luffy)
    expect(gamesFor(deps, luffy)).not.toContain('mtg')
    const me = (await (await send('/api/me', 'luffy')).json()) as { games: string[] }
    expect(me.games).not.toContain('mtg')
    expect((await send('/api/sync/pull?cursor=0&game=mtg', 'luffy')).status).toBe(403)
    const after = db
      .prepare('SELECT server_seq, deleted_at FROM collection_entries WHERE user_id = ?')
      .get(luffy) as { server_seq: number; deleted_at: string | null }
    expect(after).toEqual(before)
    expect(after.deleted_at).toBeNull()
  })
})
