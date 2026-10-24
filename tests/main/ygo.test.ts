import { createYgoClient, YgoApiError } from '../../src/main/ygo/client'
import { mapApiCard, type ApiCard } from '../../src/main/ygo/mapCard'
import fixture from '../fixtures/cardinfo.sample.json'

const NOW = '2026-10-23T00:00:00.000Z'
const cards = fixture.data as ApiCard[]

const respond = (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch

test('mapApiCard maps printings, prices and art order', () => {
  const dm = mapApiCard(cards[0], NOW)
  expect(dm.card).toMatchObject({ id: 46986414, name: 'Dark Magician', tcgplayerPrice: 7.5 })
  expect(dm.printings).toEqual([
    expect.objectContaining({ setCode: 'LOB-EN005', setRarity: 'Ultra Rare', setPrice: 5.12 }),
    expect.objectContaining({ setCode: 'SDY-006', setPrice: null })
  ])
  expect(dm.images.map((i) => [i.imageId, i.sortOrder])).toEqual([
    [46986414, 0],
    [46986415, 1]
  ])
})

test('card without sets or prices maps cleanly', () => {
  const h = mapApiCard(cards[2], NOW)
  expect(h.printings).toEqual([])
  expect(h.card.tcgplayerPrice).toBeNull()
  expect(h.card).toMatchObject({
    level: null,
    atk: null,
    def: null,
    attribute: null,
    archetype: null,
    linkval: null
  })
})

test('client parses data array', async () => {
  const client = createYgoClient(respond(JSON.stringify(fixture)))
  expect(await client.fetchCardInfo()).toHaveLength(3)
})

test('client throws YgoApiError on 500', async () => {
  const client = createYgoClient(respond('oops', 500))
  const p = client.fetchCardInfo()
  await expect(p).rejects.toBeInstanceOf(YgoApiError)
  await expect(p).rejects.toThrow(/500/)
})

test('client throws YgoApiError on truncated JSON', async () => {
  const client = createYgoClient(respond('{"data":['))
  await expect(client.fetchCardInfo()).rejects.toBeInstanceOf(YgoApiError)
})

test('client throws YgoApiError when data is not an array', async () => {
  const client = createYgoClient(respond('{"data":{}}'))
  await expect(client.fetchCardInfo()).rejects.toBeInstanceOf(YgoApiError)
})

test('client wraps network failures in YgoApiError', async () => {
  const client = createYgoClient((async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch)
  await expect(client.fetchCardInfo()).rejects.toBeInstanceOf(YgoApiError)
})

test('fetchDbVersion reads first element', async () => {
  const client = createYgoClient(
    respond(JSON.stringify([{ database_version: '1.5', last_update: '2026-10-22 10:00:00' }]))
  )
  expect(await client.fetchDbVersion()).toEqual({
    databaseVersion: '1.5',
    lastUpdate: '2026-10-22 10:00:00'
  })
})
