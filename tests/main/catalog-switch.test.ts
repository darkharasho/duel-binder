import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectionCensus, runSwitch } from '../../src/main/catalog/switch'
import {
  CloudAuthError,
  CloudOfflineError,
  createCloudClient,
  type CloudClient
} from '../../src/main/cloud/client'
import { openDatabase } from '../../src/main/db/database'
import { deleteMeta, getMeta, setMeta } from '../../src/main/db/meta'
import { addEntry } from '../../src/main/repo/collection'
import { seededDb } from './helpers'
import { inProcessPortal, PORTAL } from './cloudHelpers'

type Portal = Awaited<ReturnType<typeof inProcessPortal>>
let portal: Portal
let client: CloudClient
let dir: string
let backupPath: string
const NOW = new Date('2026-10-26T09:00:00.000Z')
const OTHER_OWNER = 7

interface P {
  id: number
  card_id: number
  set_name: string
  set_code: string
  set_rarity: string
  pkey: string
}

const imageOf = (db: Database.Database, cardId: number): number =>
  (
    db
      .prepare(
        'SELECT image_id AS id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1'
      )
      .get(cardId) as {
      id: number
    }
  ).id

const addPrinting = (db: Database.Database, cardId: number, setCode: string): P => {
  const id = Number(
    db
      .prepare(
        "INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, 'Local Only Set', ?, 'Common', 'en')"
      )
      .run(cardId, setCode).lastInsertRowid
  )
  return db.prepare('SELECT * FROM card_printings WHERE id = ?').get(id) as P
}

/**
 * The desktop's old catalog with entries for owner 0 and owner 7 (one tombstoned), one printing only
 * the desktop has that an entry uses, and one only the desktop has that nobody uses. The server gets
 * one printing only it has.
 */
async function oldDesktop(): Promise<{
  db: Database.Database
  used: P
  unused: P
  serverOnlyPkey: string
}> {
  const db = await seededDb()
  const printings = db
    .prepare("SELECT * FROM card_printings WHERE language = 'en' ORDER BY id LIMIT 3")
    .all() as P[]
  const [a, b, c] = printings
  addEntry(db, { printingId: a.id, imageId: imageOf(db, a.card_id), quantity: 3 }, NOW)
  addEntry(db, { printingId: b.id, imageId: imageOf(db, b.card_id), quantity: 1 }, NOW)
  const used = addPrinting(db, a.card_id, 'ZZZ-EN001')
  const unused = addPrinting(db, a.card_id, 'ZZZ-EN002')
  addEntry(db, { printingId: used.id, imageId: imageOf(db, a.card_id), quantity: 2 }, NOW)
  setMeta(db, 'cloud_active_owner', String(OTHER_OWNER))
  addEntry(db, { printingId: a.id, imageId: imageOf(db, a.card_id), quantity: 4 }, NOW)
  const gone = addEntry(db, { printingId: c.id, imageId: imageOf(db, c.card_id), quantity: 1 }, NOW)
  db.prepare('UPDATE collection_entries SET deleted_at = ? WHERE id = ?').run(
    NOW.toISOString(),
    gone.id
  )
  deleteMeta(db, 'cloud_active_owner')
  // Catalog side tables: one both have, one only the desktop has.
  for (const d of [db, portal.serverDb])
    d.prepare(
      "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Shared Set', 'SHR')"
    ).run()
  db.prepare(
    "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Old Set', 'OLD')"
  ).run()
  db.prepare(
    "INSERT INTO pack_art (set_name, image_url, image_key) VALUES ('Old Set', 'u', 'k')"
  ).run()

  const card = (
    portal.serverDb.prepare('SELECT id FROM cards ORDER BY id LIMIT 1').get() as { id: number }
  ).id
  portal.serverDb
    .prepare(
      "INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, 'Server Set', 'SRV-EN001', 'Common', 'en')"
    )
    .run(card)
  return { db, used, unused, serverOnlyPkey: `en|${card}|SRV-EN001|Common` }
}

const entriesSnapshot = (db: Database.Database): unknown[] =>
  db.prepare('SELECT * FROM collection_entries ORDER BY id').all()

const remoteIds = (db: Database.Database): number =>
  (
    db.prepare('SELECT count(*) AS n FROM card_printings WHERE remote_id IS NOT NULL').get() as {
      n: number
    }
  ).n

const failure = (db: Database.Database): { reason: string; at: string; retry: string } | null => {
  const raw = getMeta(db, 'catalog_switch_failed')
  return raw === null ? null : JSON.parse(raw)
}

/** The real client with small pages, so the snapshot spans several; `onCall` runs before each page. */
const paged = (
  limit: number,
  onCall: (n: number, since: number) => void = () => {}
): CloudClient => {
  let n = 0
  return {
    ...client,
    catalogChanges: async (since) => {
      onCall(++n, since)
      return client.catalogChanges(since, limit)
    }
  }
}

beforeEach(async () => {
  portal = await inProcessPortal()
  const token = await portal.desktopToken(portal.addUser('alice'))
  client = createCloudClient({ baseUrl: PORTAL, token, fetch: portal.fetch })
  dir = mkdtempSync(join(tmpdir(), 'switch-'))
  backupPath = join(dir, 'backups', '2026-10-26-pre-server-catalog.sqlite')
})
afterEach(() => {
  portal.serverDb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('collectionCensus', () => {
  it('is the same for the same live entries, whatever the row order', async () => {
    const { db } = await oldDesktop()
    const census = collectionCensus(db)
    expect(JSON.parse(census)).toHaveLength(2)
    await db.backup(join(dir, 'copy.sqlite'))
    const other = new Database(join(dir, 'copy.sqlite'))
    expect(collectionCensus(other)).toBe(census)
    other.close()
  })
})

describe('runSwitch', () => {
  it('switches and leaves every entry pointing at the same pkey', async () => {
    const { db, serverOnlyPkey } = await oldDesktop()
    const before = collectionCensus(db)
    const entries = entriesSnapshot(db)
    const phases: string[] = []

    const outcome = await runSwitch(db, {
      client,
      backupPath,
      now: () => NOW,
      onProgress: (p) => phases.push(p)
    })

    expect(outcome).toEqual({ state: 'done' })
    expect(collectionCensus(db)).toBe(before)
    expect(entriesSnapshot(db)).toEqual(entries)
    expect(phases).toEqual(['downloading', 'saving'])
    // Every server printing is here with its server id.
    const server = portal.serverDb.prepare('SELECT id, pkey FROM card_printings').all() as {
      id: number
      pkey: string
    }[]
    for (const s of server) {
      const local = db
        .prepare('SELECT remote_id FROM card_printings WHERE pkey = ?')
        .get(s.pkey) as { remote_id: number } | undefined
      expect(local?.remote_id, s.pkey).toBe(s.id)
    }
    expect(
      db.prepare('SELECT 1 FROM card_printings WHERE pkey = ?').get(serverOnlyPkey)
    ).toBeDefined()
    // Side tables match the server; the desktop-only set and pack art are gone.
    expect(db.prepare('SELECT set_name FROM sets ORDER BY set_name').all()).toEqual(
      portal.serverDb.prepare('SELECT set_name FROM sets ORDER BY set_name').all()
    )
    expect(db.prepare("SELECT 1 FROM sets WHERE set_name = 'Old Set'").get()).toBeUndefined()
    expect(db.prepare('SELECT count(*) AS n FROM pack_art').get()).toEqual({ n: 0 })
    // Bookkeeping.
    const serverSeq = (
      portal.serverDb.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }
    ).seq
    expect(getMeta(db, 'catalog_cursor')).toBe(String(serverSeq))
    expect(getMeta(db, 'catalog_switched_at')).toBe(NOW.toISOString())
    expect(getMeta(db, 'last_sync_at')).toBe(NOW.toISOString())
    expect(getMeta(db, 'db_version')).toBe(getMeta(portal.serverDb, 'db_version'))
    expect(getMeta(db, 'catalog_staging_cursor')).toBeNull()
    expect(getMeta(db, 'catalog_switch_failed')).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM catalog_staging').get()).toEqual({ n: 0 })
    // Search still finds cards.
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'magician'").get()
    ).toEqual({ n: 1 })
  })

  it('keeps a desktop-only printing an entry uses, flagged', async () => {
    const { db, used } = await oldDesktop()
    expect(await runSwitch(db, { client, backupPath, now: () => NOW })).toEqual({ state: 'done' })
    const row = db
      .prepare('SELECT id, pkey, remote_id, missing_from_api FROM card_printings WHERE id = ?')
      .get(used.id)
    expect(row).toEqual({ id: used.id, pkey: used.pkey, remote_id: null, missing_from_api: 1 })
  })

  it('drops desktop-only printings nobody uses', async () => {
    const { db, unused } = await oldDesktop()
    expect(await runSwitch(db, { client, backupPath, now: () => NOW })).toEqual({ state: 'done' })
    expect(db.prepare('SELECT 1 FROM card_printings WHERE id = ?').get(unused.id)).toBeUndefined()
    // Nothing else is left without a server id except the used one.
    expect(
      db.prepare('SELECT count(*) AS n FROM card_printings WHERE remote_id IS NULL').get()
    ).toEqual({ n: 1 })
  })

  it('keeps a desktop-only printing that only a tombstoned entry uses', async () => {
    const { db, unused } = await oldDesktop()
    const e = db
      .prepare(
        "INSERT INTO collection_entries (uid, owner_id, printing_id, image_id, quantity, created_at, updated_at, deleted_at) VALUES ('t-1', 7, ?, ?, 1, ?, ?, ?)"
      )
      .run(
        unused.id,
        imageOf(db, unused.card_id),
        NOW.toISOString(),
        NOW.toISOString(),
        NOW.toISOString()
      )
    expect(await runSwitch(db, { client, backupPath, now: () => NOW })).toEqual({ state: 'done' })
    expect(
      db.prepare('SELECT printing_id FROM collection_entries WHERE id = ?').get(e.lastInsertRowid)
    ).toEqual({
      printing_id: unused.id
    })
    expect(
      db.prepare('SELECT missing_from_api FROM card_printings WHERE id = ?').get(unused.id)
    ).toEqual({
      missing_from_api: 1
    })
  })

  it('writes the backup before changing anything', async () => {
    const { db } = await oldDesktop()
    const entries = (
      db.prepare('SELECT count(*) AS n FROM collection_entries').get() as { n: number }
    ).n
    let backupSeenDuringApply = false
    const outcome = await runSwitch(db, {
      client,
      backupPath,
      now: () => NOW,
      afterApply: () => {
        backupSeenDuringApply = existsSync(backupPath)
      }
    })
    expect(outcome).toEqual({ state: 'done' })
    expect(backupSeenDuringApply).toBe(true)
    expect(getMeta(db, 'catalog_switch_backup')).toBe(backupPath)
    const copy = new Database(backupPath, { readonly: true })
    expect(copy.prepare('SELECT count(*) AS n FROM collection_entries').get()).toEqual({
      n: entries
    })
    expect(
      copy.prepare('SELECT count(*) AS n FROM card_printings WHERE remote_id IS NOT NULL').get()
    ).toEqual({ n: 0 })
    expect(copy.prepare("SELECT 1 FROM sets WHERE set_name = 'Old Set'").get()).toBeDefined()
    copy.close()
  })

  it('does not take a second backup when the first is still there', async () => {
    const { db } = await oldDesktop()
    const spy = vi.spyOn(db, 'backup')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dropOne = (d: { prepare(sql: string): { run(): unknown } }): void => {
      d.prepare(
        'DELETE FROM collection_entries WHERE id = (SELECT min(id) FROM collection_entries)'
      ).run()
    }
    expect(
      await runSwitch(db, { client, backupPath, now: () => NOW, afterApply: dropOne })
    ).toMatchObject({
      state: 'pending'
    })
    warn.mockRestore()
    expect(await runSwitch(db, { client, backupPath, now: () => NOW })).toEqual({ state: 'done' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('waits for the next run when the backup fails, and applies nothing', async () => {
    const { db } = await oldDesktop()
    vi.spyOn(db, 'backup').mockRejectedValue(new Error('disk full'))
    const outcome = await runSwitch(db, { client, backupPath, now: () => NOW })
    expect(outcome).toEqual({ state: 'pending', reason: "Couldn't back up your collection" })
    expect(failure(db)).toEqual({
      reason: "Couldn't back up your collection",
      at: NOW.toISOString(),
      retry: 'next-run'
    })
    expect(remoteIds(db)).toBe(0)
    expect(getMeta(db, 'catalog_switched_at')).toBeNull()
    expect(getMeta(db, 'catalog_switch_backup')).toBeNull()
  })

  it('resumes a staged snapshot and applies only when complete', async () => {
    const { db } = await oldDesktop()
    const before = collectionCensus(db)
    const offline = paged(3, (n) => {
      if (n === 3) throw new CloudOfflineError()
    })

    const first = await runSwitch(db, { client: offline, backupPath, now: () => NOW })

    expect(first.state).toBe('pending')
    expect(failure(db)).toMatchObject({ retry: 'next-run', at: NOW.toISOString() })
    expect(db.prepare('SELECT count(*) AS n FROM catalog_staging').get()).toEqual({ n: 6 })
    const staged = Number(getMeta(db, 'catalog_staging_cursor'))
    expect(staged).toBeGreaterThan(0)
    expect(remoteIds(db)).toBe(0)
    expect(getMeta(db, 'catalog_switched_at')).toBeNull()
    expect(existsSync(backupPath)).toBe(false)

    const sinces: number[] = []
    const second = await runSwitch(db, {
      client: paged(3, (_n, since) => sinces.push(since)),
      backupPath,
      now: () => NOW
    })

    expect(second).toEqual({ state: 'done' })
    expect(sinces[0]).toBe(staged)
    expect(collectionCensus(db)).toBe(before)
    expect(remoteIds(db)).toBe(
      (portal.serverDb.prepare('SELECT count(*) AS n FROM card_printings').get() as { n: number }).n
    )
    expect(failure(db)).toBeNull()
  })

  it('treats a server failure mid-download like being offline', async () => {
    const { db } = await oldDesktop()
    const failing = paged(3, (n) => {
      if (n === 2) throw new CloudOfflineError('The portal failed (503)')
    })
    const outcome = await runSwitch(db, { client: failing, backupPath, now: () => NOW })
    expect(outcome.state).toBe('pending')
    expect(failure(db)?.retry).toBe('next-run')
    expect(db.prepare('SELECT count(*) AS n FROM catalog_staging').get()).toEqual({ n: 3 })
  })

  it('re-throws a sign-in error and records nothing', async () => {
    const { db } = await oldDesktop()
    const signedOut = paged(3, () => {
      throw new CloudAuthError()
    })
    await expect(
      runSwitch(db, { client: signedOut, backupPath, now: () => NOW })
    ).rejects.toBeInstanceOf(CloudAuthError)
    expect(failure(db)).toBeNull()
  })

  it('rolls back and waits for next launch when the census differs', async () => {
    const { db } = await oldDesktop()
    const entries = entriesSnapshot(db)
    const catalog = db.prepare('SELECT * FROM card_printings ORDER BY id').all()
    const sets = db.prepare('SELECT * FROM sets ORDER BY set_name').all()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await runSwitch(db, {
      client,
      backupPath,
      now: () => NOW,
      afterApply: (d) => {
        d.prepare(
          'DELETE FROM collection_entries WHERE deleted_at IS NULL AND id = (SELECT min(id) FROM collection_entries)'
        ).run()
      }
    })

    expect(outcome).toEqual({
      state: 'pending',
      reason: "Your collection didn't match after updating card data"
    })
    expect(failure(db)).toEqual({
      reason: "Your collection didn't match after updating card data",
      at: NOW.toISOString(),
      retry: 'next-launch'
    })
    expect(entriesSnapshot(db)).toEqual(entries)
    expect(db.prepare('SELECT * FROM card_printings ORDER BY id').all()).toEqual(catalog)
    expect(db.prepare('SELECT * FROM sets ORDER BY set_name').all()).toEqual(sets)
    expect(getMeta(db, 'catalog_switched_at')).toBeNull()
    expect(getMeta(db, 'catalog_cursor')).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('fails the census when an entry is left pointing at no printing', async () => {
    const { db } = await oldDesktop()
    const entries = entriesSnapshot(db)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await runSwitch(db, {
      client,
      backupPath,
      now: () => NOW,
      afterApply: (d) => {
        // A tombstoned entry's printing: the live census alone wouldn't notice.
        d.prepare(
          'DELETE FROM card_printings WHERE id = (SELECT printing_id FROM collection_entries WHERE deleted_at IS NOT NULL)'
        ).run()
      }
    })

    expect(outcome).toEqual({
      state: 'pending',
      reason: "Your collection didn't match after updating card data"
    })
    expect(failure(db)?.retry).toBe('next-launch')
    expect(entriesSnapshot(db)).toEqual(entries)
    expect(remoteIds(db)).toBe(0)
    warn.mockRestore()
  })

  it('a fresh install with no entries switches too', async () => {
    const db = openDatabase(':memory:')
    const outcome = await runSwitch(db, { client, backupPath, now: () => NOW })
    expect(outcome).toEqual({ state: 'done' })
    const count = (d: Database.Database, t: string): number =>
      (d.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n
    for (const t of ['cards', 'card_images', 'card_printings'])
      expect(count(db, t), t).toBe(count(portal.serverDb, t))
    expect(getMeta(db, 'catalog_switched_at')).toBe(NOW.toISOString())
  })

  it('does nothing once switched', async () => {
    const { db } = await oldDesktop()
    setMeta(db, 'catalog_switched_at', NOW.toISOString())
    const call = vi.fn(async () => {
      throw new Error('no network expected')
    })
    const outcome = await runSwitch(db, {
      client: { ...client, catalogChanges: call },
      backupPath,
      now: () => NOW
    })
    expect(outcome).toEqual({ state: 'done' })
    expect(call).not.toHaveBeenCalled()
    expect(existsSync(backupPath)).toBe(false)
  })
})
