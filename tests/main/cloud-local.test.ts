import type Database from 'better-sqlite3'
import {
  accountName,
  accountState,
  activeOwner,
  adoptLocalData,
  applyPending,
  applyPrices,
  applyRemote,
  dirtyEntries,
  dropEntry,
  ensureAccount,
  markPushed,
  pendingCount,
  purgeCleanTombstones,
  rekey,
  saveAccountState,
  setActiveOwner,
  stalePricePkeys,
  tombstoneClean
} from '../../src/main/cloud/localSync'
import { addEntry, listEntries, updateEntry } from '../../src/main/repo/collection'
import { MAX_NOTES, type WireEntry } from '../../src/shared/cloud'
import { seededDb } from './helpers'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const ALL = { sort: 'name', dir: 'asc' } as const
const t0 = '2026-10-25T11:00:00.000Z'
const now = new Date('2026-10-25T12:00:00.000Z')
const later = new Date('2026-10-25T13:00:00.000Z')
const DM = 46986414
const POT = 55144522
const printing = (code: string): { id: number; pkey: string } =>
  db.prepare('SELECT id, pkey FROM card_printings WHERE set_code = ?').get(code) as {
    id: number
    pkey: string
  }

interface Row {
  id: number
  uid: string
  owner_id: number
  printing_id: number
  image_id: number
  quantity: number
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}
const row = (uid: string): Row | undefined =>
  db.prepare('SELECT * FROM collection_entries WHERE uid = ?').get(uid) as Row | undefined
const uidOf = (id: number): string =>
  (db.prepare('SELECT uid FROM collection_entries WHERE id = ?').get(id) as { uid: string }).uid
const cleanAll = (): void => void db.prepare('UPDATE collection_entries SET dirty = 0').run()

/** A local row as the wire carries it. */
const wireOf = (uid: string): WireEntry => {
  const r = row(uid)!
  const { pkey } = db
    .prepare('SELECT pkey FROM card_printings WHERE id = ?')
    .get(r.printing_id) as {
    pkey: string
  }
  return {
    uid,
    pkey,
    imageId: r.image_id,
    quantity: r.quantity,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

/** A remote entry on Dark Magician LOB-EN005 unless overridden. */
const wire = (o: Partial<WireEntry> = {}): WireEntry => ({
  uid: crypto.randomUUID(),
  pkey: printing('LOB-EN005').pkey,
  imageId: DM,
  quantity: 1,
  notes: '',
  createdAt: t0,
  updatedAt: t0,
  deletedAt: null,
  ...o
})

/** Adds an entry as `owner` through the repo (so it is dirty), at `at`. */
const addAs = (owner: number, code: string, imageId: number, at = now, quantity = 1): string => {
  setActiveOwner(db, owner)
  return uidOf(addEntry(db, { printingId: printing(code).id, imageId, quantity }, at).id)
}

/** Adds card 999 with art 999 and its printing `en|999|NEW-001|Rare` to the catalog. */
const addNewPrinting = (): void => {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
     VALUES (999, 'New Card', 'Normal Monster', 'normal', 'Dragon', '', ?)`
  ).run(t0)
  db.prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (999, 999, 0)').run()
  db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity) VALUES (999, 'New Set', 'NEW-001', 'Rare')`
  ).run()
}

test('active owner and account state round-trip', () => {
  expect(activeOwner(db)).toBe(0)
  setActiveOwner(db, 7)
  expect(activeOwner(db)).toBe(7)
  setActiveOwner(db, 0)
  expect(activeOwner(db)).toBe(0)

  expect(accountName(db, 7)).toBeNull()
  expect(accountState(db, 7)).toEqual({ cursor: 0, syncedAt: null })
  ensureAccount(db, 7, 'Yugi')
  ensureAccount(db, 7, 'Yugi Muto')
  expect(accountName(db, 7)).toBe('Yugi Muto')
  saveAccountState(db, 7, { cursor: 42 })
  saveAccountState(db, 7, { syncedAt: now.toISOString() })
  expect(accountState(db, 7)).toEqual({ cursor: 42, syncedAt: now.toISOString() })
  expect(accountName(db, 7)).toBe('Yugi Muto')

  // Saving before ensureAccount records the account rather than dropping the cursor.
  saveAccountState(db, 9, { cursor: 5 })
  expect(accountState(db, 9)).toEqual({ cursor: 5, syncedAt: null })
  ensureAccount(db, 9, 'Kaiba')
  expect(accountState(db, 9)).toEqual({ cursor: 5, syncedAt: null })
  expect(accountName(db, 9)).toBe('Kaiba')
})

test('dirty entries are per owner, carry the pkey and cap notes', () => {
  const a = addAs(7, 'LOB-EN005', DM)
  const b = addAs(7, 'LOB-EN119', POT)
  addAs(8, 'LOB-EN005', DM)
  db.prepare('UPDATE collection_entries SET notes = ? WHERE uid = ?').run(
    'x'.repeat(MAX_NOTES + 50),
    a
  )

  const out = dirtyEntries(db, 7, 10)
  expect(out.map((e) => e.uid)).toEqual([a, b])
  expect(out[0]).toMatchObject({
    pkey: printing('LOB-EN005').pkey,
    imageId: DM,
    quantity: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deletedAt: null
  })
  expect(out[0].notes).toHaveLength(MAX_NOTES)
  expect(dirtyEntries(db, 7, 1).map((e) => e.uid)).toEqual([a])
  expect(dirtyEntries(db, 7, 10, new Set([a])).map((e) => e.uid)).toEqual([b])

  // Tombstones are dirty too.
  db.prepare('UPDATE collection_entries SET dirty = 0 WHERE uid = ?').run(b)
  db.prepare('UPDATE collection_entries SET deleted_at = ?, dirty = 1 WHERE uid = ?').run(
    later.toISOString(),
    a
  )
  expect(dirtyEntries(db, 7, 10)).toEqual([
    expect.objectContaining({ uid: a, deletedAt: later.toISOString() })
  ])
})

test('an edit made during a push stays dirty', () => {
  const a = addAs(7, 'LOB-EN005', DM)
  const [old] = dirtyEntries(db, 7, 10)
  updateEntry(db, row(a)!.id, { quantity: 5 }, later)
  markPushed(db, old)
  expect(row(a)!.dirty).toBe(1)
  const [fresh] = dirtyEntries(db, 7, 10)
  expect(fresh.quantity).toBe(5)
  markPushed(db, fresh)
  expect(row(a)!.dirty).toBe(0)
})

test('remote edits apply clean, to the given owner, never dirty', () => {
  setActiveOwner(db, 7)
  const r = wire({ quantity: 3, notes: 'binder 2' })
  expect(applyRemote(db, 8, r)).toBe('applied')
  expect(row(r.uid)).toMatchObject({
    owner_id: 8,
    quantity: 3,
    notes: 'binder 2',
    dirty: 0,
    deleted_at: null
  })
  expect(row(r.uid)!.printing_id).toBe(printing('LOB-EN005').id)

  const edit = { ...r, quantity: 4, pkey: printing('SDY-006').pkey, updatedAt: now.toISOString() }
  expect(applyRemote(db, 8, edit)).toBe('applied')
  expect(row(r.uid)).toMatchObject({
    owner_id: 8,
    quantity: 4,
    dirty: 0,
    updated_at: now.toISOString()
  })
  expect(row(r.uid)!.printing_id).toBe(printing('SDY-006').id)
  expect(dirtyEntries(db, 8, 10)).toEqual([])
  // Owner 7 is active and sees nothing of owner 8's.
  expect(listEntries(db, ALL)).toEqual([])
})

test('an echo of a clean row is unchanged and writes nothing', () => {
  const r = wire({ quantity: 3, notes: 'binder 2' })
  expect(applyRemote(db, 7, r)).toBe('applied')
  const before = row(r.uid)
  expect(applyRemote(db, 7, { ...r })).toBe('unchanged')
  expect(row(r.uid)).toEqual(before)

  // A waiting copy of the same uid is no longer needed.
  db.prepare(
    "INSERT INTO sync_pending (owner_id, uid, pkey, entry, received_at) VALUES (7, ?, 'x', '{}', ?)"
  ).run(r.uid, t0)
  expect(applyRemote(db, 7, r)).toBe('unchanged')
  expect(pendingCount(db, 7)).toBe(0)

  // A different entry, or the same entry over a dirty row, is not an echo.
  expect(applyRemote(db, 7, { ...r, notes: 'binder 3' })).toBe('applied')
  db.prepare('UPDATE collection_entries SET dirty = 1 WHERE uid = ?').run(r.uid)
  expect(applyRemote(db, 7, { ...r, notes: 'binder 3' })).toBe('kept-local')
})

test('a newer local unpushed edit beats an older remote one', () => {
  const a = addAs(7, 'LOB-EN005', DM, later, 2)
  const [mine] = dirtyEntries(db, 7, 10)
  expect(applyRemote(db, 7, { ...mine, quantity: 9, updatedAt: now.toISOString() })).toBe(
    'kept-local'
  )
  expect(row(a)).toMatchObject({ quantity: 2, dirty: 1 })

  const newer = new Date(later.getTime() + 1000).toISOString()
  expect(applyRemote(db, 7, { ...mine, quantity: 9, updatedAt: newer })).toBe('applied')
  expect(row(a)).toMatchObject({ quantity: 9, dirty: 0, updated_at: newer })
})

test('a remote tombstone removes the local entry for good', () => {
  const a = addAs(7, 'LOB-EN005', DM, now, 2)
  const [mine] = dirtyEntries(db, 7, 10)
  const tomb = { ...mine, updatedAt: later.toISOString(), deletedAt: later.toISOString() }
  expect(applyRemote(db, 7, tomb)).toBe('applied')
  expect(row(a)).toMatchObject({ deleted_at: later.toISOString(), dirty: 0 })
  expect(listEntries(db, ALL)).toEqual([])
  expect(dirtyEntries(db, 7, 10)).toEqual([])
  // Re-applying the same tombstone is harmless.
  expect(applyRemote(db, 7, tomb)).toBe('unchanged')
  expect(row(a)!.deleted_at).toBe(later.toISOString())

  // A tombstone for a uid this computer never had writes nothing.
  const ghost = wire({ deletedAt: later.toISOString() })
  expect(applyRemote(db, 7, ghost)).toBe('ignored')
  expect(row(ghost.uid)).toBeUndefined()
})

test('a remote entry on a printing+art the owner already holds converges to the newer', () => {
  const other8 = addAs(8, 'LOB-EN005', DM, now)
  const before8 = row(other8)

  // Remote newer: the local row is tombstoned at the remote's edit time and stays dirty.
  const mine = addAs(7, 'LOB-EN005', DM, now)
  const remote = wire({ quantity: 3, updatedAt: later.toISOString() })
  expect(applyRemote(db, 7, remote)).toBe('applied')
  expect(row(mine)).toMatchObject({
    deleted_at: later.toISOString(),
    updated_at: later.toISOString(),
    dirty: 1
  })
  expect(row(remote.uid)).toMatchObject({ owner_id: 7, quantity: 3, deleted_at: null, dirty: 0 })
  expect(row(other8)).toEqual(before8)

  // Local newer: the remote loses and is not stored.
  const mine2 = addAs(7, 'LOB-EN119', POT, later)
  const loser = wire({
    pkey: printing('LOB-EN119').pkey,
    imageId: POT,
    updatedAt: now.toISOString()
  })
  expect(applyRemote(db, 7, loser)).toBe('ignored')
  expect(row(mine2)).toMatchObject({ deleted_at: null, dirty: 1 })
  expect(row(loser.uid)).toBeUndefined()
  expect(row(other8)).toEqual(before8)

  // A losing remote moving a uid this computer holds elsewhere tombstones that row at the remote's edit time.
  const moved = wire({ pkey: printing('SDY-006').pkey })
  expect(applyRemote(db, 7, moved)).toBe('applied')
  const move = {
    ...moved,
    pkey: printing('LOB-EN119').pkey,
    imageId: POT,
    updatedAt: now.toISOString()
  }
  expect(applyRemote(db, 7, move)).toBe('ignored')
  expect(row(moved.uid)).toMatchObject({
    deleted_at: now.toISOString(),
    updated_at: now.toISOString(),
    dirty: 0
  })
  expect(row(mine2)).toMatchObject({ deleted_at: null, dirty: 1 })
})

test('tombstoneClean deletes a uid without marking it dirty', () => {
  const a = addAs(7, 'LOB-EN005', DM)
  tombstoneClean(db, wireOf(a), later.toISOString())
  expect(row(a)).toMatchObject({
    deleted_at: later.toISOString(),
    updated_at: later.toISOString(),
    dirty: 0
  })
  // The winner a merged push reports then applies without a collision.
  const winner = wire({ quantity: 4, updatedAt: later.toISOString() })
  expect(applyRemote(db, 7, winner)).toBe('applied')
  expect(row(winner.uid)).toMatchObject({ quantity: 4, deleted_at: null, dirty: 0 })
})

test('a merged result does not tombstone an entry edited during the push', () => {
  const mid = new Date(now.getTime() + 30 * 60_000).toISOString()

  // Quantity edited during the push: the row stays live and dirty, and beats the older winner.
  const a = addAs(7, 'LOB-EN005', DM, now)
  const [pushed] = dirtyEntries(db, 7, 10)
  updateEntry(db, row(a)!.id, { quantity: 5 }, later)
  tombstoneClean(db, pushed, mid)
  expect(row(a)).toMatchObject({ quantity: 5, deleted_at: null, dirty: 1 })
  const winner = wire({ quantity: 2, updatedAt: mid })
  expect(applyRemote(db, 7, winner)).toBe('ignored')
  expect(row(a)).toMatchObject({ quantity: 5, deleted_at: null, dirty: 1 })
  expect(row(winner.uid)).toBeUndefined()

  // Moved to another printing during the push: the row stays live there, and the winner applies too.
  const b = addAs(7, 'LOB-EN119', POT, now)
  const [pushedB] = dirtyEntries(db, 7, 10, new Set([a]))
  updateEntry(db, row(b)!.id, { printingId: printing('SDY-006').id, imageId: DM }, later)
  tombstoneClean(db, pushedB, mid)
  expect(row(b)).toMatchObject({ printing_id: printing('SDY-006').id, deleted_at: null, dirty: 1 })
  const winnerB = wire({ pkey: printing('LOB-EN119').pkey, imageId: POT, updatedAt: mid })
  expect(applyRemote(db, 7, winnerB)).toBe('applied')
  expect(row(winnerB.uid)).toMatchObject({ deleted_at: null, dirty: 0 })
  expect(row(b)).toMatchObject({ deleted_at: null, dirty: 1 })
})

test('a remote tombstone on a printing this computer lacks still deletes the known uid', () => {
  const r = wire({ quantity: 2 })
  expect(applyRemote(db, 7, r)).toBe('applied')
  const tomb = {
    ...r,
    pkey: 'en|999|NEW-001|Rare',
    imageId: 999,
    updatedAt: later.toISOString(),
    deletedAt: later.toISOString()
  }
  expect(applyRemote(db, 7, tomb)).toBe('applied')
  expect(row(r.uid)).toMatchObject({
    deleted_at: later.toISOString(),
    printing_id: printing('LOB-EN005').id,
    image_id: DM,
    dirty: 0
  })
  expect(pendingCount(db, 7)).toBe(0)
})

test('a uid held by another owner is ignored', () => {
  const r = wire({ quantity: 2 })
  expect(applyRemote(db, 8, r)).toBe('applied')
  expect(applyRemote(db, 7, { ...r, quantity: 9, updatedAt: later.toISOString() })).toBe('ignored')
  expect(row(r.uid)).toMatchObject({ owner_id: 8, quantity: 2 })
})

test('an unknown printing waits in sync_pending and applies once the catalog has it', () => {
  const r = wire({
    pkey: 'en|999|NEW-001|Rare',
    imageId: 999,
    quantity: 2,
    updatedAt: now.toISOString()
  })
  expect(applyRemote(db, 7, r)).toBe('pending')
  expect(pendingCount(db, 7)).toBe(1)
  expect(pendingCount(db, 8)).toBe(0)
  // An older copy doesn't replace the waiting one.
  expect(applyRemote(db, 7, { ...r, quantity: 1, updatedAt: t0 })).toBe('pending')
  expect(applyPending(db)).toEqual({ applied: 0, remaining: 1 })
  expect(row(r.uid)).toBeUndefined()

  addNewPrinting()
  expect(applyPending(db)).toEqual({ applied: 1, remaining: 0 })
  expect(row(r.uid)).toMatchObject({ owner_id: 7, quantity: 2, dirty: 0 })
  expect(pendingCount(db, 7)).toBe(0)
})

test('a late pending replay does not roll back a newer clean row', () => {
  const v2 = wire({ quantity: 4, updatedAt: later.toISOString() })
  expect(applyRemote(db, 7, v2)).toBe('applied')
  // An older copy of the same uid, on a printing not yet in the catalog, arrives afterwards.
  const v1 = {
    ...v2,
    pkey: 'en|999|NEW-001|Rare',
    imageId: 999,
    quantity: 1,
    updatedAt: now.toISOString()
  }
  expect(applyRemote(db, 7, v1)).toBe('pending')
  addNewPrinting()
  expect(applyPending(db)).toEqual({ applied: 0, remaining: 0 })
  expect(row(v2.uid)).toMatchObject({
    quantity: 4,
    printing_id: printing('LOB-EN005').id,
    updated_at: later.toISOString(),
    dirty: 0
  })
})

test('adopting moves never-signed-in entries and snapshots to the first owner', () => {
  const a = addAs(0, 'LOB-EN005', DM)
  const b = addAs(0, 'LOB-EN119', POT)
  addAs(8, 'SDY-006', DM)
  cleanAll()
  db.prepare(
    'INSERT INTO value_snapshots (owner_id, date, total_value, total_cards) VALUES (0, ?, 1, 1)'
  ).run('2026-10-01')
  db.prepare(
    'INSERT INTO value_snapshots (owner_id, date, total_value, total_cards) VALUES (0, ?, 2, 2)'
  ).run('2026-10-02')
  db.prepare(
    'INSERT INTO value_snapshots (owner_id, date, total_value, total_cards) VALUES (7, ?, 9, 9)'
  ).run('2026-10-02')

  expect(adoptLocalData(db, 7)).toBe(2)
  expect(row(a)).toMatchObject({ owner_id: 7, dirty: 1 })
  expect(row(b)).toMatchObject({ owner_id: 7, dirty: 1 })
  expect(
    db
      .prepare('SELECT COUNT(*) AS n FROM collection_entries WHERE owner_id = 8 AND dirty = 0')
      .get()
  ).toEqual({
    n: 1
  })
  expect(
    db
      .prepare('SELECT owner_id, date, total_cards FROM value_snapshots ORDER BY owner_id, date')
      .all()
  ).toEqual([
    { owner_id: 7, date: '2026-10-01', total_cards: 1 },
    { owner_id: 7, date: '2026-10-02', total_cards: 9 }
  ])
  expect(adoptLocalData(db, 7)).toBe(0)
})

test('purge removes only that owner’s clean tombstones', () => {
  const cleanTomb = addAs(7, 'LOB-EN005', DM)
  const dirtyTomb = addAs(7, 'LOB-EN119', POT)
  const live = addAs(7, 'SDY-006', DM)
  const other = addAs(8, 'LOB-EN005', DM)
  cleanAll()
  tombstoneClean(db, wireOf(cleanTomb), later.toISOString())
  tombstoneClean(db, wireOf(other), later.toISOString())
  db.prepare('UPDATE collection_entries SET deleted_at = ?, dirty = 1 WHERE uid = ?').run(
    later.toISOString(),
    dirtyTomb
  )

  expect(purgeCleanTombstones(db, 7)).toBe(1)
  expect(row(cleanTomb)).toBeUndefined()
  expect(row(dirtyTomb)).toBeDefined()
  expect(row(live)).toBeDefined()
  expect(row(other)).toBeDefined()
})

test('rekey gives a uid a fresh one and leaves it dirty; dropEntry deletes the row', () => {
  const a = addAs(7, 'LOB-EN005', DM)
  cleanAll()
  const fresh = rekey(db, a)
  expect(fresh).not.toBe(a)
  expect(row(a)).toBeUndefined()
  expect(row(fresh)).toMatchObject({ owner_id: 7, dirty: 1 })
  dropEntry(db, fresh)
  expect(row(fresh)).toBeUndefined()
})

test('fresher server prices replace older local ones only', () => {
  addAs(7, 'LOB-EN005', DM)
  addAs(7, 'LOB-EN119', POT)
  const a = printing('LOB-EN005')
  const b = printing('LOB-EN119')
  expect(stalePricePkeys(db, now, 10).sort()).toEqual([a.pkey, b.pkey].sort())
  expect(stalePricePkeys(db, now, 1)).toHaveLength(1)

  db.prepare(
    'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 5, 3, ?)'
  ).run(a.id, now.toISOString())
  const n = applyPrices(db, [
    { pkey: a.pkey, price: 1, listingCount: 1, checkedAt: t0 },
    { pkey: b.pkey, price: 2, listingCount: 4, checkedAt: now.toISOString() },
    { pkey: 'en|999|NEW-001|Rare', price: 3, listingCount: 1, checkedAt: now.toISOString() }
  ])
  expect(n).toBe(1)
  const price = (id: number): unknown =>
    db
      .prepare('SELECT price, listing_count, checked_at FROM intl_prices WHERE printing_id = ?')
      .get(id)
  expect(price(a.id)).toEqual({ price: 5, listing_count: 3, checked_at: now.toISOString() })
  expect(price(b.id)).toEqual({ price: 2, listing_count: 4, checked_at: now.toISOString() })

  expect(
    applyPrices(db, [
      { pkey: a.pkey, price: null, listingCount: 0, checkedAt: later.toISOString() }
    ])
  ).toBe(1)
  // A server miss stamps the check but never erases the local price.
  expect(price(a.id)).toEqual({ price: 5, listing_count: 3, checked_at: later.toISOString() })
})
