import { describe, expect, it } from 'vitest'
import { doSql } from '../src/doSql'

describe('doSql', () => {
  it('reports each statement’s rows read and written to the meter', () => {
    const counted: [number, number][] = []
    const cursor = (rowsRead: number, rowsWritten: number, rows: unknown[] = []): object => ({
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
    } as unknown as DurableObjectStorage
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
