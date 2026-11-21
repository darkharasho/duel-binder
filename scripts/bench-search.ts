/**
 * Speed gate for community search (Task 16): per-keystroke cost of searchCards and listEntries.
 * With DB=path it copies that database (opened readonly, never written) to a temp file with
 * better-sqlite3's online backup, migrates the copy and times real queries. Without DB it builds a
 * synthetic catalog of at most 50k printings in memory (no 100k+ row data). The copy is deleted at the end.
 *
 * Run (bundle with vite, then run under Electron so the Electron-built better-sqlite3 loads):
 *   DB=/var/tmp/bench-db/collection.db npx vite build --ssr scripts/bench-search.ts --outDir out/bench-search --emptyOutDir \
 *     && DB=/var/tmp/bench-db/collection.db ELECTRON_RUN_AS_NODE=1 npx electron out/bench-search/bench-search.mjs
 * Prints one line per (query, scope, fn): median and p95 ms over RUNS timed runs after a warm-up.
 */
import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { migrate, openDatabase } from '../src/main/db/database'
import { localScope } from '../src/main/repo/scope'
import { searchCards } from '../src/main/repo/cards'
import { listEntries } from '../src/main/repo/collection'
import type { CollectionFilters } from '../src/shared/types'

const RUNS = 30
const QUERIES = [
  'charizard', 'lightning bolt', 'trainer gallery charizard', 'mew sir', 'charzard',
  ...'abcdefghij'.split('')
]
const SCOPES = ['mtg', 'pkm'] as const
const CAP = 50_000

const pct = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

function synthetic(): Database.Database {
  const db = openDatabase(':memory:')
  const words = ['fire', 'dark', 'mew', 'char', 'bolt', 'light', 'storm', 'dragon', 'sir', 'trainer', 'gallery', 'zard']
  const insC = db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game) VALUES (?, ?, 'x', 'x', 'x', '', '2026-01-01', ?)`
  )
  const insP = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, game) VALUES (?, ?, ?, 'Rare', ?)`
  )
  db.transaction(() => {
    let id = 1
    for (const game of SCOPES) {
      for (let i = 0; i < CAP / 2 / 2; i++, id++) {
        const name = `${words[i % 12]} ${words[(i * 7) % 12]} ${i}`
        insC.run(id, name, game)
        for (let k = 0; k < 2; k++) insP.run(id, `Set ${i % 300}`, `S${i % 300}-${String(k).padStart(3, '0')}`, game)
      }
    }
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
  })()
  return db
}

async function main(): Promise<void> {
  const src = process.env.DB
  const tmp = path.join(os.tmpdir(), `bench-search-${process.pid}.db`)
  let db: Database.Database
  if (src) {
    const live = new Database(src, { readonly: true, fileMustExist: true })
    await live.backup(tmp)
    live.close()
    db = new Database(tmp)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
  } else db = synthetic()
  try {
    console.log('query | scope | fn | median ms | p95 ms')
    for (const game of SCOPES) {
      const scope = localScope(`'${game}'`)
      for (const q of QUERIES) {
        const fns: [string, () => unknown][] = [
          ['searchCards', () => searchCards(db, q, 20, scope)],
          ['listEntries', () => listEntries(db, { q } as CollectionFilters, scope)]
        ]
        for (const [name, f] of fns) {
          f()
          const t = Array.from({ length: RUNS }, () => {
            const s = performance.now()
            f()
            return performance.now() - s
          })
          console.log(`${q} | ${game} | ${name} | ${pct(t, 0.5).toFixed(2)} | ${pct(t, 0.95).toFixed(2)}`)
        }
      }
    }
  } finally {
    db.close()
    for (const s of ['', '-wal', '-shm']) fs.rmSync(tmp + s, { force: true })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
