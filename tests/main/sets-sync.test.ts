import { openDatabase } from '../../src/main/db/database'
import { runSync } from '../../src/main/sync/sync'
import { hasSetData, refreshSets } from '../../src/main/sync/sets'
import type { ApiCardSet, YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import fixture from '../fixtures/cardinfo.sample.json'

const IMG = 'https://images.ygoprodeck.com/images/sets/MRD.jpg'
const SETS = [
  {
    set_name: 'Metal Raiders',
    set_code: 'MRD',
    num_of_cards: 432,
    tcg_date: '2002-06-26',
    set_image: IMG
  },
  { set_name: 'Odd', tcg_date: 'soon' },
  { set_code: 'NONAME' }
] as ApiCardSet[]

function makeClient(over: Partial<YgoClient> = {}): YgoClient {
  return {
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '' }),
    fetchCardInfo: async () => fixture.data as ApiCard[],
    fetchCardSets: async () => SETS,
    ...over
  }
}

const rows = (db: ReturnType<typeof openDatabase>): unknown[] =>
  db.prepare('SELECT set_name, set_code, tcg_date, image_url FROM sets ORDER BY set_name').all()

const EXPECTED = [
  { set_name: 'Metal Raiders', set_code: 'MRD', tcg_date: '2002-06-26', image_url: IMG },
  { set_name: 'Odd', set_code: '', tcg_date: null, image_url: null }
]

afterEach(() => vi.restoreAllMocks())

test('runSync stores valid sets', async () => {
  const db = openDatabase(':memory:')
  expect(hasSetData(db)).toBe(false)
  const status = await runSync(db, makeClient(), () => {})
  expect(status.state).toBe('idle')
  expect(rows(db)).toEqual(EXPECTED)
  expect(hasSetData(db)).toBe(true)
})

test('a failing set fetch keeps old rows and does not fail the sync', async () => {
  const db = openDatabase(':memory:')
  await runSync(db, makeClient(), () => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const status = await runSync(
    db,
    makeClient({ fetchCardSets: async () => Promise.reject(new Error('down')) }),
    () => {}
  )
  expect(status.state).toBe('idle')
  expect(rows(db)).toEqual(EXPECTED)
  expect(warn).toHaveBeenCalled()
})

test.each([[[]], [[{}]]])('unusable set list %j leaves rows unchanged', async (payload) => {
  const db = openDatabase(':memory:')
  await refreshSets(db, makeClient())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const ok = await refreshSets(
    db,
    makeClient({ fetchCardSets: async () => payload as ApiCardSet[] })
  )
  expect(ok).toBe(false)
  expect(rows(db)).toEqual(EXPECTED)
})

test('duplicate set_name: last row wins', async () => {
  const db = openDatabase(':memory:')
  await refreshSets(
    db,
    makeClient({
      fetchCardSets: async () => [
        { set_name: 'A', set_code: 'ONE' },
        { set_name: 'A', set_code: 'TWO' }
      ]
    })
  )
  expect(rows(db)).toEqual([{ set_name: 'A', set_code: 'TWO', tcg_date: null, image_url: null }])
})

test('a db write failure is treated like a fetch failure', async () => {
  const db = openDatabase(':memory:')
  await refreshSets(db, makeClient())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  db.exec(`CREATE TRIGGER boom BEFORE INSERT ON sets BEGIN SELECT RAISE(ABORT, 'no'); END`)
  expect(await refreshSets(db, makeClient())).toBe(false)
  expect(rows(db)).toEqual(EXPECTED)
})

test('card failure skips sets entirely', async () => {
  const db = openDatabase(':memory:')
  const fetchCardSets = vi.fn(async () => SETS)
  const status = await runSync(
    db,
    makeClient({ fetchCardInfo: () => Promise.reject(new Error('nope')), fetchCardSets }),
    () => {}
  )
  expect(status.state).toBe('error')
  expect(fetchCardSets).not.toHaveBeenCalled()
})
