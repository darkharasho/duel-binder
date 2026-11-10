import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { mtgImageId, onePieceImageId, tokenId } from '../../src/shared/games/ids'
import {
  BULBAGARDEN_IMAGE_PREFIX,
  HAND_ART_PREFIX,
  KONAMI_LOGO_PREFIX,
  PACK_ART_PREFIX,
  POKEMONTCG_IMAGE_PREFIX,
  YUGIPEDIA_IMAGE_PREFIX
} from '../../src/shared/imageSources'
import { encode } from 'jpeg-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jpegSize } from '../../src/shared/upright'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { TCGPLAYER_IMAGE_PREFIX } from '../../src/main/tcgplayer/catalog'
import {
  ANON_IMAGE_GLOBAL_LIMIT,
  ANON_IMAGE_LIMIT,
  clientAddressKey,
  createAnonImageQuota,
  createImageQuota,
  createMissCache,
  edgeImage
} from '../../workers/portal/src/images'
import { seedMagic } from '../fixtures/magic'
import { seedOnePiece } from '../fixtures/onePiece'
import { addUser, memoryBucket, noPrices, seededServerDb } from './helpers'

const BASE = 'https://app.test'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const imageResponse = (): Response =>
  new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })

describe('token card art', () => {
  const YP = 'https://ms.yugipedia.com/'
  const image = tokenId(777)
  let db: Database.Database
  let upstream: ReturnType<typeof vi.fn>
  let deps: AppDeps
  const tokenArt = vi.fn(async (): Promise<string | null> => `${YP}a/ab/Token.png`)

  beforeEach(async () => {
    db = await seededServerDb()
    tokenArt.mockClear()
    upstream = vi.fn(async () => imageResponse())
    const card = tokenId(1)
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'Token (Nash)', 'Token', 'token', 'Token', '', '2026-10-25')`
    ).run(card)
    db.prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, ?, 0)').run(
      image,
      card
    )
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: { url: vi.fn(async () => null) },
      tokenArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      fetch: upstream as unknown as typeof fetch
    }
  })
  afterEach(() => db.close())

  const get = (path: string): Promise<Response> =>
    handle(
      new Request(`${BASE}/img/${path}`, { headers: { 'cf-connecting-ip': '198.51.100.7' } }),
      deps
    )

  test('comes from Yugipedia, signed out too, and never from YGOPRODeck', async () => {
    expect((await get(`full/${image}`)).status).toBe(200)
    // Fetched from img: ms, the host kept in stored URLs, only redirects there now.
    expect(upstream.mock.calls[0][0]).toBe('https://img.yugipedia.com/a/ab/Token.png')
    expect(tokenArt).toHaveBeenCalledWith(image)
  })

  describe('art over the size limit', () => {
    const TOO_BIG = 16 * 1024 * 1024
    const header = (): Response =>
      new Response(JPEG, {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(TOO_BIG) }
      })
    const signedIn = (path: string): Promise<Response> =>
      handle(new Request(`${BASE}/img/${path}`, { headers: { cookie: 'session=tok' } }), deps)

    beforeEach(() => {
      db.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
      ).run(
        createHash('sha256').update('tok').digest('hex'),
        addUser(db, '1', 'alice'),
        '2026-10-25T11:00:00.000Z',
        '2026-10-25T23:00:00.000Z'
      )
      deps.anonMisses = createMissCache(() => 0, { ttlMs: 3_600_000, maxKeys: 100 })
      deps.imageQuota = createImageQuota(() => 0, { limit: 1, windowMs: 3_600_000 })
    })

    test('is remembered, so a signed-in view spends no quota, Yugipedia call or fetch', async () => {
      upstream.mockImplementation(async () => header())
      expect((await signedIn(`full/${image}`)).status).toBe(404)
      expect((await signedIn(`full/${image}`)).status).toBe(404) // not 429: the quota of 1 is spent
      expect((await signedIn(`small/${image}`)).status).toBe(404) // one image for all sizes
      expect(tokenArt).toHaveBeenCalledTimes(1)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    test('is remembered from a signed-out view for signed-in ones, and the other way', async () => {
      upstream.mockImplementation(async () => header())
      expect((await get(`full/${image}`)).status).toBe(404)
      expect((await signedIn(`full/${image}`)).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(1)

      const other = tokenId(779)
      db.prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, ?, 1)').run(
        other,
        tokenId(1)
      )
      deps.imageQuota = createImageQuota(() => 0, { limit: 10, windowMs: 3_600_000 })
      expect((await signedIn(`full/${other}`)).status).toBe(404)
      expect((await get(`full/${other}`)).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(2)
    })

    test('is told by the body when no content-length says so', async () => {
      upstream.mockImplementation(
        async () =>
          new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
            headers: { 'content-type': 'image/jpeg' }
          })
      )
      expect((await signedIn(`full/${image}`)).status).toBe(404)
      expect((await signedIn(`full/${image}`)).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    test('any other failure stays open to signed-in callers', async () => {
      deps.imageQuota = createImageQuota(() => 0, { limit: 10, windowMs: 3_600_000 })
      upstream.mockRejectedValueOnce(new Error('timeout'))
      expect((await signedIn(`full/${image}`)).status).toBe(404)
      expect((await signedIn(`full/${image}`)).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(2)
    })

    test('works without a miss cache', async () => {
      deps.anonMisses = undefined
      upstream.mockImplementation(async () => header())
      expect((await get(`full/${image}`)).status).toBe(404)
    })
  })

  test('is stored once, so no size asks Yugipedia again', async () => {
    await get(`small/${image}`)
    tokenArt.mockClear()
    upstream.mockClear()
    expect((await get(`full/${image}`)).status).toBe(200)
    expect((await get(`cropped/${image}`)).status).toBe(200)
    expect(tokenArt).not.toHaveBeenCalled()
    expect(upstream).not.toHaveBeenCalled()
  })

  test('404s for an id the catalog lacks, a foreign host, and a failed lookup', async () => {
    expect((await get(`full/${tokenId(778)}`)).status).toBe(404)
    tokenArt.mockResolvedValueOnce('https://evil.test/x.png')
    expect((await get(`full/${image}`)).status).toBe(404)
    tokenArt.mockRejectedValueOnce(new Error('down'))
    expect((await get(`small/${image}`)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('image route', () => {
  let db: Database.Database
  let bucket: ReturnType<typeof memoryBucket>
  let upstream: ReturnType<typeof vi.fn>
  let deps: AppDeps
  let imageId: number
  let printingUrl: string | null
  const printingArt = { url: vi.fn(async () => printingUrl) }

  beforeEach(async () => {
    db = await seededServerDb()
    printingUrl = null
    printingArt.url.mockClear()
    bucket = memoryBucket()
    upstream = vi.fn(async () => imageResponse())
    imageId = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number })
      .image_id
    const uid = addUser(db, '1', 'alice')
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tok')))
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(hash, uid, '2026-10-25T11:00:00.000Z', '2026-10-25T23:00:00.000Z')
    cookie = 'session=tok'
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      printingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      fetch: upstream as unknown as typeof fetch
    }
  })
  afterEach(() => db.close())

  let cookie = ''
  const get = (path: string, method = 'GET'): Promise<Response> =>
    handle(new Request(`${BASE}/img/${path}`, { method, headers: { cookie } }), deps)
  const getAnon = (path: string): Promise<Response> =>
    handle(new Request(`${BASE}/img/${path}`), deps)
  const getFrom = (ip: string, path: string, withCookie = false): Promise<Response> =>
    handle(
      new Request(`${BASE}/img/${path}`, {
        headers: { 'cf-connecting-ip': ip, ...(withCookie && { cookie }) }
      }),
      deps
    )

  describe('Pokédex sprites', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    it('serves a stored sprite signed out and signed in, and never fetches upstream', async () => {
      await bucket.put('sprite/6.png', PNG.buffer, { httpMetadata: { contentType: 'image/png' } })
      for (const res of [await getAnon('sprite/6'), await get('sprite/6')]) {
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/png')
        expect(res.headers.get('cache-control')).toContain('immutable')
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
      }
      expect(upstream).not.toHaveBeenCalled()
    })

    it('404s ids outside the Pokédex and odd paths', async () => {
      await bucket.put('sprite/1025.png', PNG.buffer, {
        httpMetadata: { contentType: 'image/png' }
      })
      await bucket.put('sprite/0.png', PNG.buffer, { httpMetadata: { contentType: 'image/png' } })
      await bucket.put('sprite/1026.png', PNG.buffer, {
        httpMetadata: { contentType: 'image/png' }
      })
      expect((await getAnon('sprite/1025')).status).toBe(200)
      for (const p of [
        'sprite/0',
        'sprite/1026',
        'sprite/6/x',
        'sprite/abc',
        'sprite/06',
        'sprite'
      ])
        expect((await getAnon(p)).status).toBe(404)
    })

    it('404s an R2 miss with no upstream fetch', async () => {
      expect((await getAnon('sprite/7')).status).toBe(404)
      expect((await get('sprite/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })
  })

  describe('Pokémon art and set logos', () => {
    const PKM = 2 ** 40
    const addPokemon = (n: number, url: string | null, name = 'Pika'): number => {
      const id = PKM + n
      db.prepare(
        "INSERT INTO cards (id, name, type, frame_type, race, \"desc\", updated_at, game) VALUES (?, ?, 'Pokemon', 'pokemon', '', '', 'x', 'pkm')"
      ).run(id, name)
      db.prepare(
        "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
      ).run(id, id)
      db.prepare(
        "INSERT INTO pokemon_cards (card_id, category, source_id, image_url) VALUES (?, 'Pokemon', ?, ?)"
      ).run(id, `s${n}`, url)
      return id
    }
    const addSet = (key: string, url: string | null, game = 'pkm'): void => {
      db.prepare(
        'INSERT INTO sets (game, language, set_name, set_code, image_url, image_key) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(game, 'en', `set ${key}`, 'x', url, key)
    }

    it('fetches TCGdex full and small art', async () => {
      const id = addPokemon(1, 'https://assets.tcgdex.net/en/sv/sv01/001')
      expect((await get(`full/${id}`)).status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe('https://assets.tcgdex.net/en/sv/sv01/001/high.webp')
      expect((await getFrom('1.2.3.4', `small/${id}`)).status).toBe(200) // signed-out fill
      expect(upstream.mock.calls[1][0]).toBe('https://assets.tcgdex.net/en/sv/sv01/001/low.webp')
      expect(bucket.store.has(`card/full/${id}`)).toBe(true)
    })

    it('serves owner-supplied art from R2 only, and never fetches it', async () => {
      const id = addPokemon(9, `${HAND_ART_PREFIX}en-me06-011`)
      expect((await get(`small/${id}`)).status).toBe(404)
      await bucket.put('hand/en-me06-011/low.jpg', JPEG.buffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      })
      await bucket.put('hand/en-me06-011/high.jpg', JPEG.buffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      })
      expect((await getAnon(`small/${id}`)).status).toBe(200)
      expect((await getAnon(`full/${id}`)).status).toBe(200)
      // The catalog job fingerprints the file itself, at its URL.
      expect((await getAnon('hand/en-me06-011/low.jpg')).status).toBe(200)
      expect((await getAnon('hand/en-me06-011/..%2Fsecret.jpg')).status).toBe(404)
      expect((await getAnon('hand/en-me06-011')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('fetches TCGplayer art at the requested size', async () => {
      const id = addPokemon(2, 'https://tcgplayer-cdn.tcgplayer.com/product/487828_200w.jpg')
      await get(`full/${id}`)
      await get(`small/${id}`)
      expect(upstream.mock.calls[0][0]).toBe(
        'https://tcgplayer-cdn.tcgplayer.com/product/487828_in_1000x1000.jpg'
      )
      expect(upstream.mock.calls[1][0]).toBe(
        'https://tcgplayer-cdn.tcgplayer.com/product/487828_200w.jpg'
      )
    })

    it('stands sideways TCGplayer art (a LEGEND half) upright before keeping it', async () => {
      const landscape = new Uint8Array(
        encode({ width: 42, height: 30, data: new Uint8Array(42 * 30 * 4).fill(128) }, 90).data
      )
      const portrait = new Uint8Array(
        encode({ width: 30, height: 42, data: new Uint8Array(30 * 42 * 4).fill(128) }, 90).data
      )
      const jpeg = (b: Uint8Array<ArrayBuffer>) => async () =>
        new Response(b, { status: 200, headers: { 'content-type': 'image/jpeg' } })
      const legend = addPokemon(
        10,
        'https://tcgplayer-cdn.tcgplayer.com/product/716199_200w.jpg',
        'Darkrai & Cresselia LEGEND'
      )
      upstream.mockImplementationOnce(jpeg(landscape))
      const res = await get(`small/${legend}`)
      expect(jpegSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 30, height: 42 })
      expect(jpegSize(new Uint8Array(bucket.store.get(`card/small/${legend}`)!.bytes))).toEqual({
        width: 30,
        height: 42
      })
      // A portrait one is kept byte for byte.
      const plain = addPokemon(11, 'https://tcgplayer-cdn.tcgplayer.com/product/487828_200w.jpg')
      upstream.mockImplementationOnce(jpeg(portrait))
      await get(`small/${plain}`)
      expect(new Uint8Array(bucket.store.get(`card/small/${plain}`)!.bytes)).toEqual(portrait)
      // A BREAK card is landscape as it stands: kept as it came.
      const brk = addPokemon(
        12,
        'https://tcgplayer-cdn.tcgplayer.com/product/716162_200w.jpg',
        'Greninja BREAK'
      )
      upstream.mockImplementationOnce(jpeg(landscape))
      await get(`small/${brk}`)
      expect(new Uint8Array(bucket.store.get(`card/small/${brk}`)!.bytes)).toEqual(landscape)
    })

    it('serves cropped Pokémon art as the small art, under its own key', async () => {
      const id = addPokemon(7, 'https://assets.tcgdex.net/en/sv/sv01/001')
      expect((await get(`cropped/${id}`)).status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe('https://assets.tcgdex.net/en/sv/sv01/001/low.webp')
      expect(bucket.store.has(`card/cropped/${id}`)).toBe(true)
      const tp = addPokemon(8, 'https://tcgplayer-cdn.tcgplayer.com/product/487828_200w.jpg')
      await get(`cropped/${tp}`)
      expect(upstream.mock.calls[1][0]).toBe(
        'https://tcgplayer-cdn.tcgplayer.com/product/487828_200w.jpg'
      )
    })

    it('404s a foreign host, a lookalike host and a null url without fetching', async () => {
      const evil = addPokemon(3, 'https://evil.example/x')
      const like = addPokemon(4, 'https://assets.tcgdex.net.evil.com/en/x')
      const none = addPokemon(5, null)
      for (const p of [
        `full/${evil}`,
        `full/${like}`,
        `small/${none}`,
        `cropped/${none}`,
        `full/${PKM + 99}`
      ]) {
        expect((await get(p)).status).toBe(404)
      }
      expect(upstream).not.toHaveBeenCalled()
    })

    it('serves a TCGdex set logo', async () => {
      addSet('td-en-sv01', 'https://assets.tcgdex.net/en/sv/sv01/logo')
      expect((await get('set/td-en-sv01')).status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe('https://assets.tcgdex.net/en/sv/sv01/logo.webp')
    })

    const addArt = (key: string, url: string, kind = 'pack'): void => {
      db.prepare(
        'INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES (?, ?, ?, 0, ?, ?)'
      ).run('en', `art ${key}`, kind, url, key)
    }

    it('serves Bulbagarden pack art and Pokémon TCG API logos with a User-Agent, then from R2', async () => {
      const pack = `${BULBAGARDEN_IMAGE_PREFIX}a/ab/SV1_Booster_Koraidon.png`
      addArt('bp-pack', pack)
      addArt('pt-logo', `${POKEMONTCG_IMAGE_PREFIX}sm35/logo.png`, 'logo')
      expect((await get('set/bp-pack')).status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe(pack)
      expect((upstream.mock.calls[0][1] as RequestInit).headers).toEqual({
        'User-Agent': 'DuelBinder/portal (https://github.com/darkharasho/duel-binder)'
      })
      expect((await get('set/pt-logo')).status).toBe(200)
      expect(upstream.mock.calls[1][0]).toBe(`${POKEMONTCG_IMAGE_PREFIX}sm35/logo.png`)
      expect(bucket.store.has('set/bp-pack')).toBe(true)
      expect((await get('set/bp-pack')).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(2)
      addArt('pt-new', 'https://images.scrydex.com/pokemon/me55-logo/logo', 'logo')
      expect((await get('set/pt-new')).status).toBe(200)
    })

    it('404s Pokémon set art keys that are unknown, off-prefix or cross-source, and signed-out fills', async () => {
      addArt('bp-evil', 'https://evil.example/x.png')
      addArt('pt-swap', `${BULBAGARDEN_IMAGE_PREFIX}a/ab/X.png`, 'logo')
      addArt('bp-ok', `${BULBAGARDEN_IMAGE_PREFIX}a/ab/Y.png`)
      for (const k of ['bp-nope', 'bp-evil', 'pt-swap']) {
        expect((await get(`set/${k}`)).status).toBe(404)
      }
      expect((await getFrom('1.2.3.4', 'set/bp-ok')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('warms set art into R2 for the admin token only', async () => {
      addArt('bp-warm', `${BULBAGARDEN_IMAGE_PREFIX}a/ab/W.png`)
      const warm = (body: unknown, token = 'a'): Promise<Response> =>
        handle(
          new Request(`${BASE}/admin/img/warm`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body)
          }),
          deps
        )
      expect((await warm({ path: 'set/bp-warm' }, 'wrong')).status).toBe(401)
      expect(await (await warm({ path: 'set/bp-warm' })).json()).toEqual({ result: 'stored' })
      expect(bucket.store.has('set/bp-warm')).toBe(true)
      expect(await (await warm({ path: 'set/bp-warm' })).json()).toEqual({ result: 'cached' })
      expect(await (await warm({ path: 'set/bp-nope' })).json()).toEqual({ result: 'missing' })
      expect(await (await warm({ path: `small/${imageId}` })).json()).toEqual({ result: 'missing' })
      expect((await warm({})).status).toBe(400)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    it('404s an unknown td- key, a foreign logo host and a non-pkm row without fetching', async () => {
      addSet('td-en-bad', 'https://evil.example/logo')
      addSet('td-en-ygo', 'https://assets.tcgdex.net/en/x/logo', 'ygo')
      for (const k of ['td-en-nope', 'td-en-bad', 'td-en-ygo'])
        expect((await get(`set/${k}`)).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('serves a One Piece pack shot from Bandai, and 404s one off Bandai or on another game', async () => {
      const shot =
        'https://en.onepiece-cardgame.com/renewal/images/products/boosters/op01/img_item01.webp'
      addSet('ob-0123456789abcdef0123', shot, 'op')
      addSet('ob-bad', 'https://evil.example/pack.webp', 'op')
      addSet('ob-ygo', shot, 'ygo')
      for (const k of ['ob-nope', 'ob-bad', 'ob-ygo'])
        expect((await get(`set/${k}`)).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect((await get('set/ob-0123456789abcdef0123')).status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe(shot)
    })
  })

  it('an op id never takes the Yu-Gi-Oh path', async () => {
    const id = onePieceImageId('en', 'OP01-001')
    expect((await get(`small/${id}`)).status).toBe(404)
    // Even with a catalog row, no YGOPRODeck url is built for it.
    db.prepare(
      "INSERT INTO cards (id, name, type, frame_type, race, \"desc\", updated_at, game) VALUES (?, 'Luffy', 'Leader', 'op', '', '', 'x', 'op')"
    ).run(id)
    db.prepare(
      "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'op')"
    ).run(id, id)
    expect((await get(`small/${id}`)).status).toBe(404)
    expect(
      upstream.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('ygoprodeck'))
    ).toEqual([])
  })

  it('serves a card image from upstream once, then from R2', async () => {
    const first = await get(`small/${imageId}`)
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/jpeg')
    expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(JPEG)
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(upstream.mock.calls[0][0]).toBe(
      `https://images.ygoprodeck.com/images/cards_small/${imageId}.jpg`
    )
    expect(bucket.store.has(`card/small/${imageId}`)).toBe(true)

    const second = await get(`small/${imageId}`)
    expect(second.status).toBe(200)
    expect(second.headers.get('content-type')).toBe('image/jpeg')
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('signed-out R2 miss with no client address answers 404 without any upstream call', async () => {
    printingUrl = `${YUGIPEDIA_IMAGE_PREFIX}x.jpg`
    for (const path of [`small/${imageId}`, 'printing/1']) {
      const res = await getAnon(path)
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('Not found')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    }
    expect(upstream).not.toHaveBeenCalled()
    expect(printingArt.url).not.toHaveBeenCalled()
  })

  it('signed-out R2 hit is still served', async () => {
    await get(`small/${imageId}`)
    upstream.mockClear()
    const res = await getAnon(`small/${imageId}`)
    expect(res.status).toBe(200)
    expect(upstream).not.toHaveBeenCalled()
  })

  describe('signed-out card art (iOS app)', () => {
    const IP = '203.0.113.7'

    it('fetches a known small/full/cropped image upstream, stores it and answers 200', async () => {
      for (const kind of ['small', 'full', 'cropped']) {
        const res = await getFrom(IP, `${kind}/${imageId}`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/jpeg')
        expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
        expect(bucket.store.has(`card/${kind}/${imageId}`)).toBe(true)
      }
      expect(upstream.mock.calls.map((c) => c[0])).toEqual([
        `https://images.ygoprodeck.com/images/cards_small/${imageId}.jpg`,
        `https://images.ygoprodeck.com/images/cards/${imageId}.jpg`,
        `https://images.ygoprodeck.com/images/cards_cropped/${imageId}.jpg`
      ])
      expect((await getFrom(IP, `small/${imageId}`)).status).toBe(200) // now an R2 hit
      expect(upstream).toHaveBeenCalledTimes(3)
    })

    it('unknown or malformed ids answer 404 without fetching', async () => {
      for (const path of ['small/999999999', 'full/abc', 'cropped/0', 'huge/1']) {
        expect((await getFrom(IP, path)).status).toBe(404)
      }
      expect(upstream).not.toHaveBeenCalled()
    })

    it("fetches a known printing's photo for the phone, metered before the lookup", async () => {
      const id = (db.prepare('SELECT id FROM card_printings LIMIT 1').get() as { id: number }).id
      printingUrl = `${YUGIPEDIA_IMAGE_PREFIX}x.jpg`
      const res = await getFrom(IP, `printing/${id}`)
      expect(res.status).toBe(200)
      expect(printingArt.url).toHaveBeenCalledWith(id)
      expect([...bucket.store.keys()].some((k) => k.startsWith(`printing/${id}`))).toBe(true)
      // An id the catalog doesn't have isn't looked up for a signed-out caller.
      printingArt.url.mockClear()
      expect((await getFrom(IP, 'printing/999999999')).status).toBe(404)
      expect(printingArt.url).not.toHaveBeenCalled()
    })

    it("a signed-out printing lookup spends the address's quota even when no photo is found", async () => {
      const t = 1_000_000
      deps.anonImageQuota = createImageQuota<string>(() => t, { limit: 1, windowMs: 3_600_000 })
      const ids = (
        db.prepare('SELECT id FROM card_printings LIMIT 2').all() as { id: number }[]
      ).map((r) => r.id)
      printingUrl = null
      expect((await getFrom(IP, `printing/${ids[0]}`)).status).toBe(404)
      expect((await getFrom(IP, `printing/${ids[1]}`)).status).toBe(429)
      expect(printingArt.url).toHaveBeenCalledTimes(1)
    })

    it('set and konami misses still need a session', async () => {
      db.prepare(
        "INSERT INTO konami_logos (set_name, image_url, image_key) VALUES ('Set', ?, 'km-abc')"
      ).run(`${KONAMI_LOGO_PREFIX}logos/a.png`)
      db.prepare(
        "INSERT INTO sets (language, set_name, set_code, image_url, image_key) VALUES ('en', 'Cover Set', 'CVR', ?, 'yp-abc123')"
      ).run('https://ms.yugipedia.com/a/ab/Cover.png')
      for (const path of ['set/LOB', 'set/yp-abc123', 'konami/km-abc']) {
        const res = await getFrom(IP, path)
        expect(res.status).toBe(404)
      }
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('meters each address separately from signed-in users', async () => {
      let t = 1_000_000
      deps.anonImageQuota = createImageQuota<string>(() => t, { limit: 2, windowMs: 3_600_000 })
      deps.imageQuota = createImageQuota(() => t, { limit: 2, windowMs: 3_600_000 })
      const ids = (
        db.prepare('SELECT image_id FROM card_images LIMIT 4').all() as { image_id: number }[]
      ).map((r) => r.image_id)
      expect(ids.length).toBe(4)
      expect((await getFrom(IP, `small/${ids[0]}`)).status).toBe(200)
      expect((await getFrom(IP, `small/${ids[1]}`)).status).toBe(200)
      const limited = await getFrom(IP, `small/${ids[2]}`)
      expect(limited.status).toBe(429)
      expect(await limited.text()).toBe('Too many requests')
      expect(limited.headers.get('retry-after')).toBe('3600')
      expect(limited.headers.get('x-content-type-options')).toBe('nosniff')
      expect(upstream).toHaveBeenCalledTimes(2)
      // Stored art stays free.
      expect((await getFrom(IP, `small/${ids[0]}`)).status).toBe(200)
      // Another address has its own budget.
      expect((await getFrom('198.51.100.9', `small/${ids[2]}`)).status).toBe(200)
      // A signed-in user from the same address spends their own quota, untouched by the anonymous one.
      expect((await getFrom(IP, `full/${ids[3]}`, true)).status).toBe(200)
      expect((await getFrom(IP, `cropped/${ids[3]}`, true)).status).toBe(200)
      expect((await getFrom(IP, `full/${ids[2]}`, true)).status).toBe(429)
      expect(upstream).toHaveBeenCalledTimes(5)
      // The window rolls over.
      t += 3_600_000
      expect((await getFrom(IP, `small/${ids[2]}`)).status).toBe(200)
    })

    it('unwraps IPv4-mapped IPv6 and groups other IPv6 by /56', () => {
      const key = (ip: string): string | null =>
        clientAddressKey(new Request(BASE, { headers: { 'cf-connecting-ip': ip } }))
      expect(key('203.0.113.7')).toBe('203.0.113.7')
      expect(key('::ffff:203.0.113.7')).toBe('203.0.113.7')
      expect(key('0:0:0:0:0:FFFF:203.0.113.7')).toBe('203.0.113.7')
      expect(key('2001:db8:0:1::1')).toBe('2001:db8:0:0::/56')
      expect(key('2001:db8:0:1ff::1')).toBe('2001:db8:0:100::/56')
      expect(key('2001:DB8:0000:12AB:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1200::/56')
      expect(key('2001:db8::5')).toBe('2001:db8:0:0::/56')
      expect(key('::1')).toBe('0:0:0:0::/56')
      expect(clientAddressKey(new Request(BASE))).toBeNull()
    })

    it('a shared hourly ceiling caps all signed-out fetches but not signed-in ones', async () => {
      let t = 1_000_000
      deps.anonImageQuota = createAnonImageQuota(() => t, { perAddress: 2, global: 3 })
      deps.imageQuota = createImageQuota(() => t, { limit: 5, windowMs: 3_600_000 })
      const ids = (
        db.prepare('SELECT image_id FROM card_images LIMIT 4').all() as { image_id: number }[]
      ).map((r) => r.image_id)
      expect((await getFrom('198.51.100.1', `small/${ids[0]}`)).status).toBe(200)
      expect((await getFrom('198.51.100.2', `small/${ids[1]}`)).status).toBe(200)
      t += 600_000
      expect((await getFrom('198.51.100.3', `small/${ids[2]}`)).status).toBe(200)
      const limited = await getFrom('198.51.100.4', `small/${ids[3]}`)
      expect(limited.status).toBe(429)
      expect(await limited.text()).toBe('Too many requests')
      expect(limited.headers.get('retry-after')).toBe('3000') // the ceiling's window opened 10 min earlier
      expect(upstream).toHaveBeenCalledTimes(3)
      expect((await getFrom('198.51.100.4', `small/${ids[3]}`, true)).status).toBe(200) // signed in
      t += 3_000_000
      expect((await getFrom('198.51.100.4', `full/${ids[3]}`)).status).toBe(200)
    })

    it('the Worker defaults: per address and shared ceiling, and a full ceiling opens no address windows', () => {
      let t = 0
      const quota = createAnonImageQuota(() => t)
      for (let i = 0; i < ANON_IMAGE_LIMIT; i++) expect(quota.take(IP)).toBe(true)
      expect(quota.take(IP)).toBe(false)
      expect(quota.retryAfterMs(IP)).toBe(3_600_000)
      let n = ANON_IMAGE_LIMIT
      for (let a = 0; n < ANON_IMAGE_GLOBAL_LIMIT; a++) {
        for (let i = 0; i < ANON_IMAGE_LIMIT && n < ANON_IMAGE_GLOBAL_LIMIT; i++, n++)
          expect(quota.take(`10.0.0.${a}`)).toBe(true)
      }
      t = 1000
      expect(quota.take('192.0.2.1')).toBe(false)
      expect(quota.retryAfterMs('192.0.2.1')).toBe(3_599_000)
      expect(quota.exhausted('192.0.2.1')).toBe(true)
      t = 3_600_000
      expect(quota.take('192.0.2.1')).toBe(true)
    })

    it('remembers an upstream failure and answers signed-out callers 404 without refetching', async () => {
      const t = 0
      deps.anonMisses = createMissCache(() => t, { ttlMs: 3_600_000, maxKeys: 100 })
      upstream.mockResolvedValueOnce(
        new Response('nope', { status: 404, headers: { 'content-type': 'image/jpeg' } })
      )
      expect((await getFrom(IP, `cropped/${imageId}`)).status).toBe(404)
      expect((await getFrom('198.51.100.9', `cropped/${imageId}`)).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(1)
      // Other sizes of the same card are their own keys.
      expect((await getFrom(IP, `small/${imageId}`)).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(2)
      // Signed-in callers still try upstream.
      expect((await getFrom(IP, `cropped/${imageId}`, true)).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(3)
    })

    it('forgets a remembered failure after the TTL', async () => {
      let t = 0
      deps.anonMisses = createMissCache(() => t, { ttlMs: 3_600_000, maxKeys: 100 })
      upstream.mockRejectedValueOnce(new Error('timeout'))
      expect((await getFrom(IP, `full/${imageId}`)).status).toBe(404)
      t = 3_599_999
      expect((await getFrom(IP, `full/${imageId}`)).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(1)
      t = 3_600_000
      expect((await getFrom(IP, `full/${imageId}`)).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(2)
    })

    it('the miss cache is bounded and drops its oldest entry first', () => {
      const misses = createMissCache(() => 0, { ttlMs: 1000, maxKeys: 2 })
      misses.add('a')
      misses.add('b')
      misses.add('a') // refreshed: now the newest
      misses.add('c')
      expect(misses.has('b')).toBe(false)
      expect(misses.has('a')).toBe(true)
      expect(misses.has('c')).toBe(true)
    })

    it('a capped quota evicts the oldest address; the signed-in quota never evicts', () => {
      const capped = createImageQuota<string>(() => 0, { limit: 1, windowMs: 1000, maxKeys: 2 })
      expect(capped.take('a')).toBe(true)
      expect(capped.take('b')).toBe(true)
      expect(capped.take('c')).toBe(true) // evicts a
      expect(capped.exhausted('b')).toBe(true)
      expect(capped.exhausted('a')).toBe(false)
      const signedIn = createImageQuota(() => 0, { limit: 1, windowMs: 1000 })
      for (let id = 0; id <= 20_001; id++) signedIn.take(id)
      expect(signedIn.take(0)).toBe(false)
    })

    it('sweeps expired windows at most once a minute', () => {
      let t = 0
      const quota = createImageQuota<string>(() => t, { limit: 1, windowMs: 1000, maxKeys: 1000 })
      const scans = vi.spyOn(Map.prototype, Symbol.iterator)
      try {
        for (let i = 0; i < 50; i++, t += 500) quota.take(`k${i}`) // 25 s of new keys
        expect(scans).toHaveBeenCalledTimes(1)
        t = 60_000
        quota.take('late')
        expect(scans).toHaveBeenCalledTimes(2)
      } finally {
        scans.mockRestore()
      }
      // That sweep dropped the expired windows, so their keys start fresh.
      expect(quota.exhausted('k0')).toBe(false)
      expect(quota.exhausted('late')).toBe(true)
    })
  })

  it('uses the full and cropped folders', async () => {
    await get(`full/${imageId}`)
    await get(`cropped/${imageId}`)
    expect(upstream.mock.calls.map((c) => c[0])).toEqual([
      `https://images.ygoprodeck.com/images/cards/${imageId}.jpg`,
      `https://images.ygoprodeck.com/images/cards_cropped/${imageId}.jpg`
    ])
  })

  it('unknown image id answers 404 without fetching', async () => {
    expect((await get('small/999999999')).status).toBe(404)
    expect((await get('small/abc')).status).toBe(404)
    expect((await get('small/0')).status).toBe(404)
    expect((await get('huge/1')).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('upstream 404 or non-image answers 404 and stores nothing', async () => {
    upstream.mockResolvedValueOnce(
      new Response('nope', { status: 404, headers: { 'content-type': 'image/jpeg' } })
    )
    expect((await get(`small/${imageId}`)).status).toBe(404)
    upstream.mockResolvedValueOnce(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )
    expect((await get(`small/${imageId}`)).status).toBe(404)
    upstream.mockRejectedValueOnce(new Error('network'))
    expect((await get(`small/${imageId}`)).status).toBe(404)
    expect(bucket.store.size).toBe(0)
  })

  describe('set image keys', () => {
    it('plain key maps to the YGOPRODeck sets URL', async () => {
      const res = await get('set/LOB')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
      expect(upstream.mock.calls[0][0]).toBe('https://images.ygoprodeck.com/images/sets/LOB.jpg')
      expect(bucket.store.has('set/LOB')).toBe(true)
    })

    it('yp- key resolves through the sets table and sends a User-Agent', async () => {
      const url = 'https://ms.yugipedia.com/a/ab/Cover.png'
      db.prepare(
        "INSERT INTO sets (language, set_name, set_code, image_url, image_key) VALUES ('en', 'Cover Set', 'CVR', ?, 'yp-abc123')"
      ).run(url)
      const res = await get('set/yp-abc123')
      expect(res.status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe('https://img.yugipedia.com/a/ab/Cover.png')
      expect((upstream.mock.calls[0][1] as RequestInit).headers).toEqual({
        'User-Agent': 'DuelBinder/portal (https://github.com/darkharasho/duel-binder)'
      })
    })

    it('yp- key whose stored URL is off-prefix, or unknown, answers 404', async () => {
      db.prepare(
        "INSERT INTO sets (language, set_name, set_code, image_url, image_key) VALUES ('en', 'Evil Set', 'EVL', 'https://evil.test/x.png', 'yp-evil')"
      ).run()
      expect((await get('set/yp-evil')).status).toBe(404)
      expect((await get('set/yp-missing')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('km- and malformed keys answer 404', async () => {
      expect((await get('set/km-anything')).status).toBe(404)
      expect((await get('set/..%2Fx')).status).toBe(404)
      expect((await get('set/../x')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })
  })

  it('yc- key resolves through pack_art and fetches the official URL', async () => {
    const url = `${PACK_ART_PREFIX}2024/01/pack.jpg`
    db.prepare(
      "INSERT INTO pack_art (set_name, image_url, image_key) VALUES ('Pack', ?, 'yc-abc')"
    ).run(url)
    const res = await get('set/yc-abc')
    expect(res.status).toBe(200)
    expect(upstream.mock.calls[0][0]).toBe(url)
  })

  it('serves only jpeg, png, webp and gif, ignoring parameters', async () => {
    for (const type of ['image/svg+xml', 'image/x-icon', 'text/html']) {
      upstream.mockResolvedValueOnce(new Response('<svg/>', { headers: { 'content-type': type } }))
      expect((await get(`small/${imageId}`)).status).toBe(404)
    }
    expect(bucket.store.size).toBe(0)
    upstream.mockResolvedValueOnce(
      new Response(JPEG, { headers: { 'content-type': 'Image/PNG; charset=binary' } })
    )
    const ok = await get(`small/${imageId}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
  })

  it('locks down every response', async () => {
    for (const res of [
      await get(`small/${imageId}`),
      await get('small/0'),
      await get(`small/${imageId}`, 'POST')
    ]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toBe('sandbox')
    }
  })

  it('does not follow redirects and treats them as a miss', async () => {
    upstream.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.test/x.png' } })
    )
    expect((await get(`small/${imageId}`)).status).toBe(404)
    expect((upstream.mock.calls[0][1] as RequestInit).redirect).toBe('manual')
    expect(bucket.store.size).toBe(0)
  })

  it('serves fetched bytes when R2 put fails, and treats a failing get as a miss', async () => {
    bucket.put = async () => {
      throw new Error('r2 down')
    }
    const res = await get(`small/${imageId}`)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
    bucket.get = async () => {
      throw new Error('r2 down')
    }
    expect((await get(`small/${imageId}`)).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('rejects oversized set keys and oversized upstream bodies', async () => {
    expect((await get(`set/${'a'.repeat(201)}`)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
    expect((await get(`set/${'a'.repeat(200)}`)).status).toBe(200)
    upstream.mockResolvedValueOnce(
      new Response(JPEG, {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) }
      })
    )
    expect((await get(`small/${imageId}`)).status).toBe(404)
    upstream.mockResolvedValueOnce(
      new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'image/jpeg' }
      })
    )
    expect((await get(`full/${imageId}`)).status).toBe(404)
    expect([...bucket.store.keys()]).toEqual([`set/${'a'.repeat(200)}`])
  })

  it('remembers an oversized set image for signed-in callers too', async () => {
    deps.anonMisses = createMissCache(() => 0, { ttlMs: 3_600_000, maxKeys: 100 })
    upstream.mockImplementation(
      async () =>
        new Response(JPEG, {
          headers: { 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) }
        })
    )
    expect((await get('set/abc')).status).toBe(404)
    expect((await get('set/abc')).status).toBe(404)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  describe('printing photos', () => {
    it('printing photo comes from the resolver URL and is stored', async () => {
      printingUrl = `${TCGPLAYER_IMAGE_PREFIX}1_in_1000x1000.jpg`
      const res = await get('printing/7')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
      expect(printingArt.url).toHaveBeenCalledWith(7)
      expect(upstream.mock.calls[0][0]).toBe(printingUrl)
      expect(bucket.store.has('printing/7')).toBe(true)
      expect((await get('printing/7')).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    it("keeps an art variant's photo under a new key, so one chosen before V38 isn't served", async () => {
      const p = db
        .prepare(
          `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity, set_rarity_code)
           SELECT card_id, 'it', 'Rarity Collection', 'RA01-IT043', 'Ultra Rare (Alternate Art)', ''
           FROM card_printings LIMIT 1 RETURNING id`
        )
        .get() as { id: number }
      const plain = (db.prepare('SELECT min(id) AS id FROM card_printings').get() as { id: number })
        .id
      bucket.store.set(`printing/${p.id}`, {
        bytes: new Uint8Array([1]).buffer,
        contentType: 'image/png',
        etag: '"old"'
      })
      printingUrl = `${YUGIPEDIA_IMAGE_PREFIX}a/ab/Card-AA.png`
      expect((await get(`printing/${p.id}`)).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(1)
      expect(bucket.store.has(`printing/${p.id}-v38`)).toBe(true)
      expect((await get(`printing/${plain}`)).status).toBe(200)
      expect(bucket.store.has(`printing/${plain}`)).toBe(true)
    })

    it('a Yugipedia photo is fetched with a User-Agent', async () => {
      printingUrl = `${YUGIPEDIA_IMAGE_PREFIX}a/ab/Card.png`
      expect((await get('printing/7')).status).toBe(200)
      expect(upstream.mock.calls[0][1].headers['User-Agent']).toMatch(/^DuelBinder\//)
    })

    it('printing with no photo answers 404', async () => {
      expect((await get('printing/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('resolver URL on another host answers 404 without fetching', async () => {
      printingUrl = 'https://evil.test/product/1.jpg'
      expect((await get('printing/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('malformed ids answer 404 without asking the resolver', async () => {
      for (const id of ['0', '-1', 'x', '1.5', '99999999999999999999']) {
        expect((await get(`printing/${id}`)).status).toBe(404)
      }
      expect(printingArt.url).not.toHaveBeenCalled()
    })

    it('a resolver that rejects answers 404 and stores nothing', async () => {
      printingArt.url.mockRejectedValueOnce(new Error('boom'))
      expect((await get('printing/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('a resolver that never answers gives 404 once the timeout passes', async () => {
      vi.useFakeTimers()
      try {
        printingArt.url.mockImplementationOnce(() => new Promise<string | null>(() => {}))
        const pending = get('printing/7')
        await vi.waitFor(() => expect(printingArt.url).toHaveBeenCalled()) // session lookup uses real async crypto
        await vi.advanceTimersByTimeAsync(30_000)
        expect((await pending).status).toBe(404)
        expect(upstream).not.toHaveBeenCalled()
        expect(bucket.store.size).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('counts printing art lookups against the quota before asking the resolver', async () => {
      deps.imageQuota = createImageQuota(() => 1_000_000, { limit: 2, windowMs: 3_600_000 })
      await bucket.put('printing/9', JPEG.buffer as ArrayBuffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      })
      expect((await get('printing/1')).status).toBe(404) // resolves to nothing, still spends a unit
      expect((await get('printing/2')).status).toBe(404)
      printingArt.url.mockClear()
      const limited = await get('printing/3')
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).not.toBeNull()
      expect(printingArt.url).not.toHaveBeenCalled()
      expect((await get('printing/9')).status).toBe(200) // stored: free
      expect(upstream).not.toHaveBeenCalled()
    })

    it('a stored photo is served without asking the resolver', async () => {
      await bucket.put('printing/7', JPEG.buffer as ArrayBuffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      })
      expect((await get('printing/7')).status).toBe(200)
      expect(printingArt.url).not.toHaveBeenCalled()
    })
  })

  describe('Konami logos and the upstream quota', () => {
    const addLogo = (key: string, url = `${KONAMI_LOGO_PREFIX}logos/a.png`): void => {
      db.prepare('INSERT INTO konami_logos (set_name, image_url, image_key) VALUES (?, ?, ?)').run(
        `Set ${key}`,
        url,
        key
      )
    }

    it('mirrors a Konami logo under konami/<key>', async () => {
      addLogo('km-abc')
      const res = await get('konami/km-abc')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
      expect(upstream.mock.calls[0][0]).toBe(`${KONAMI_LOGO_PREFIX}logos/a.png`)
      expect(bucket.store.has('konami/km-abc')).toBe(true)
      expect((await get('konami/km-abc')).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    it('refuses unknown, off-prefix and non-km keys under konami', async () => {
      addLogo('km-evil', 'https://evil.test/x.png')
      addLogo('yp-nope')
      for (const key of ['km-missing', 'km-evil', 'yp-nope', 'LOB', 'km-a/b']) {
        expect((await get(`konami/${key}`)).status).toBe(404)
      }
      expect(upstream).not.toHaveBeenCalled()
    })

    it('a signed-out miss on a Konami logo is a 404 without fetching', async () => {
      addLogo('km-abc')
      expect((await getAnon('konami/km-abc')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('still refuses km- keys under /img/set', async () => {
      addLogo('km-abc')
      expect((await get('set/km-abc')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('limits upstream fetches per user but never R2 hits', async () => {
      let t = 1_000_000
      deps.imageQuota = createImageQuota(() => t, { limit: 2, windowMs: 3_600_000 })
      await bucket.put('card/small/1', JPEG.buffer as ArrayBuffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      })
      expect((await get('set/AAA')).status).toBe(200)
      expect((await get('set/BBB')).status).toBe(200)
      const limited = await get('set/CCC')
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBe(String(Math.ceil((3_600_000 - 0) / 1000)))
      expect(upstream).toHaveBeenCalledTimes(2)
      // Stored images and keys that would 404 anyway cost nothing.
      expect((await get('set/AAA')).status).toBe(200)
      expect((await getAnon('set/BBB')).status).toBe(200)
      expect((await get('small/999999999')).status).toBe(404)
      expect((await get('set/km-abc')).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(2)
      // The window rolls over.
      t += 3_600_000
      expect((await get('set/CCC')).status).toBe(200)
    })

    it('rounds retry-after up to whole seconds, minimum 1', async () => {
      let t = 0
      const quota = createImageQuota(() => t, { limit: 1, windowMs: 10_000 })
      deps.imageQuota = quota
      expect((await get('set/AAA')).status).toBe(200)
      t = 8_500
      const early = await get('set/BBB')
      expect(early.status).toBe(429)
      expect(early.headers.get('retry-after')).toBe('2') // 1.5 s left
      t = 9_999
      expect((await get('set/BBB')).headers.get('retry-after')).toBe('1') // 1 ms left
      expect(quota.take(2)).toBe(true) // another user has their own budget
    })
  })

  it('HEAD answers with no body', async () => {
    const res = await get(`small/${imageId}`, 'HEAD')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(await res.text()).toBe('')
  })

  it('POST answers 405', async () => {
    expect((await get(`small/${imageId}`, 'POST')).status).toBe(405)
  })
})

describe('op art', () => {
  let db: Database.Database
  let upstream: ReturnType<typeof vi.fn>
  let deps: AppDeps
  let bucket: ReturnType<typeof memoryBucket>
  let printingUrl: ReturnType<typeof vi.fn<(id: number) => Promise<string | null>>>
  let ids: number[]
  let printingIds: number[]

  beforeEach(async () => {
    db = await seededServerDb()
    ;({ imageIds: ids, printingIds } = seedOnePiece(db))
    bucket = memoryBucket()
    upstream = vi.fn(async () => imageResponse())
    printingUrl = vi.fn(async (): Promise<string | null> => null)
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      printingArt: { url: printingUrl },
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-11-04T12:00:00.000Z'),
      fetch: upstream as unknown as typeof fetch
    }
  })
  afterEach(() => db.close())

  const get = (path: string): Promise<Response> =>
    handle(
      new Request(`${BASE}/img/${path}`, { headers: { 'cf-connecting-ip': '198.51.100.7' } }),
      deps
    )
  const stored = (key: string): void => {
    bucket.store.set(key, {
      bytes: JPEG.buffer.slice(0) as ArrayBuffer,
      contentType: 'image/jpeg',
      etag: '"s"'
    })
  }

  it('serves a stored small copy for small and cropped', async () => {
    stored(`card/small/${ids[0]}`)
    for (const size of ['small', 'cropped']) {
      // The edge path reads R2 by cardArtKey before anything reaches the resolver.
      const res = await edgeImage(
        new Request(`${BASE}/img/${size}/${ids[0]}`),
        bucket,
        null,
        () => undefined,
        async () => new Response('forwarded', { status: 500 })
      )
      expect(res!.status).toBe(200)
      expect(new Uint8Array(await res!.arrayBuffer())).toEqual(JPEG)
    }
    expect(upstream).not.toHaveBeenCalled()
  })

  it('an R2 miss on full fetches the Bandai PNG and stores it for a year', async () => {
    const res = await get(`full/${ids[0]}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(upstream.mock.calls[0][0]).toBe(
      'https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png'
    )
    expect(bucket.store.has(`card/full/${ids[0]}`)).toBe(true)
  })

  it('an R2 miss on small serves the full PNG for an hour and leaves card/small absent', async () => {
    const res = await get(`small/${ids[1]}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(upstream.mock.calls[0][0]).toBe(
      'https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001_p1.png'
    )
    expect(bucket.store.has(`card/full/${ids[1]}`)).toBe(true)
    expect(bucket.store.has(`card/small/${ids[1]}`)).toBe(false)
  })

  it('an op printing with no photo is a 404 and never asks Yugipedia', async () => {
    expect((await get(`printing/${printingIds[0]}`)).status).toBe(404)
    expect(printingUrl).not.toHaveBeenCalled()
    expect(upstream).not.toHaveBeenCalled()
  })

  it('an op id with no onepiece_images row is a 404', async () => {
    db.prepare('DELETE FROM onepiece_images WHERE image_id = ?').run(ids[0])
    expect((await get(`full/${ids[0]}`)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('a bandai_id that is not an id is a 404 with no fetch', async () => {
    db.prepare('UPDATE onepiece_images SET bandai_id = ? WHERE image_id = ?').run('../x', ids[0])
    expect((await get(`full/${ids[0]}`)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('a DON!! card (tcg:<product>) fetches TCGplayer art per size, under card/<size>, for a year', async () => {
    db.prepare('UPDATE onepiece_images SET bandai_id = ? WHERE image_id = ?').run(
      'tcg:593801',
      ids[0]
    )
    const full = await get(`full/${ids[0]}`)
    expect(full.status).toBe(200)
    expect(full.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(upstream.mock.calls[0][0]).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/593801_in_1000x1000.jpg'
    )
    expect(bucket.store.has(`card/full/${ids[0]}`)).toBe(true)
    const small = await get(`small/${ids[0]}`)
    expect(small.status).toBe(200)
    expect(small.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(upstream.mock.calls[1][0]).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/593801_200w.jpg'
    )
    expect(bucket.store.has(`card/small/${ids[0]}`)).toBe(true)
  })

  it("Japanese art (ja:<id>) is fetched from Bandai's Japanese site", async () => {
    db.prepare('UPDATE onepiece_images SET bandai_id = ? WHERE image_id = ?').run(
      'ja:OP01-001_p1',
      ids[0]
    )
    const res = await get(`full/${ids[0]}`)
    expect(res.status).toBe(200)
    expect(upstream.mock.calls[0][0]).toBe(
      'https://www.onepiece-cardgame.com/images/cardlist/card/OP01-001_p1.png'
    )
    expect(bucket.store.has(`card/full/${ids[0]}`)).toBe(true)
  })

  it('a ja: key that is not a Bandai id, or another region, is a 404 with no fetch', async () => {
    for (const key of ['ja:../x', 'ja:', 'fr:OP01-001', 'ja:ja:OP01-001']) {
      db.prepare('UPDATE onepiece_images SET bandai_id = ? WHERE image_id = ?').run(key, ids[0])
      expect((await get(`full/${ids[0]}`)).status).toBe(404)
    }
    expect(upstream).not.toHaveBeenCalled()
  })

  it('a tcg: key that is not a product id is a 404 with no fetch', async () => {
    db.prepare('UPDATE onepiece_images SET bandai_id = ? WHERE image_id = ?').run(
      'tcg:../1',
      ids[0]
    )
    expect((await get(`full/${ids[0]}`)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('Yu-Gi-Oh! keys stay card/<size>/<passcode>', async () => {
    const pass = (
      db
        .prepare('SELECT min(image_id) AS id FROM card_images WHERE image_id < 100000000')
        .get() as { id: number }
    ).id
    expect((await get(`cropped/${pass}`)).status).toBe(200)
    expect(bucket.store.has(`card/cropped/${pass}`)).toBe(true)
  })
})

describe('mtg art', () => {
  let db: Database.Database
  let upstream: ReturnType<typeof vi.fn>
  let deps: AppDeps
  let bucket: ReturnType<typeof memoryBucket>
  let printingUrl: ReturnType<typeof vi.fn<(id: number) => Promise<string | null>>>
  let ids: number[]
  let printingIds: number[]

  beforeEach(async () => {
    db = await seededServerDb()
    ;({ imageIds: ids, printingIds } = seedMagic(db))
    bucket = memoryBucket()
    upstream = vi.fn(async () => imageResponse())
    printingUrl = vi.fn(async (): Promise<string | null> => null)
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      printingArt: { url: printingUrl },
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-11-09T12:00:00.000Z'),
      fetch: upstream as unknown as typeof fetch
    }
  })
  afterEach(() => db.close())

  const get = (path: string): Promise<Response> =>
    handle(
      new Request(`${BASE}/img/${path}`, { headers: { 'cf-connecting-ip': '198.51.100.7' } }),
      deps
    )

  const SCRY = '6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c01'

  it('Magic art: an R2 miss fetches Scryfall and stores it', async () => {
    const res = await get(`small/${ids[0]}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(bucket.store.has(`card/small/${ids[0]}`)).toBe(true)
    expect(upstream.mock.calls[0][0]).toBe(`https://cards.scryfall.io/normal/front/6/e/${SCRY}.jpg`)
  })

  it('Magic art: full fetches large, cropped fetches the small copy', async () => {
    expect((await get(`full/${ids[0]}`)).status).toBe(200)
    expect(bucket.store.has(`card/full/${ids[0]}`)).toBe(true)
    expect(upstream.mock.calls[0][0]).toBe(`https://cards.scryfall.io/large/front/6/e/${SCRY}.jpg`)
    expect((await get(`cropped/${ids[0]}`)).status).toBe(200)
    expect(upstream.mock.calls[1][0]).toBe(`https://cards.scryfall.io/normal/front/6/e/${SCRY}.jpg`)
  })

  it('an unknown Magic image is a 404 with no fetch', async () => {
    const unknown = mtgImageId('6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c99')
    for (const size of ['small', 'full', 'cropped']) {
      expect((await get(`${size}/${unknown}`)).status).toBe(404)
    }
    expect(upstream).not.toHaveBeenCalled()
  })

  it('anonymous Magic art is served within the per-IP quota', async () => {
    deps.anonImageQuota = createImageQuota<string>(() => 0, { limit: 1, windowMs: 3_600_000 })
    expect((await get(`small/${ids[0]}`)).status).toBe(200)
    expect((await get(`small/${ids[1]}`)).status).toBe(429)
  })

  it('a Scryfall 404 is a 404 and is remembered', async () => {
    deps.anonMisses = createMissCache(() => 0, { ttlMs: 3_600_000, maxKeys: 100 })
    upstream.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    expect((await get(`small/${ids[0]}`)).status).toBe(404)
    expect((await get(`small/${ids[0]}`)).status).toBe(404)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('serves stored art, cropped as the small copy', async () => {
    for (const key of [`card/small/${ids[0]}`, `card/full/${ids[0]}`])
      bucket.store.set(key, {
        bytes: JPEG.buffer.slice(0) as ArrayBuffer,
        contentType: 'image/jpeg',
        etag: '"s"'
      })
    for (const size of ['small', 'full', 'cropped']) {
      const res = await get(`${size}/${ids[0]}`)
      expect(res.status).toBe(200)
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
    }
    const edge = await edgeImage(
      new Request(`${BASE}/img/cropped/${ids[0]}`),
      bucket,
      null,
      () => undefined,
      async () => new Response('forwarded', { status: 500 })
    )
    expect(edge!.status).toBe(200)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('a printing photo is a 404 and never asks Yugipedia', async () => {
    expect((await get(`printing/${printingIds[0]}`)).status).toBe(404)
    expect(printingUrl).not.toHaveBeenCalled()
    expect(upstream).not.toHaveBeenCalled()
  })
})
