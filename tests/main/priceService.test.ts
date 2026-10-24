import { afterEach, beforeEach, expect, test } from 'vitest'
import { createPriceService } from '../../src/main/prices/service'
import { PRICE_WORKER_URL } from '../../src/main/prices/config'
import { getMeta } from '../../src/main/db/meta'
import { seededDb } from './helpers'

let prevEnv: string | undefined
beforeEach(() => {
  prevEnv = process.env['YGO_PRICE_WORKER_URL']
  delete process.env['YGO_PRICE_WORKER_URL']
})
afterEach(() => {
  if (prevEnv === undefined) delete process.env['YGO_PRICE_WORKER_URL']
  else process.env['YGO_PRICE_WORKER_URL'] = prevEnv
})

test('uses the built-in address until another is saved, and can go back to it', async () => {
  const db = await seededDb()
  const prices = createPriceService(db)
  expect(prices.settings()).toEqual({
    url: PRICE_WORKER_URL,
    defaultUrl: PRICE_WORKER_URL,
    isDefault: true,
    envOverride: false
  })
  expect(prices.client()).not.toBeNull()

  expect(prices.setUrl('  https://prices.example.dev/  ')).toMatchObject({
    url: 'https://prices.example.dev',
    isDefault: false
  })
  expect(createPriceService(db).settings().url).toBe('https://prices.example.dev')

  expect(prices.setUrl(null)).toMatchObject({ url: PRICE_WORKER_URL, isDefault: true })
})

test('an empty address turns prices off', async () => {
  const db = await seededDb()
  const prices = createPriceService(db)
  expect(prices.setUrl('')).toMatchObject({ url: '', isDefault: false })
  expect(prices.client()).toBeNull()
  expect(getMeta(db, 'price_service_status')).toBe('unavailable')
})

test('rejects addresses that are not http(s) and keeps the old one', async () => {
  const db = await seededDb()
  const prices = createPriceService(db)
  expect(() => prices.setUrl('not a url')).toThrow('Enter a full address')
  expect(() => prices.setUrl('ftp://x.example')).toThrow('must start with https://')
  expect(prices.settings().isDefault).toBe(true)
})

test('the env override wins over the saved address', async () => {
  const db = await seededDb()
  process.env['YGO_PRICE_WORKER_URL'] = ''
  const prices = createPriceService(db)
  prices.setUrl('https://prices.example.dev')
  expect(prices.client()).toBeNull()
  expect(prices.settings().envOverride).toBe(true)
})
