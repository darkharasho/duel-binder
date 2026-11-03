import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { clientIp, isLimited, takeLimit } from '../../workers/portal/src/authLimits'
import { migrateServer } from '../../workers/portal/src/migrate'

const T0 = new Date('2026-11-02T12:00:00.000Z')
const at = (s: number): Date => new Date(T0.getTime() + s * 1000)

describe('auth limits', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    migrateServer(db)
  })

  it('code-email-min allows one a minute', () => {
    expect(takeLimit(db, 'code-email-min', 'a@b.co', at(0))).toBe(true)
    expect(takeLimit(db, 'code-email-min', 'a@b.co', at(30))).toBe(false)
    expect(takeLimit(db, 'code-email-min', 'a@b.co', at(61))).toBe(true)
  })
  it('windows are per key', () => {
    expect(takeLimit(db, 'code-email-min', 'a@b.co', at(0))).toBe(true)
    expect(takeLimit(db, 'code-email-min', 'c@d.co', at(1))).toBe(true)
    expect(takeLimit(db, 'code-email-hour', 'a@b.co', at(1))).toBe(true)
  })
  it("isLimited doesn't record", () => {
    expect(isLimited(db, 'code-email-min', 'a@b.co', at(0))).toBe(false)
    expect(isLimited(db, 'code-email-min', 'a@b.co', at(0))).toBe(false)
    expect(takeLimit(db, 'code-email-min', 'a@b.co', at(0))).toBe(true)
    expect(isLimited(db, 'code-email-min', 'a@b.co', at(1))).toBe(true)
  })
  it('clientIp reads cf-connecting-ip', () => {
    expect(clientIp(new Request('https://x', { headers: { 'cf-connecting-ip': ' 1.2.3.4 ' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('https://x'))).toBe('unknown')
  })
})
