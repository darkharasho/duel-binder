import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { doSql } from '../src/doSql'
import type { AdminCosts } from '../../../src/shared/costs'

const AUTH = { authorization: 'Bearer admin-token' }

describe('request costs on Durable Object SQLite', () => {
  it('counts the rows each request reads and serves them at /admin/costs', async () => {
    const stub = env.STORE.get(env.STORE.idFromName('costs'))
    await runInDurableObject(stub, (_instance, state) => {
      const db = doSql(state.storage)
      const add = db.prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, ?, 'Normal Monster', 'normal', 'Dragon', '', '2026-10-24')`
      )
      for (let i = 1; i <= 50; i++) add.run(i, `Card ${i}`)
    })
    // Counts every catalog table, cards among them: at least 50 rows read.
    const status = await stub.fetch('https://app.test/admin/catalog/status', { headers: AUTH })
    expect(status.status).toBe(200)

    const res = await stub.fetch('https://app.test/admin/costs?days=7', { headers: AUTH })
    expect(res.status).toBe(200)
    const c = (await res.json()) as AdminCosts
    const area = c.byArea.find((a) => a.area === 'admin/catalog')
    expect(area?.requests).toBe(1)
    expect(area?.rowsRead).toBeGreaterThanOrEqual(50)
    expect(c.activeUsers).toBe(0)
    expect(c.system.requests).toBeGreaterThanOrEqual(1)
  })
})
