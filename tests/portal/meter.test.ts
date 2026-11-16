import { describe, expect, it } from 'vitest'
import { areaOf, createCostMeter } from '../../workers/portal/src/meter'
import { doSql } from '../../workers/portal/src/doSql'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1))

describe('createCostMeter', () => {
  it('adds up each request by day, user and area', async () => {
    let t = Date.parse('2026-11-16T10:00:00.000Z')
    const meter = createCostMeter(() => t)
    await meter.run('api/sync', async () => {
      meter.user(7)
      meter.rows(10, 2)
      t += 40
      meter.rows(5, 0)
    })
    await meter.run('api/sync', async () => {
      meter.user(7)
      meter.rows(1, 1)
    })
    await meter.run('img', async () => meter.rows(3, 0))
    expect(meter.take()).toEqual([
      {
        day: '2026-11-16',
        userId: 7,
        area: 'api/sync',
        requests: 2,
        rowsRead: 16,
        rowsWritten: 3,
        ms: 40
      },
      { day: '2026-11-16', userId: 0, area: 'img', requests: 1, rowsRead: 3, rowsWritten: 0, ms: 0 }
    ])
    expect(meter.take()).toEqual([])
  })

  it('keeps overlapping requests apart across awaits', async () => {
    const meter = createCostMeter(() => 0)
    await Promise.all([
      meter.run('a', async () => {
        meter.user(1)
        await tick()
        meter.rows(100, 0)
      }),
      meter.run('b', async () => {
        meter.user(2)
        await tick()
        meter.rows(1, 0)
      })
    ])
    const rows = meter.take()
    expect(rows.find((r) => r.userId === 1)).toMatchObject({ area: 'a', rowsRead: 100 })
    expect(rows.find((r) => r.userId === 2)).toMatchObject({ area: 'b', rowsRead: 1 })
  })

  it('still counts rows a request reads after its response', async () => {
    const meter = createCostMeter(() => 0)
    let later: Promise<void> = Promise.resolve()
    await meter.run('a', async () => {
      later = tick().then(() => meter.rows(9, 9))
    })
    await later
    expect(meter.take()).toEqual([
      { day: '1970-01-01', userId: 0, area: 'a', requests: 1, rowsRead: 9, rowsWritten: 9, ms: 0 }
    ])
  })

  it('ignores rows outside any request, and says when a minute has passed', async () => {
    let t = 0
    const meter = createCostMeter(() => t)
    meter.rows(50, 50)
    expect(meter.take()).toEqual([])
    expect(meter.due()).toBe(false)
    t = 60_000
    expect(meter.due()).toBe(true)
    meter.take()
    expect(meter.due()).toBe(false)
  })
})

describe('areaOf', () => {
  it('names requests by their first path parts', () => {
    expect(areaOf('/api/sync/push')).toBe('api/sync')
    expect(areaOf('/api/rpc/sets%3Alist')).toBe('rpc sets:list')
    expect(areaOf('/admin/catalog/load')).toBe('admin/catalog')
    expect(areaOf('/img/hand/en-x/high')).toBe('img')
    expect(areaOf('/scan/fingerprints')).toBe('scan/fingerprints')
    expect(areaOf('/')).toBe('home')
  })

  it('folds unknown or odd paths into other', () => {
    expect(areaOf('/wp-login.php')).toBe('other')
    expect(areaOf('/api/' + 'x'.repeat(80))).toBe('api')
    expect(areaOf('/api/rpc/%E0%A4%A')).toBe('rpc')
  })
})

describe('doSql', () => {
  it('reports each statement’s rows read and written to the meter', () => {
    const counted: [number, number][] = []
    const cursor = (rowsRead: number, rowsWritten: number, rows: unknown[] = []) => ({
      toArray: () => rows,
      one: () => ({ id: 1, n: 1 }),
      rowsRead,
      rowsWritten
    })
    const storage = {
      sql: {
        exec: (q: string) =>
          q.startsWith('SELECT last_insert_rowid')
            ? cursor(0, 0)
            : q.startsWith('INSERT')
              ? cursor(1, 3)
              : cursor(40, 0, [{ a: 1 }])
      },
      transactionSync: (fn: () => unknown) => fn()
    } as unknown as Parameters<typeof doSql>[0]
    const db = doSql(storage, (r, w) => counted.push([r, w]))
    db.prepare('SELECT a FROM t').all()
    db.prepare('SELECT a FROM t').get()
    db.prepare('INSERT INTO t VALUES (1)').run()
    db.exec('DELETE FROM t')
    expect(counted).toEqual([
      [40, 0],
      [40, 0],
      [1, 3],
      [0, 0],
      [40, 0]
    ])
  })
})
