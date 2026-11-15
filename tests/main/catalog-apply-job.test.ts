import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import type Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { runApplyJob, withoutForeignKeys } from '../../src/main/catalog/applyJob'
import { stageChanges } from '../../src/main/catalog/switch'
import { CatalogApplierStopped, workerApplier } from '../../src/main/catalogApplier'
import { getMeta, setMeta } from '../../src/main/db/meta'
import type { CatalogChange } from '../../src/shared/catalogFeed'
import { seededDb } from './helpers'

const NEW = 990001

const staged = (db: Database.Database): number =>
  (db.prepare('SELECT count(*) AS n FROM catalog_staging').get() as { n: number }).n

const cardName = (db: Database.Database, id: number): string | undefined =>
  (db.prepare('SELECT name FROM cards WHERE id = ?').get(id) as { name: string } | undefined)?.name

const someCards = (db: Database.Database, n: number): Record<string, string | number | null>[] =>
  db.prepare('SELECT * FROM cards ORDER BY id LIMIT ?').all(n) as Record<
    string,
    string | number | null
  >[]

const rename = (
  seq: number,
  card: Record<string, string | number | null>,
  name: string
): CatalogChange => ({
  seq,
  table: 'cards',
  row: { ...card, name }
})

const apply = (db: Database.Database, cursor: number, chunk = 1): void =>
  withoutForeignKeys(db, () =>
    runApplyJob(db, { kind: 'apply', game: 'ygo', cursor, dbVersion: 'v9' }, { chunk })
  )

describe('runApplyJob', () => {
  it('applies a printing staged before its card, though they land in different transactions', async () => {
    const db = await seededDb()
    const [card] = someCards(db, 1)
    stageChanges(
      db,
      [
        {
          seq: 1,
          table: 'card_printings',
          row: {
            id: 1,
            card_id: NEW,
            set_name: 'Chunked Set',
            set_code: 'CHK-EN001',
            set_rarity: 'Common',
            language: 'en',
            contributed: 0,
            missing_from_api: 0
          }
        },
        { seq: 2, table: 'cards', row: { ...card, id: NEW, name: 'Chunked Card' } }
      ],
      'ygo'
    )
    setMeta(db, 'catalog_staging_cursor', '2')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    apply(db, 50)

    expect(cardName(db, NEW)).toBe('Chunked Card')
    expect(
      db
        .prepare("SELECT 1 FROM card_printings WHERE card_id = ? AND set_code = 'CHK-EN001'")
        .get(NEW)
    ).toBeDefined()
    expect(staged(db)).toBe(0)
    expect(getMeta(db, 'catalog_cursor')).toBe('50')
    expect(getMeta(db, 'catalog_staging_cursor')).toBeNull()
    expect(getMeta(db, 'db_version')).toBe('v9')
    expect(JSON.parse(getMeta(db, 'catalog_unannounced') ?? '{}')).toEqual({
      cardsChanged: true,
      imagesChanged: false,
      needsFinish: true
    })
    // Nothing dangles, so nothing is logged; foreign keys are back on.
    expect(warn).not.toHaveBeenCalled()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    warn.mockRestore()

    // The search index catches up on `finish`.
    runApplyJob(db, { kind: 'finish' })
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'chunked'").get()
    ).toEqual({ n: 1 })
    expect(JSON.parse(getMeta(db, 'catalog_unannounced') ?? '{}').needsFinish).toBe(false)
  })

  it('keeps the chunks applied before a failure and leaves the rest staged for the next run', async () => {
    const db = await seededDb()
    const [a, b, c] = someCards(db, 3)
    stageChanges(db, [rename(1, a, 'First Renamed'), rename(2, b, 'Second Renamed')], 'ygo')
    db.prepare("INSERT INTO catalog_staging (seq, tbl, row) VALUES (3, 'cards', '{broken')").run()
    setMeta(db, 'catalog_cursor', '0')
    setMeta(db, 'catalog_staging_cursor', '3')

    expect(() => apply(db, 3)).toThrow()

    expect(cardName(db, Number(a.id))).toBe('First Renamed')
    expect(cardName(db, Number(b.id))).toBe('Second Renamed')
    expect(staged(db)).toBe(1)
    expect(getMeta(db, 'catalog_cursor')).toBe('0')
    expect(getMeta(db, 'catalog_staging_cursor')).toBe('3')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    db.prepare('UPDATE catalog_staging SET row = ? WHERE seq = 3').run(
      JSON.stringify({ ...rename(3, c, 'Third Renamed'), game: 'ygo' })
    )
    apply(db, 3)

    expect(cardName(db, Number(c.id))).toBe('Third Renamed')
    expect(staged(db)).toBe(0)
    expect(getMeta(db, 'catalog_cursor')).toBe('3')
  })

  it("leaves another game's staged changes alone", async () => {
    const db = await seededDb()
    const [a, b] = someCards(db, 2)
    stageChanges(db, [rename(1, a, 'Yugi Renamed')], 'ygo')
    stageChanges(db, [rename(2, b, 'Magic Renamed')], 'mtg')

    apply(db, 1)

    expect(cardName(db, Number(a.id))).toBe('Yugi Renamed')
    expect(cardName(db, Number(b.id))).not.toBe('Magic Renamed')
    expect(staged(db)).toBe(1)
  })

  it("drops a deleted printing's prices, art and price request, as the cascade would", async () => {
    const db = await seededDb()
    const p = db
      .prepare('SELECT id, pkey FROM card_printings WHERE contributed = 0 ORDER BY id LIMIT 1')
      .get() as { id: number; pkey: string }
    db.prepare(
      "INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 1, 1, 'x')"
    ).run(p.id)
    db.prepare("INSERT INTO printing_art (printing_id, url, checked_at) VALUES (?, NULL, 'x')").run(
      p.id
    )
    db.prepare("INSERT INTO price_requests (printing_id, requested_at) VALUES (?, 'x')").run(p.id)
    stageChanges(db, [{ seq: 1, table: 'card_printings', deleted: [p.pkey] }], 'ygo')

    apply(db, 1)

    expect(db.prepare('SELECT 1 FROM card_printings WHERE id = ?').get(p.id)).toBeUndefined()
    for (const t of ['intl_prices', 'printing_art', 'price_requests'])
      expect(db.prepare(`SELECT 1 FROM ${t} WHERE printing_id = ?`).get(p.id)).toBeUndefined()
  })

  it('logs rows a multi-chunk apply left pointing at missing rows', async () => {
    const db = await seededDb()
    const [a] = someCards(db, 1)
    stageChanges(
      db,
      [
        rename(1, a, 'Renamed'),
        {
          seq: 2,
          table: 'card_printings',
          row: {
            id: 1,
            card_id: NEW,
            set_name: 'Orphan Set',
            set_code: 'ORP-EN001',
            set_rarity: 'Common',
            language: 'en',
            contributed: 0,
            missing_from_api: 0
          }
        }
      ],
      'ygo'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    apply(db, 2)

    expect(warn).toHaveBeenCalledWith('Catalog ygo: 1 card_printings rows point at missing rows')
    warn.mockRestore()
  })

  it('refuses to apply with foreign keys on', async () => {
    const db = await seededDb()
    expect(() =>
      runApplyJob(db, { kind: 'apply', game: 'ygo', cursor: 1, dbVersion: null })
    ).toThrow('foreign keys off')
  })
})

class FakeWorker extends EventEmitter {
  sent: { id: number; job: unknown }[] = []
  terminated = false
  postMessage(m: { id: number; job: unknown }): void {
    this.sent.push(m)
  }
  unref(): void {
    // A fake: nothing to keep alive.
  }
  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }
}

describe('workerApplier', () => {
  it('resolves a job on its reply and rejects on an error reply', async () => {
    const w = new FakeWorker()
    const applier = workerApplier(() => w as unknown as Worker)

    const a = applier.run({ kind: 'finish' })
    const b = applier.run({ kind: 'apply', game: 'mtg', cursor: 9, dbVersion: null })
    expect(w.sent.map((m) => m.job)).toEqual([
      { kind: 'finish' },
      { kind: 'apply', game: 'mtg', cursor: 9, dbVersion: null }
    ])
    w.emit('message', { id: w.sent[1].id, error: 'disk full' })
    w.emit('message', { id: w.sent[0].id })

    await expect(a).resolves.toBeUndefined()
    await expect(b).rejects.toThrow('disk full')
  })

  it('fails the waiting jobs when the worker dies, and starts a new one for the next', async () => {
    const workers: FakeWorker[] = []
    const applier = workerApplier(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w as unknown as Worker
    })

    const a = applier.run({ kind: 'finish' })
    workers[0].emit('exit', 1)
    await expect(a).rejects.toThrow('Catalog worker exited (1)')

    const b = applier.run({ kind: 'finish' })
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { id: workers[1].sent[0].id })
    await expect(b).resolves.toBeUndefined()

    const c = applier.run({ kind: 'finish' })
    applier.dispose()
    await expect(c).rejects.toThrow('Catalog worker stopped')
    await expect(c).rejects.toBeInstanceOf(CatalogApplierStopped)
    expect(workers[1].terminated).toBe(true)
  })
})
