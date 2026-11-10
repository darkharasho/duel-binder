import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import type { GameId } from '../../src/shared/games/types'

/** A sha256 of every catalog table's rows outside `exceptGame`, by table name. */
export function catalogHashes(db: Database.Database, exceptGame: GameId): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of CATALOG_TABLES) {
    if (t.games.length === 1 && t.games[0] === exceptGame) continue
    const where = t.games.includes(exceptGame) ? ` WHERE game <> '${exceptGame}'` : ''
    const rows = db.prepare(`SELECT * FROM ${t.name}${where} ORDER BY rowid`).all()
    out[t.name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  return out
}
