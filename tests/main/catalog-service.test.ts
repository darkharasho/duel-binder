import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatalogService, type CatalogService } from '../../src/main/catalog/service'
import { CloudOfflineError, createCloudClient, type CloudClient } from '../../src/main/cloud/client'
import { getMeta, setMeta } from '../../src/main/db/meta'
import type { SyncStatus } from '../../src/shared/types'
import { seededDb } from './helpers'
import { inProcessPortal, PORTAL } from './cloudHelpers'

type Portal = Awaited<ReturnType<typeof inProcessPortal>>
let portal: Portal
let client: CloudClient
let dir: string
let db: Database.Database
let emitted: SyncStatus[]
let clock: Date
const LAUNCHED = new Date('2026-10-26T08:00:00.000Z')
const NOW = new Date('2026-10-26T09:00:00.000Z')
const DM = 46986414

const offline: () => CloudClient = () => ({
  ...client,
  catalogChanges: vi.fn(async () => {
    throw new CloudOfflineError()
  })
})

const cardName = (d: Database.Database, id: number): string =>
  (d.prepare('SELECT name FROM cards WHERE id = ?').get(id) as { name: string }).name

function makeService(launchedAt = LAUNCHED): CatalogService {
  return createCatalogService({
    db,
    backupPath: (now) =>
      join(dir, 'backups', `${now.toISOString().slice(0, 10)}-pre-server-catalog.sqlite`),
    emit: (s) => emitted.push(s),
    now: () => clock,
    launchedAt
  })
}

beforeEach(async () => {
  portal = await inProcessPortal()
  const token = await portal.desktopToken(portal.addUser('alice'))
  client = createCloudClient({ baseUrl: PORTAL, token, fetch: portal.fetch })
  dir = mkdtempSync(join(tmpdir(), 'catalog-service-'))
  db = await seededDb()
  emitted = []
  clock = NOW
})
afterEach(() => {
  db.close()
  portal.serverDb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('catalog service', () => {
  it('keeps the old catalog when the snapshot can’t download', async () => {
    const service = makeService()
    const cards = db.prepare('SELECT * FROM cards ORDER BY id').all()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await service.update(offline(), { force: true })

    expect(result).toEqual({ changed: false, imagesChanged: false })
    expect(service.status()).toMatchObject({
      state: 'idle',
      error: null,
      blocked: "Couldn't reach the server to download card data"
    })
    expect(emitted.at(-1)?.blocked).toBe("Couldn't reach the server to download card data")
    expect(emitted.map((s) => s.state)).toEqual(['checking', 'downloading', 'idle'])
    expect(db.prepare('SELECT * FROM cards ORDER BY id').all()).toEqual(cards)
    expect(getMeta(db, 'catalog_switched_at')).toBeNull()
    warn.mockRestore()

    // The next run retries and switches.
    const second = await service.update(client, { force: true })
    expect(second).toEqual({ changed: true, imagesChanged: true })
    expect(getMeta(db, 'catalog_switched_at')).toBe(NOW.toISOString())
    expect(service.status()).toMatchObject({ state: 'idle', blocked: null, error: null })
  })

  it('pulls only deltas after the switch', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    const cursor = Number(getMeta(db, 'catalog_cursor'))

    portal.serverDb
      .prepare("UPDATE cards SET name = 'Dark Magician (Renamed)' WHERE id = ?")
      .run(DM)
    const sinces: number[] = []
    const watching: CloudClient = {
      ...client,
      catalogChanges: (since, limit) => {
        sinces.push(since)
        return client.catalogChanges(since, limit)
      }
    }
    emitted = []
    clock = new Date(NOW.getTime() + 2 * 3_600_000)

    const result = await service.update(watching)

    expect(result).toEqual({ changed: true, imagesChanged: false })
    expect(sinces[0]).toBe(cursor)
    expect(cardName(db, DM)).toBe('Dark Magician (Renamed)')
    expect(Number(getMeta(db, 'catalog_cursor'))).toBeGreaterThan(cursor)
    expect(getMeta(db, 'last_sync_at')).toBe(clock.toISOString())
    expect(emitted.map((s) => s.state)).toEqual(['checking', 'downloading', 'saving', 'idle'])
    // Search sees the new name.
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'renamed'").get()
    ).toEqual({ n: 1 })

    // Nothing new: unchanged, and the cursor holds.
    const held = getMeta(db, 'catalog_cursor')
    expect(await service.update(client, { force: true })).toEqual({
      changed: false,
      imagesChanged: false
    })
    expect(getMeta(db, 'catalog_cursor')).toBe(held)
  })

  it('skips an unforced update within the hour', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    portal.serverDb.prepare("UPDATE cards SET name = 'Later Name' WHERE id = ?").run(DM)
    const call = vi.fn(client.catalogChanges)
    const watching: CloudClient = { ...client, catalogChanges: call }

    clock = new Date(NOW.getTime() + 59 * 60_000)
    expect(await service.update(watching)).toEqual({ changed: false, imagesChanged: false })
    expect(call).not.toHaveBeenCalled()

    clock = new Date(NOW.getTime() + 60 * 60_000)
    expect(await service.update(watching)).toEqual({ changed: true, imagesChanged: false })
    expect(cardName(db, DM)).toBe('Later Name')
  })

  it('does not retry a census failure until the next launch', async () => {
    const reason = "Your collection didn't match after updating card data"
    setMeta(
      db,
      'catalog_switch_failed',
      JSON.stringify({
        reason,
        at: new Date(LAUNCHED.getTime() + 60_000).toISOString(),
        retry: 'next-launch'
      })
    )
    const call = vi.fn(client.catalogChanges)
    const watching: CloudClient = { ...client, catalogChanges: call }

    const thisLaunch = makeService()
    expect(thisLaunch.status().blocked).toBe(reason)
    expect(await thisLaunch.update(watching, { force: true })).toEqual({
      changed: false,
      imagesChanged: false
    })
    expect(call).not.toHaveBeenCalled()
    expect(thisLaunch.status()).toMatchObject({ state: 'idle', blocked: reason, error: null })

    // The next launch tries again.
    const nextLaunch = makeService(new Date(NOW.getTime() + 3_600_000))
    expect(await nextLaunch.update(watching, { force: true })).toEqual({
      changed: true,
      imagesChanged: true
    })
    expect(call).toHaveBeenCalled()
    expect(nextLaunch.status().blocked).toBeNull()
  })

  it('shows an unexpected failure as an error and swallows it', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    const broken: CloudClient = {
      ...client,
      catalogChanges: async () => {
        throw new Error('bad page')
      }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await service.update(broken, { force: true })).toEqual({
      changed: false,
      imagesChanged: false
    })
    expect(service.status()).toMatchObject({ state: 'error', error: 'bad page' })
    warn.mockRestore()
  })

  it('finishes and announces pages that landed before the pull failed', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    portal.serverDb.prepare("UPDATE cards SET name = 'Zorblax Renamed' WHERE id = ?").run(DM)
    portal.serverDb
      .prepare("UPDATE cards SET name = name || ' Again' WHERE id = (SELECT max(id) FROM cards)")
      .run()
    let n = 0
    const secondPageOffline: CloudClient = {
      ...client,
      catalogChanges: async (since) => {
        if (++n === 2) throw new CloudOfflineError()
        return client.catalogChanges(since, 1)
      }
    }

    await expect(service.update(secondPageOffline, { force: true })).rejects.toBeInstanceOf(
      CloudOfflineError
    )
    expect(n).toBe(2)
    expect(cardName(db, DM)).toBe('Zorblax Renamed')
    expect(getMeta(db, 'catalog_unannounced')).not.toBeNull()

    // Within the hour and unforced: reported without a network call.
    const call = vi.fn(client.catalogChanges)
    expect(await service.update({ ...client, catalogChanges: call })).toEqual({
      changed: true,
      imagesChanged: false
    })
    expect(call).not.toHaveBeenCalled()
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'zorblax'").get()
    ).toEqual({ n: 1 })
    expect(getMeta(db, 'catalog_unannounced')).toBeNull()
  })

  it('a later update reports page 1 of a failed pull as changed', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    portal.serverDb.prepare("UPDATE cards SET name = 'Zorblax Renamed' WHERE id = ?").run(DM)
    // Page 2 touches no card, so only page 1 needs the search index rebuilt.
    portal.serverDb
      .prepare("INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'New Set', 'NEW')")
      .run()
    let n = 0
    const secondPageOffline: CloudClient = {
      ...client,
      catalogChanges: async (since) => {
        if (++n === 2) throw new CloudOfflineError()
        return client.catalogChanges(since, 1)
      }
    }
    await expect(service.update(secondPageOffline, { force: true })).rejects.toBeInstanceOf(
      CloudOfflineError
    )

    expect(await service.update(client, { force: true })).toEqual({
      changed: true,
      imagesChanged: false
    })
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'zorblax'").get()
    ).toEqual({ n: 1 })
    expect(await service.update(client, { force: true })).toEqual({
      changed: false,
      imagesChanged: false
    })
  })

  it('announces a finished switch on the next update when the delta pull is offline', async () => {
    const service = makeService()
    const afterSwitchOffline: CloudClient = {
      ...client,
      catalogChanges: async (since, limit) => {
        if (getMeta(db, 'catalog_switched_at') !== null) throw new CloudOfflineError()
        return client.catalogChanges(since, limit)
      }
    }
    await expect(service.update(afterSwitchOffline, { force: true })).rejects.toBeInstanceOf(
      CloudOfflineError
    )
    expect(getMeta(db, 'catalog_switched_at')).toBe(NOW.toISOString())
    expect(service.status()).toMatchObject({ state: 'idle', error: null, blocked: null })

    expect(await service.update(client, { force: true })).toEqual({
      changed: true,
      imagesChanged: true
    })
    expect(await service.update(client, { force: true })).toEqual({
      changed: false,
      imagesChanged: false
    })
  })

  it('going idle after a re-thrown error clears an earlier error', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.update(
      {
        ...client,
        catalogChanges: async () => {
          throw new Error('bad page')
        }
      },
      { force: true }
    )
    warn.mockRestore()
    expect(service.status().error).toBe('bad page')
    await expect(service.update(offline(), { force: true })).rejects.toBeInstanceOf(
      CloudOfflineError
    )
    expect(service.status()).toMatchObject({ state: 'idle', error: null })
  })

  it('re-throws offline during the delta pull', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    await expect(service.update(offline(), { force: true })).rejects.toBeInstanceOf(
      CloudOfflineError
    )
    expect(service.status().state).toBe('idle')
  })
})
