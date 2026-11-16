import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, seededServerDb } from './helpers'
import {
  isActiveStatus,
  supporterIds,
  supporterOf,
  thanksNames,
  setShowOnSite,
  writeSubscription,
  type StripeSubscription
} from '../../workers/portal/src/supporters'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const LATER = new Date('2026-12-16T12:00:00.000Z')
const END = Date.parse('2027-11-16T00:00:00.000Z') / 1000

const sub = (over: Partial<StripeSubscription> & { interval?: 'month' | 'year'; amount?: number } = {}): StripeSubscription => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  items: {
    data: [
      {
        current_period_end: END,
        price: { unit_amount: over.amount ?? 2500, recurring: { interval: over.interval ?? 'year' } }
      }
    ]
  },
  ...over
})

describe('supporters model', () => {
  let db: Database.Database
  let alice: number
  let bob: number
  let carol: number

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    carol = addUser(db, '3', 'carol')
  })

  it('counts active, trialing and past_due as supporting', () => {
    for (const s of ['active', 'trialing', 'past_due']) expect(isActiveStatus(s)).toBe(true)
    for (const s of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'none'])
      expect(isActiveStatus(s)).toBe(false)
  })

  it('writes a first active subscription', () => {
    writeSubscription(db, alice, sub(), NOW)
    expect(supporterOf(db, alice)).toEqual({
      plan: 'year',
      since: NOW.toISOString(),
      until: '2027-11-16T00:00:00.000Z',
      cancelling: false,
      showOnSite: false
    })
  })

  it('drops the supporter on cancel and keeps the first since when they come back', () => {
    writeSubscription(db, alice, sub(), NOW)
    writeSubscription(db, alice, sub({ status: 'canceled' }), NOW)
    expect(supporterOf(db, alice)).toBeNull()
    writeSubscription(db, alice, sub({ id: 'sub_2', interval: 'month', amount: 300 }), LATER)
    expect(supporterOf(db, alice)).toMatchObject({ plan: 'month', since: NOW.toISOString() })
  })

  it('shows cancelling while a cancel waits for the period end', () => {
    writeSubscription(db, alice, sub({ cancel_at_period_end: true }), NOW)
    expect(supporterOf(db, alice)?.cancelling).toBe(true)
  })

  it('sets no since while the subscription is incomplete', () => {
    writeSubscription(db, alice, sub({ status: 'incomplete' }), NOW)
    expect(supporterOf(db, alice)).toBeNull()
    const row = db.prepare('SELECT since FROM supporters WHERE user_id = ?').get(alice) as { since: string | null }
    expect(row.since).toBeNull()
  })

  it('lists only active supporters among the ids asked', () => {
    writeSubscription(db, alice, sub(), NOW)
    writeSubscription(db, bob, sub({ id: 'sub_b', customer: 'cus_b', status: 'canceled' }), NOW)
    expect(supporterIds(db, [alice, bob, carol])).toEqual(new Set([alice]))
    expect(supporterIds(db, [])).toEqual(new Set())
  })

  it('lists opted-in active supporters for the thanks page, oldest first', () => {
    db.prepare("UPDATE users SET display_name = 'Bobby' WHERE id = ?").run(bob)
    writeSubscription(db, bob, sub({ id: 'sub_b', customer: 'cus_b' }), NOW)
    writeSubscription(db, alice, sub(), LATER)
    writeSubscription(db, carol, sub({ id: 'sub_c', customer: 'cus_c' }), NOW)
    setShowOnSite(db, alice, true)
    setShowOnSite(db, bob, true)
    expect(thanksNames(db)).toEqual(['Bobby', 'alice'])
    writeSubscription(db, bob, sub({ id: 'sub_b', customer: 'cus_b', status: 'canceled' }), LATER)
    expect(thanksNames(db)).toEqual(['alice'])
  })
})
