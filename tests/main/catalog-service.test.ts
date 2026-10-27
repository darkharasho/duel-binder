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

  it('applies a card changed after its new printings, across pages', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    const cursor = Number(getMeta(db, 'catalog_cursor'))
    const NEW = 99999999
    portal.serverDb
      .prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'Brand New Card', 'Effect Monster', 'effect', 'Spellcaster', 'text', '2026-10-25')`
      )
      .run(NEW)
    portal.serverDb
      .prepare(
        "INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, 'New Set', 'NEW-EN001', 'Common', 'en')"
      )
      .run(NEW)
    // The next night re-stamps the card after its printing.
    portal.serverDb.prepare("UPDATE cards SET tcgplayer_price = '1.23' WHERE id = ?").run(NEW)
    const onePerPage: CloudClient = {
      ...client,
      catalogChanges: (since) => client.catalogChanges(since, 1)
    }

    expect(await service.update(onePerPage, { force: true })).toEqual({
      changed: true,
      imagesChanged: false
    })

    expect(service.status()).toMatchObject({ state: 'idle', error: null })
    expect(cardName(db, NEW)).toBe('Brand New Card')
    expect(
      db.prepare('SELECT 1 FROM card_printings WHERE pkey = ?').get(`en|${NEW}|NEW-EN001|Common`)
    ).toBeDefined()
    expect(Number(getMeta(db, 'catalog_cursor'))).toBeGreaterThan(cursor)
    expect(getMeta(db, 'catalog_staging_cursor')).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM catalog_staging').get()).toEqual({ n: 0 })
  })

  it('applies nothing from a pull that stopped, and resumes it from the staged pages', async () => {
    const service = makeService()
    await service.update(client, { force: true })
    const cursor = getMeta(db, 'catalog_cursor')
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
    // Page 1 is staged, not applied.
    expect(cardName(db, DM)).not.toBe('Zorblax Renamed')
    expect(getMeta(db, 'catalog_cursor')).toBe(cursor)
    const staged = getMeta(db, 'catalog_staging_cursor')
    expect(Number(staged)).toBeGreaterThan(Number(cursor))
    expect(db.prepare('SELECT count(*) AS n FROM catalog_staging').get()).toEqual({ n: 1 })
    expect(getMeta(db, 'catalog_unannounced')).toBeNull()

    // The next run carries on from the staged cursor and applies both pages together.
    const sinces: number[] = []
    const watching: CloudClient = {
      ...client,
      catalogChanges: (since) => {
        sinces.push(since)
        return client.catalogChanges(since, 1)
      }
    }
    expect(await service.update(watching, { force: true })).toEqual({
      changed: true,
      imagesChanged: false
    })
    expect(sinces[0]).toBe(Number(staged))
    expect(cardName(db, DM)).toBe('Zorblax Renamed')
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'zorblax'").get()
    ).toEqual({ n: 1 })
    expect(getMeta(db, 'catalog_staging_cursor')).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM catalog_staging').get()).toEqual({ n: 0 })
    expect(getMeta(db, 'catalog_unannounced')).toBeNull()
  })

  it("takes the server's missing_from_api in a delta", async () => {
    const service = makeService()
    await service.update(client, { force: true })
    const [a, b] = db
      .prepare("SELECT pkey FROM card_printings WHERE language = 'en' ORDER BY id LIMIT 2")
      .all() as { pkey: string }[]
    const flag = 'UPDATE card_printings SET missing_from_api = ? WHERE pkey = ?'
    db.prepare(flag).run(1, b.pkey)
    portal.serverDb.prepare(flag).run(1, a.pkey)
    // A change the desktop hasn't seen, so b is in the feed again with its server value 0.
    portal.serverDb.prepare("UPDATE card_printings SET set_price = 9.99 WHERE pkey = ?").run(b.pkey)

    await service.update(client, { force: true })

    const missing = (pkey: string): unknown =>
      db.prepare('SELECT missing_from_api AS m FROM card_printings WHERE pkey = ?').get(pkey)
    expect(missing(a.pkey)).toEqual({ m: 1 })
    expect(missing(b.pkey)).toEqual({ m: 0 })
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
