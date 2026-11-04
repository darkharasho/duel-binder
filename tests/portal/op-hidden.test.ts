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
import { seedOnePiece } from '../fixtures/onePiece'
import { seedPokemon } from '../fixtures/pokemon'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-04T12:00:00.000Z')
const T = '2026-11-04T10:00:00.000Z'
const Z1 = '11111111-1111-4111-8111-111111111111'
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** One Piece is a tester-only game: no route may show its rows to anyone off the list. */
describe('One Piece is hidden on every route', () => {
  let db: Database.Database
  let deps: AppDeps & { images: ReturnType<typeof memoryBucket> }
  let owner: number
  let luffy: number
  let zoro: number
  let nami: number
  let op: { cardIds: number[]; printingIds: number[]; imageIds: number[] }
  let opPkey: string

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
    op = seedOnePiece(db)
    opPkey = (
      db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(op.printingIds[0]) as {
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
      db.prepare("INSERT INTO game_testers (game, user_id) VALUES ('op', ?)").run(id)
    for (const id of [zoro, nami])
      db.prepare(
        "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'accepted', ?, ?)"
      ).run(id, luffy, T, T)

    const scope = userScope(luffy, 'op')
    addEntry(
      db,
      { printingId: op.printingIds[0], imageId: op.imageIds[0], quantity: 2 },
      NOW,
      scope
    )
    setWish(db, op.printingIds[1], null, NOW, scope)
    setFavourite(db, op.cardIds[0], true, NOW, scope)
    applyBinderPush(
      db,
      luffy,
      [
        {
          uid: 'b-op',
          game: 'op',
          name: 'Straw Hats',
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
      ['ygo', 'pkm', 'op']
    )
  })

  const opRows = (): unknown[] =>
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
        game: 'op'
      })
    )
    for (const p of [
      'pull?cursor=0',
      'wishlist-pull?cursor=0',
      'favourites-pull?cursor=0',
      'binders-pull?cursor=0'
    ])
      await forbidden(await send(`/api/sync/${p}&game=op`, 'zoro'))
    await forbidden(await send('/api/catalog/changes?since=0&game=op', 'zoro'))
  })

  it('non-tester pushes are not stored', async () => {
    const before = opRows()
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
          pkey: opPkey,
          imageId: op.imageIds[0],
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
        { pkey: opPkey, game: 'op', quantity: null, createdAt: T, updatedAt: T, deletedAt: null }
      ])
    ).toEqual([{ pkey: opPkey, status: 'skipped' }])
    expect(
      await post('favourites-push', [
        { cardId: op.cardIds[0], game: 'op', createdAt: T, updatedAt: T, deletedAt: null }
      ])
    ).toEqual([{ cardId: op.cardIds[0], status: 'skipped' }])
    expect(
      await post('binders-push', [
        {
          uid: 'z-b',
          game: 'op',
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
    expect(opRows()).toEqual(before)
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
        'scan/op/fingerprints.bin',
        'scan/pkm/fingerprints.bin',
        'scan/fingerprints.bin'
      ])
        await deps.images.put(key, new Uint8Array([1, 2, 3]).buffer, {
          httpMetadata: { contentType: 'application/octet-stream' }
        })
    })

    it('404 for signed out and non-testers, 200 for the owner and testers', async () => {
      for (const who of [null, 'zoro']) {
        const res = await get('/scan/fingerprints?game=op', who)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'No fingerprints yet' })
      }
      expect((await get('/scan/fingerprints?game=op', 'owner')).status).toBe(200)
      expect((await get('/scan/fingerprints?game=op', 'luffy')).status).toBe(200)
    })

    it('stays the same when nothing is stored, so it gives nothing away', async () => {
      deps.images.store.delete('scan/op/fingerprints.bin')
      const hidden = await get('/scan/fingerprints?game=op', 'zoro')
      const owners = await get('/scan/fingerprints?game=op', 'owner')
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
    it('with ygo, zoro sees no One Piece row', async () => {
      const F = { sort: 'added', dir: 'desc' }
      const calls: [string, unknown[]][] = [
        ['friends:collection', [luffy, F]],
        ['friends:stats', [luffy]],
        ['friends:sets', [luffy]],
        ['friends:binders', [luffy]],
        ['friends:wishlist', [luffy]],
        ['friends:forCard', [op.cardIds[0]]]
      ]
      for (const [channel, args] of calls) {
        const r = await rpc(channel, args, 'zoro', 'ygo')
        expect(r.status, channel).toBe(200)
        const text = JSON.stringify(r.body)
        expect(text, channel).not.toContain('Monkey.D.Luffy')
        expect(text, channel).not.toContain('Straw Hats')
        expect(text, channel).not.toContain('OP01')
      }
      expect((await rpc('friends:collection', [luffy, F], 'zoro', 'ygo')).body.result).toEqual([])
      expect((await rpc('friends:binders', [luffy], 'zoro', 'ygo')).body.result).toEqual([])
    })

    it('with op, zoro gets 403', async () => {
      for (const channel of ['friends:collection', 'friends:binders', 'friends:wishlist'])
        expect(
          (await rpc(channel, [luffy, { sort: 'added', dir: 'desc' }], 'zoro', 'op')).status
        ).toBe(403)
    })

    it("with op, a tester friend sees luffy's entry", async () => {
      const r = await rpc(
        'friends:collection',
        [luffy, { sort: 'added', dir: 'desc' }],
        'nami',
        'op'
      )
      expect(r.status).toBe(200)
      expect(r.body.result).toHaveLength(1)
      expect(r.body.result[0].card.name).toBe('Monkey.D.Luffy')
      const b = await rpc('friends:binders', [luffy], 'nami', 'op')
      expect(b.body.result.map((x: { name: string }) => x.name)).toEqual(['Straw Hats'])
    })
  })

  it('art is not hidden', async () => {
    const res = await send(`/img/small/${op.imageIds[0]}`, null)
    expect(res.status).not.toBe(403)
  })

  it('removed tester', async () => {
    const before = db
      .prepare('SELECT server_seq, deleted_at FROM collection_entries WHERE user_id = ?')
      .get(luffy) as { server_seq: number; deleted_at: string | null }
    db.prepare('DELETE FROM game_testers WHERE user_id = ?').run(luffy)
    expect(gamesFor(deps, luffy)).not.toContain('op')
    const me = (await (await send('/api/me', 'luffy')).json()) as { games: string[] }
    expect(me.games).not.toContain('op')
    expect((await send('/api/sync/pull?cursor=0&game=op', 'luffy')).status).toBe(403)
    const after = db
      .prepare('SELECT server_seq, deleted_at FROM collection_entries WHERE user_id = ?')
      .get(luffy) as { server_seq: number; deleted_at: string | null }
    expect(after).toEqual(before)
    expect(after.deleted_at).toBeNull()
  })
})
