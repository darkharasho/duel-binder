import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { AppDeps } from '../../workers/portal/src/app'
import type { EmailMessage } from '../../workers/portal/src/emailSend'
import {
  SeatsFull,
  cancelInvite,
  fillSeats,
  inviteEntry,
  joinWaitlist,
  resendInvite,
  seatCounts,
  setCap,
  spendInvite,
  takeSeat
} from '../../workers/portal/src/seats'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const NOW = '2026-11-21T12:00:00.000Z'
const sha = (t: string): string => createHash('sha256').update(t).digest('hex')

describe('seats', () => {
  let db: Database.Database
  let deps: AppDeps
  let sent: EmailMessage[]
  let failNext: number

  beforeEach(async () => {
    db = await seededServerDb()
    sent = []
    failNext = 0
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
        ADMIN_DISCORD_ID: '999',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      email: {
        send: async (m) => {
          if (failNext > 0) {
            failNext--
            throw new Error('boom')
          }
          sent.push(m)
        }
      },
      now: () => new Date(NOW),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const wait = (email: string, at: string): number => {
    joinWaitlist(db, email, at)
    return (db.prepare('SELECT id FROM waitlist WHERE email = ?').get(email) as { id: number }).id
  }
  const invite = (hash: string, email: string, expires: string, used?: string): void => {
    db.prepare(
      'INSERT INTO seat_invites (token_hash, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)'
    ).run(hash, email, '2026-11-20T00:00:00.000Z', expires, used ?? null)
  }
  const FUTURE = '2026-12-01T00:00:00.000Z'
  const PAST = '2026-11-20T00:00:00.000Z'

  it('defaults to a cap of 100 and counts only open accounts', () => {
    addUser(db, '1', 'a')
    const b = addUser(db, '2', 'b')
    db.prepare('UPDATE users SET closed_at = ? WHERE id = ?').run(NOW, b)
    expect(seatCounts(db, NOW)).toEqual({ cap: 100, accounts: 1, invited: 0, free: 99, waiting: 0 })
  })

  it('counts outstanding invites but not used or expired ones', () => {
    invite('h1', 'a@x.com', FUTURE)
    invite('h2', 'b@x.com', FUTURE, NOW)
    invite('h3', 'c@x.com', PAST)
    const c = seatCounts(db, NOW)
    expect(c.invited).toBe(1)
    expect(c.free).toBe(99)
  })

  it('takeSeat returns null while seats are free and throws when full', () => {
    expect(takeSeat(db, {}, NOW)).toBeNull()
    setCap(db, 0, NOW)
    expect(() => takeSeat(db, {}, NOW)).toThrow(SeatsFull)
  })

  it('takeSeat lets a valid invite hash in when full; expired or used ones do not', () => {
    setCap(db, 0, NOW)
    invite('ok', 'a@x.com', FUTURE)
    invite('old', 'b@x.com', PAST)
    invite('used', 'c@x.com', FUTURE, NOW)
    expect(takeSeat(db, { inviteHash: 'ok' }, NOW)).toBe('ok')
    expect(() => takeSeat(db, { inviteHash: 'old' }, NOW)).toThrow(SeatsFull)
    expect(() => takeSeat(db, { inviteHash: 'used' }, NOW)).toThrow(SeatsFull)
  })

  it('takeSeat finds an outstanding invite by verified email', () => {
    setCap(db, 0, NOW)
    invite('mine', 'a@x.com', FUTURE)
    expect(takeSeat(db, { verifiedEmail: 'A@x.com' }, NOW)).toBe('mine')
    expect(() => takeSeat(db, { verifiedEmail: 'z@x.com' }, NOW)).toThrow(SeatsFull)
  })

  it('spendInvite marks it used so it no longer lets anyone in', () => {
    setCap(db, 0, NOW)
    invite('h', 'a@x.com', FUTURE)
    const u = addUser(db, '1', 'a')
    spendInvite(db, 'h', u, NOW)
    expect(() => takeSeat(db, { inviteHash: 'h' }, NOW)).toThrow(SeatsFull)
  })

  it('a cap of 0 leaves free at 0, never negative', () => {
    addUser(db, '1', 'a')
    setCap(db, 0, NOW)
    expect(seatCounts(db, NOW).free).toBe(0)
  })

  it('fillSeats invites the earliest waiting entries, one per free seat', async () => {
    addUser(db, '1', 'a')
    setCap(db, 3, NOW)
    wait('late@x.com', '2026-11-03T00:00:00.000Z')
    wait('first@x.com', '2026-11-01T00:00:00.000Z')
    wait('second@x.com', '2026-11-02T00:00:00.000Z')
    expect(await fillSeats(deps)).toBe(2)
    expect(sent.map((m) => m.to)).toEqual(['first@x.com', 'second@x.com'])
    const token = sent[0].text.match(new RegExp(`${BASE}/invite/(\\S+)`))![1]
    const row = db.prepare('SELECT email FROM seat_invites WHERE token_hash = ?').get(sha(token))
    expect(row).toEqual({ email: 'first@x.com' })
    expect(sent[0].subject).toBe('A seat opened up at Duel Binder')
    expect(seatCounts(db, NOW)).toMatchObject({ free: 0, invited: 2, waiting: 1 })
  })

  it('fillSeats leaves no trace of a failed send and tries the next entry', async () => {
    wait('a@x.com', '2026-11-01T00:00:00.000Z')
    wait('b@x.com', '2026-11-02T00:00:00.000Z')
    setCap(db, 1, NOW)
    failNext = 1
    expect(await fillSeats(deps)).toBe(1)
    expect(sent.map((m) => m.to)).toEqual(['b@x.com'])
    const a = db.prepare("SELECT invited_at FROM waitlist WHERE email = 'a@x.com'").get()
    expect(a).toEqual({ invited_at: null })
    expect(db.prepare("SELECT COUNT(*) AS n FROM seat_invites WHERE email = 'a@x.com'").get()).toEqual({ n: 0 })
  })

  it('fillSeats sends the entry of an expired unused invite to the back', async () => {
    const a = wait('a@x.com', '2026-11-01T00:00:00.000Z')
    wait('b@x.com', '2026-11-02T00:00:00.000Z')
    db.prepare('UPDATE waitlist SET invited_at = ? WHERE id = ?').run(PAST, a)
    db.prepare(
      'INSERT INTO seat_invites (token_hash, waitlist_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run('exp', a, 'a@x.com', PAST, PAST)
    setCap(db, 1, NOW)
    expect(await fillSeats(deps)).toBe(1)
    expect(sent.map((m) => m.to)).toEqual(['b@x.com'])
    expect(db.prepare('SELECT invited_at FROM waitlist WHERE id = ?').get(a)).toEqual({ invited_at: null })
  })

  it('inviteEntry works over the cap', async () => {
    setCap(db, 0, NOW)
    const id = wait('a@x.com', NOW)
    expect(await inviteEntry(deps, id)).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('inviteEntry fails cleanly without a sender', async () => {
    const id = wait('a@x.com', NOW)
    deps.email = undefined
    expect(await inviteEntry(deps, id)).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM seat_invites').get()).toEqual({ n: 0 })
  })

  it('resendInvite voids the old token and issues a fresh 14 days', async () => {
    const id = wait('a@x.com', NOW)
    await inviteEntry(deps, id)
    const first = sent[0].text.match(/invite\/(\S+)/)![1]
    deps.now = () => new Date('2026-11-25T12:00:00.000Z')
    expect(await resendInvite(deps, id)).toBe(true)
    const second = sent[1].text.match(/invite\/(\S+)/)![1]
    expect(second).not.toBe(first)
    const rows = db.prepare('SELECT token_hash AS h, expires_at AS e FROM seat_invites').all()
    expect(rows).toEqual([{ h: sha(second), e: '2026-12-09T12:00:00.000Z' }])
  })

  it('cancelInvite frees the seat', async () => {
    setCap(db, 1, NOW)
    const id = wait('a@x.com', NOW)
    await fillSeats(deps)
    expect(seatCounts(db, NOW).free).toBe(0)
    expect(cancelInvite(db, id)).toBe(true)
    expect(seatCounts(db, NOW)).toMatchObject({ free: 1, invited: 0, waiting: 1 })
  })

  it('joinWaitlist twice keeps one row and the first created_at', () => {
    joinWaitlist(db, 'a@x.com', '2026-11-01T00:00:00.000Z')
    joinWaitlist(db, 'A@x.com', '2026-11-09T00:00:00.000Z')
    expect(db.prepare('SELECT email, created_at FROM waitlist').all()).toEqual([
      { email: 'a@x.com', created_at: '2026-11-01T00:00:00.000Z' }
    ])
  })
})
