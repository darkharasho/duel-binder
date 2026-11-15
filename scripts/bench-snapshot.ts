/**
 * Snapshot import speed and how long the app's own writes wait meanwhile. Builds a synthetic Magic
 * catalog (10k cards, 40k printings; capped well under the 50k-row limit for synthetic data),
 * exports it as a snapshot, then imports it into a second database on a worker thread the way the
 * app does (busy timeout, foreign keys off, paused chunks) while this thread writes every 5 ms.
 *
 * Run (bundle with vite, then run under Electron so the Electron-built better-sqlite3 loads):
 *   npx vite build --ssr scripts/bench-snapshot.ts --outDir out/bench --emptyOutDir \
 *     && ELECTRON_RUN_AS_NODE=1 npx electron out/bench/bench-snapshot.mjs
 *
 * Target: the longest main-thread write wait stays under 150 ms.
 */
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { runApplyJob } from '../src/main/catalog/applyJob'
import { exportSnapshot } from '../src/main/catalog/snapshot'
import { openDatabase } from '../src/main/db/database'

const CARDS = 10_000
const PRINTS = 40_000

function source(file: string): void {
  const db = openDatabase(file)
  db.transaction(() => {
    const card = db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'mtg', ?, 'Creature', 'mtg', '', '', '2026-11-15')`
    )
    for (let i = 0; i < CARDS; i++) card.run(9_000_000_000 + i, `Bench Card ${i}`)
    const p = db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, remote_id)
       VALUES ('mtg', ?, 'en', ?, ?, 'Common', ?)`
    )
    for (let i = 0; i < PRINTS; i++)
      p.run(9_000_000_000 + (i % CARDS), `Set ${i % 300}`, `S${i % 300}-${i}`, i + 1)
  })()
  exportSnapshot(db, 'mtg', `${file}.snap`, { cursor: 50_000, dbVersion: null })
  db.close()
}

if (!isMainThread) {
  const { file, snap } = workerData as { file: string; snap: string }
  const nap = new Int32Array(new SharedArrayBuffer(4))
  const db = new Database(file)
  db.pragma('busy_timeout = 10000')
  db.pragma('foreign_keys = OFF')
  runApplyJob(
    db,
    { kind: 'snapshot', game: 'mtg', file: snap, cursor: 50_000, dbVersion: null },
    {
      immediate: true,
      pause: (ms) => Atomics.wait(nap, 0, 0, Math.min(Math.max(ms, 5), 250))
    }
  )
  const t = performance.now()
  runApplyJob(db, { kind: 'finish' }, { immediate: true })
  parentPort!.postMessage({ finishMs: performance.now() - t })
} else {
  const dir = mkdtempSync(join(tmpdir(), 'snap-bench-'))
  try {
    const src = join(dir, 'source.db')
    let t = performance.now()
    source(src)
    console.log(
      `built + exported ${CARDS} cards, ${PRINTS} printings in ${(performance.now() - t).toFixed(0)} ms`
    )

    const file = join(dir, 'app.db')
    const db = openDatabase(file)
    const write = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('bench_probe', ?)")
    t = performance.now()
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { file, snap: `${src}.snap` }
    })
    const done = new Promise<{ finishMs: number }>((res, rej) => {
      worker.once('message', res)
      worker.once('error', rej)
    })
    let stop = false
    void done.finally(() => (stop = true))
    const waits: number[] = []
    let errors = 0
    while (!stop) {
      const s = performance.now()
      try {
        db.transaction(() => write.run(String(s)))()
      } catch {
        errors++
      }
      waits.push(performance.now() - s)
      await new Promise((r) => setTimeout(r, 5))
    }
    const { finishMs } = await done
    const total = performance.now() - t
    waits.sort((a, b) => a - b)
    const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    console.log(
      `import + search index: ${total.toFixed(0)} ms (search index rebuild ${finishMs.toFixed(0)} ms)`
    )
    console.log(
      `main writes: ${waits.length}, p50 ${waits[waits.length >> 1].toFixed(2)} ms, p99 ${waits[Math.floor(waits.length * 0.99)].toFixed(1)} ms, max ${waits[waits.length - 1].toFixed(1)} ms, errors ${errors}`
    )
    console.log(
      `imported cards ${n("SELECT count(*) n FROM cards WHERE game = 'mtg'")}, printings ${n("SELECT count(*) n FROM card_printings WHERE game = 'mtg'")}`
    )
    await worker.terminate()
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
