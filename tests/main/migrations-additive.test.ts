import { describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../../src/main/db/schema'

// Live updates put new web code on phones that keep the old native shell and an older data schema,
// so migrations must never remove or rename a column the older code still reads.
describe('migrations-additive', () => {
  it('no DROP COLUMN or RENAME COLUMN after v48', () => {
    const bad = /\b(DROP|RENAME)\s+COLUMN\b/i
    for (const m of MIGRATIONS.filter((x) => x.version > 48)) {
      expect(bad.test(m.sql), `v${m.version} sql`).toBe(false)
      if (typeof m.server === 'string') expect(bad.test(m.server), `v${m.version} server`).toBe(false)
    }
  })
})
