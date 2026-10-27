import type { SqlDb } from './sql'
import { MIGRATIONS } from './schema'

/** Applies every migration newer than PRAGMA user_version, each in its own transaction. */
export function migrateSql(db: SqlDb): void {
  const pragma = (name: string): number =>
    Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)[0]
  const current = pragma('user_version')
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      if (migration.foreignKeysOff) {
        const violations = db.prepare('PRAGMA foreign_key_check').all()
        if (violations.length > 0) {
          throw new Error(
            `Migration ${migration.version} left ${violations.length} foreign key violation(s)`
          )
        }
      }
      db.exec(`PRAGMA user_version = ${migration.version}`)
    })
    if (!migration.foreignKeysOff) {
      apply()
      continue
    }
    // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it around the transaction.
    const previous = pragma('foreign_keys')
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      apply()
    } finally {
      db.exec(`PRAGMA foreign_keys = ${previous ? 'ON' : 'OFF'}`)
    }
  }
}
