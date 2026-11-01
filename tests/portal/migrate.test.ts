import Database from 'better-sqlite3'
import { MIGRATIONS } from '../../src/main/db/schema'
import { migrateServer, runSteps, SERVER_STEPS } from '../../workers/portal/src/migrate'
import { catalogChanges } from '../../workers/portal/src/catalogFeed'
import { userScope } from '../../workers/portal/src/scope'
import { getChecklist } from '../../src/main/repo/sets'
import { SHARED_SET_NAME, seedPokemon } from '../fixtures/pokemon'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

const tableNames = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as { name: string }[]).map((r) => r.name)

describe('migrateServer', () => {
  it('creates the server schema and records every step', () => {
    const db = freshDb()
    migrateServer(db)
    const names = tableNames(db)
    for (const t of ['users', 'sessions', 'collection_entries', 'cards_fts']) expect(names).toContain(t)
    const cols = (db.prepare('PRAGMA table_info(collection_entries)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['user_id', 'uid', 'deleted_at']))
    const done = (db.prepare('SELECT name FROM server_migrations').all() as { name: string }[]).map((r) => r.name)
    for (let v = 1; v <= 10; v++) expect(done).toContain(`desktop-${v}`)
    expect(done).toContain('server-1')
    db.close()
  })

  it('is a no-op when run again', () => {
    const db = freshDb()
    migrateServer(db)
    const count = () => (db.prepare('SELECT count(*) AS n FROM server_migrations').get() as { n: number }).n
    const before = count()
    expect(() => migrateServer(db)).not.toThrow()
    expect(count()).toBe(before)
    db.close()
  })

  it('a desktop step marked server: false is skipped', () => {
    const db = freshDb()
    db.exec('CREATE TABLE server_migrations (name TEXT PRIMARY KEY)')
    runSteps(db, [{ version: 99, sql: 'CREATE TABLE nope(x)', server: false }])
    expect(tableNames(db)).not.toContain('nope')
    expect(db.prepare("SELECT name FROM server_migrations WHERE name = 'desktop-99'").get()).toBeTruthy()
    db.close()
  })

  it('a desktop step with foreignKeysOff and no server override is refused', () => {
    const db = freshDb()
    expect(() => runSteps(db, [{ version: 99, sql: 'CREATE TABLE nope(x)', foreignKeysOff: true }])).toThrow(
      /desktop-99.*foreignKeysOff/
    )
    expect(tableNames(db)).not.toContain('nope')
    runSteps(db, [{ version: 99, sql: 'CREATE TABLE nope(x)', foreignKeysOff: true, server: 'CREATE TABLE yes(x)' }])
    expect(tableNames(db)).toContain('yes')
    db.close()
  })

  it('desktop-12 is skipped and server-2 numbers entries', () => {
    const db = freshDb()
    runSteps(db, [...MIGRATIONS.slice(0, 11), SERVER_STEPS[0]])
    db.exec(`
      INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd1', 'one', 'x', 'x');
      INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
        VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', 'x');
      INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity) VALUES
        (7, 1, 'LOB', 'LOB-EN005', 'Ultra Rare'), (8, 1, 'SDY', 'SDY-006', 'Ultra Rare');
      INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0);
      INSERT INTO collection_entries (id, user_id, uid, printing_id, image_id, quantity, created_at, updated_at) VALUES
        (4, 1, 'a', 7, 1, 1, 'x', 'x'), (6, 1, 'b', 8, 1, 2, 'x', 'x');
    `)
    migrateServer(db)
    const done = (db.prepare('SELECT name FROM server_migrations').all() as { name: string }[]).map((r) => r.name)
    expect(done).toEqual(expect.arrayContaining(['desktop-12', 'server-2']))
    expect(db.prepare('SELECT id, server_seq FROM collection_entries ORDER BY id').all()).toEqual([
      { id: 4, server_seq: 4 },
      { id: 6, server_seq: 6 }
    ])
    const cols = (db.prepare('PRAGMA table_info(collection_entries)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).not.toContain('owner_id')
    expect(cols).not.toContain('dirty')
    expect(tableNames(db)).toContain('desktop_codes')
    expect(tableNames(db)).not.toContain('sync_pending')
    expect(tableNames(db)).not.toContain('cloud_accounts')
    db.close()
  })

  it('upgraded and fresh servers end with the same schema', () => {
    const schema = (db: Database.Database): unknown[] =>
      db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    const upgraded = freshDb()
    runSteps(upgraded, [...MIGRATIONS.slice(0, 11), SERVER_STEPS[0]])
    migrateServer(upgraded)
    const fresh = freshDb()
    migrateServer(fresh)
    expect(schema(upgraded)).toEqual(schema(fresh))
    upgraded.close()
    fresh.close()
  })

  it('late desktop steps touching collection data have a server override', () => {
    const late = MIGRATIONS.filter((m) => m.version >= 12 && /collection_entries|value_snapshots/.test(m.sql))
    expect(late.length).toBeGreaterThan(0)
    for (const m of late) expect(m.server, `desktop-${m.version}`).not.toBeUndefined()
  })

  it('server-11 backfills price_seq', () => {
    const db = freshDb()
    runSteps(db, [...MIGRATIONS, ...SERVER_STEPS].filter((s) => !('name' in s && s.name === 'server-11')))
    db.exec(`INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (1, 'C', 'M', 'n', 'W', '', '')`)
    for (let i = 1; i <= 3; i++) {
      db.exec(`INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity, language) VALUES (${i}, 1, 'S', 'X-JP00${i}', 'Common', 'ja')`)
      db.exec(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (${i}, ${i}, 2, 't')`)
    }
    migrateServer(db)
    const seqs = (db.prepare('SELECT price_seq AS s FROM intl_prices ORDER BY printing_id').all() as { s: number }[]).map((r) => r.s)
    expect(new Set(seqs).size).toBe(3)
    expect(seqs.every((s) => s > 0)).toBe(true)
    const clock = (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
    expect(clock).toBeGreaterThanOrEqual(Math.max(...seqs))
    db.close()
  })
})

/** A server as deployed before server-12, holding a few Yu-Gi-Oh! rows of every kind. */
function serverBefore12(): Database.Database {
  const db = freshDb()
  runSteps(db, [
    ...MIGRATIONS.filter((m) => m.version <= 18),
    ...SERVER_STEPS.filter((s) => !['server-12', 'server-13', 'server-14', 'server-16', 'server-18'].includes(s.name))
  ])
  db.exec(`
    INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd1', 'one', 'x', 'x');
    INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES
      (46986414, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', 'x');
    INSERT INTO card_images (image_id, card_id, sort_order) VALUES (46986414, 46986414, 0);
    INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity, language) VALUES
      (7, 46986414, '${SHARED_SET_NAME}', 'LOB-EN005', 'Ultra Rare', 'en'),
      (8, 46986414, 'Vol.1', '', 'Ultra Rare', 'ja');
    INSERT INTO sets (language, set_name, set_code, list_rows) VALUES
      ('en', '${SHARED_SET_NAME}', 'LOB', NULL), ('ja', 'Vol.1', '', 40);
    INSERT INTO collection_entries (id, user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
      VALUES (4, 1, 'a', 7, 46986414, 1, 'x', 'x', 4);
    INSERT INTO value_snapshots (user_id, date, total_value, total_cards) VALUES (1, '2026-10-22', 5, 1), (1, '2026-10-23', 6, 1);
  `)
  return db
}

const rows = (db: Database.Database, sql: string): unknown[] => db.prepare(sql).all()
const clockOf = (db: Database.Database): number =>
  (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
const pkOf = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name)

describe('server-12 (game columns)', () => {
  it('marks every existing row Yu-Gi-Oh! without stamping or tombstoning anything', () => {
    const db = serverBefore12()
    const pkeys = rows(db, 'SELECT pkey FROM card_printings ORDER BY id')
    const sets = rows(db, 'SELECT language, set_name, catalog_seq FROM sets ORDER BY rowid')
    const snapshots = rows(db, 'SELECT user_id, date, total_value FROM value_snapshots ORDER BY date')
    const clock = clockOf(db)

    migrateServer(db)

    for (const t of ['cards', 'card_images', 'card_printings', 'sets', 'collection_entries', 'value_snapshots']) {
      expect(rows(db, `SELECT DISTINCT game FROM ${t}`), t).toEqual([{ game: 'ygo' }])
    }
    expect(rows(db, 'SELECT pkey FROM card_printings ORDER BY id')).toEqual(pkeys)
    expect(rows(db, 'SELECT language, set_name, catalog_seq FROM sets ORDER BY rowid')).toEqual(sets)
    expect(rows(db, 'SELECT user_id, date, total_value FROM value_snapshots ORDER BY date')).toEqual(snapshots)
    expect(pkOf(db, 'sets')).toEqual(['game', 'language', 'set_name'])
    expect(pkOf(db, 'value_snapshots')).toEqual(['user_id', 'game', 'date'])
    expect(clockOf(db)).toBe(clock)
    expect(rows(db, 'SELECT * FROM catalog_tombstones')).toEqual([])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    const indexes = (rows(db, "SELECT name FROM sqlite_master WHERE type = 'index'") as { name: string }[]).map(
      (r) => r.name
    )
    for (const t of ['cards', 'card_images', 'card_printings', 'sets']) expect(indexes).toContain(`ix_${t}_game_seq`)
    expect(indexes).toEqual(expect.arrayContaining(['ix_sets_catalog_seq', 'ix_pokemon_cards_catalog_seq']))
    expect(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cloud_game_cursors'")).toEqual([])
    db.close()
  })

  it('takes Pokémon rows next to a same-named Yu-Gi-Oh! set, each stamped with a new seq', () => {
    const db = serverBefore12()
    migrateServer(db)
    const clock = clockOf(db)
    const { cardIds } = seedPokemon(db)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(
      db.prepare("SELECT game FROM sets WHERE language = 'en' AND set_name = ? ORDER BY game").all(SHARED_SET_NAME)
    ).toEqual([{ game: 'pkm' }, { game: 'ygo' }])
    // 2 cards, 2 images, 2 pokemon_cards rows, 2 sets and 4 printings
    expect(clockOf(db)).toBe(clock + 12)
    const seq = db.prepare('SELECT catalog_seq AS s FROM pokemon_cards WHERE card_id = ?').get(cardIds[0]) as { s: number }
    expect(seq.s).toBeGreaterThan(clock)
    db.close()
  })

  it("serves a Pokémon checklist with each card's hp from the migrated schema", () => {
    const db = freshDb()
    migrateServer(db)
    seedPokemon(db)
    const cols = (db.prepare('PRAGMA table_info(pokemon_cards)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('hp')
    const list = getChecklist(db, SHARED_SET_NAME, 'en', userScope(1, 'pkm'))
    expect(list?.cards.length).toBeGreaterThan(0)
    const stored = db.prepare('SELECT hp FROM pokemon_cards WHERE card_id = ?')
    for (const c of list!.cards) expect(c.hp).toBe((stored.get(c.cardId) as { hp: number | null }).hp)
    db.close()
  })

  it('tombstones record the game, and a set by its three-part key', () => {
    const db = serverBefore12()
    migrateServer(db)
    const { cardIds } = seedPokemon(db)
    db.prepare("DELETE FROM sets WHERE game = 'pkm' AND language = 'en' AND set_name = ?").run(SHARED_SET_NAME)
    db.prepare('DELETE FROM pokemon_cards WHERE card_id = ?').run(cardIds[0])
    db.prepare("DELETE FROM sets WHERE game = 'ygo' AND language = 'ja'").run()
    expect(rows(db, 'SELECT tbl, game, key FROM catalog_tombstones ORDER BY seq')).toEqual([
      { tbl: 'sets', game: 'pkm', key: JSON.stringify(['pkm', 'en', SHARED_SET_NAME]) },
      { tbl: 'pokemon_cards', game: 'pkm', key: JSON.stringify([cardIds[0]]) },
      { tbl: 'sets', game: 'ygo', key: JSON.stringify(['ygo', 'ja', 'Vol.1']) }
    ])
    expect(rows(db, "SELECT set_name FROM sets WHERE language = 'en'")).toEqual([{ set_name: SHARED_SET_NAME }])
    db.close()
  })

  it('a changed key tombstones the old key with its game', () => {
    const db = serverBefore12()
    migrateServer(db)
    const { printingIds } = seedPokemon(db)
    const { pkey } = db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(printingIds[0]) as { pkey: string }
    db.prepare("UPDATE card_printings SET set_code = 'PAL 046/193' WHERE id = ?").run(printingIds[0])
    db.prepare("UPDATE sets SET set_name = 'Renamed' WHERE game = 'pkm' AND language = 'ja'").run()
    expect(rows(db, 'SELECT tbl, game, key FROM catalog_tombstones ORDER BY seq')).toEqual([
      { tbl: 'card_printings', game: 'pkm', key: JSON.stringify([pkey]) },
      { tbl: 'sets', game: 'pkm', key: JSON.stringify(['pkm', 'ja', 'クレイバースト']) }
    ])
    db.close()
  })
})

describe('server-13 (pokemon_cards image_url and local_name)', () => {
  const cols = (db: Database.Database): string[] =>
    (db.prepare('PRAGMA table_info(pokemon_cards)').all() as { name: string }[]).map((c) => c.name)

  it('a fresh server and one upgraded from server-12 both end with both columns', () => {
    const fresh = freshDb()
    migrateServer(fresh)
    const old = freshDb()
    runSteps(old, [...MIGRATIONS, ...SERVER_STEPS.filter((s) => !['server-13', 'server-16', 'server-18'].includes(s.name))])
    expect(cols(old)).not.toContain('image_url')
    seedPokemon(old)
    migrateServer(old)
    for (const db of [fresh, old]) expect(cols(db)).toEqual(expect.arrayContaining(['image_url', 'local_name']))
    expect(rows(old, 'SELECT image_url, local_name FROM pokemon_cards')).toEqual([
      { image_url: null, local_name: null },
      { image_url: null, local_name: null }
    ])
    fresh.close()
    old.close()
  })

  it('a change to image_url alone raises the row catalog_seq', () => {
    const db = freshDb()
    migrateServer(db)
    const { cardIds } = seedPokemon(db)
    const seqOf = (): number =>
      (db.prepare('SELECT catalog_seq AS s FROM pokemon_cards WHERE card_id = ?').get(cardIds[0]) as { s: number }).s
    const before = seqOf()
    db.prepare("UPDATE pokemon_cards SET image_url = 'x' WHERE card_id = ?").run(cardIds[0])
    const mid = seqOf()
    expect(mid).toBeGreaterThan(before)
    db.prepare("UPDATE pokemon_cards SET local_name = 'y' WHERE card_id = ?").run(cardIds[0])
    expect(seqOf()).toBeGreaterThan(mid)
    db.close()
  })

  it('deleting a row writes a tombstone for game pkm', () => {
    const db = freshDb()
    migrateServer(db)
    const { cardIds } = seedPokemon(db)
    db.prepare('DELETE FROM pokemon_cards WHERE card_id = ?').run(cardIds[0])
    expect(rows(db, 'SELECT tbl, game, key FROM catalog_tombstones')).toEqual([
      { tbl: 'pokemon_cards', game: 'pkm', key: JSON.stringify([cardIds[0]]) }
    ])
    db.close()
  })
})

describe('server-16 (pokemon_cards art_twin_id)', () => {
  const cols = (db: Database.Database): string[] =>
    (db.prepare('PRAGMA table_info(pokemon_cards)').all() as { name: string }[]).map((c) => c.name)

  it('a fresh server and an upgraded one both have the column, and old rows keep null', () => {
    const fresh = freshDb()
    migrateServer(fresh)
    const old = freshDb()
    runSteps(old, [...MIGRATIONS, ...SERVER_STEPS.filter((s) => !['server-16', 'server-18'].includes(s.name))])
    expect(cols(old)).not.toContain('art_twin_id')
    seedPokemon(old)
    migrateServer(old)
    for (const db of [fresh, old]) expect(cols(db)).toContain('art_twin_id')
    expect(rows(old, 'SELECT DISTINCT art_twin_id FROM pokemon_cards')).toEqual([{ art_twin_id: null }])
    fresh.close()
    old.close()
  })

  it('a change to art_twin_id alone raises the row catalog_seq', () => {
    const db = freshDb()
    migrateServer(db)
    const { cardIds } = seedPokemon(db)
    const seqOf = (): number =>
      (db.prepare('SELECT catalog_seq AS s FROM pokemon_cards WHERE card_id = ?').get(cardIds[0]) as { s: number }).s
    const before = seqOf()
    db.prepare('UPDATE pokemon_cards SET art_twin_id = ? WHERE card_id = ?').run(cardIds[1], cardIds[0])
    expect(seqOf()).toBeGreaterThan(before)
    db.close()
  })
})

describe('server-18 (pokemon_cards traditional_twin_id)', () => {
  const cols = (db: Database.Database): string[] =>
    (db.prepare('PRAGMA table_info(pokemon_cards)').all() as { name: string }[]).map((c) => c.name)

  it('a fresh server and an upgraded one both have the column, and old rows keep null', () => {
    const fresh = freshDb()
    migrateServer(fresh)
    const old = freshDb()
    runSteps(old, [...MIGRATIONS, ...SERVER_STEPS.filter((s) => s.name !== 'server-18')])
    expect(cols(old)).not.toContain('traditional_twin_id')
    seedPokemon(old)
    migrateServer(old)
    for (const db of [fresh, old]) expect(cols(db)).toContain('traditional_twin_id')
    expect(rows(old, 'SELECT DISTINCT traditional_twin_id FROM pokemon_cards')).toEqual([
      { traditional_twin_id: null }
    ])
    fresh.close()
    old.close()
  })

  it('a change to either link alone raises the row catalog_seq', () => {
    const db = freshDb()
    migrateServer(db)
    const { cardIds } = seedPokemon(db)
    const seqOf = (): number =>
      (db.prepare('SELECT catalog_seq AS s FROM pokemon_cards WHERE card_id = ?').get(cardIds[0]) as { s: number }).s
    const first = seqOf()
    db.prepare('UPDATE pokemon_cards SET traditional_twin_id = ? WHERE card_id = ?').run(cardIds[1], cardIds[0])
    const second = seqOf()
    expect(second).toBeGreaterThan(first)
    db.prepare('UPDATE pokemon_cards SET art_twin_id = ? WHERE card_id = ?').run(cardIds[1], cardIds[0])
    expect(seqOf()).toBeGreaterThan(second)
    db.close()
  })
})

describe('server-14 (pokemon_set_art in the change feed)', () => {
  const art = (db: Database.Database, order: number, key: string): void => {
    db.prepare(
      "INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES ('en', 'Paldea Evolved', 'pack', ?, ?, ?)"
    ).run(order, `https://archives.bulbagarden.net/media/upload/${key}.png`, key)
  }

  it('a fresh server and one upgraded from server-13 both feed new rows to Pokémon only', () => {
    const fresh = freshDb()
    migrateServer(fresh)
    const old = freshDb()
    runSteps(old, [
      ...MIGRATIONS.filter((m) => m.version <= 22),
      ...SERVER_STEPS.filter((s) => s.name !== 'server-14')
    ])
    migrateServer(old)
    for (const db of [fresh, old]) {
      art(db, 0, 'bp-a')
      art(db, 1, 'bp-b')
      const pkm = catalogChanges(db, 0, 100, undefined, 'pkm').changes.filter(
        (c) => c.table === 'pokemon_set_art'
      )
      expect(pkm.map((c) => 'row' in c && c.row.image_key)).toEqual(['bp-a', 'bp-b'])
      const ygo = catalogChanges(db, 0, 100, undefined, 'ygo').changes
      expect(ygo.some((c) => c.table === 'pokemon_set_art')).toBe(false)
      const legacy = catalogChanges(db, 0, 100).changes
      expect(legacy.some((c) => c.table === 'pokemon_set_art')).toBe(false)
    }
    fresh.close()
    old.close()
  })

  it('a change bumps catalog_seq and a delete tombstones the full key for game pkm', () => {
    const db = freshDb()
    migrateServer(db)
    art(db, 0, 'bp-a')
    const seq = (): number =>
      (db.prepare('SELECT catalog_seq AS s FROM pokemon_set_art').get() as { s: number }).s
    const before = seq()
    db.prepare("UPDATE pokemon_set_art SET image_key = 'bp-c'").run()
    expect(seq()).toBeGreaterThan(before)
    const since = seq()
    db.prepare('DELETE FROM pokemon_set_art').run()
    const key = ['en', 'Paldea Evolved', 'pack', 0]
    expect(rows(db, 'SELECT tbl, game, key FROM catalog_tombstones')).toEqual([
      { tbl: 'pokemon_set_art', game: 'pkm', key: JSON.stringify(key) }
    ])
    expect(catalogChanges(db, since, 100, ['pokemon_set_art'], 'pkm').changes).toEqual([
      expect.objectContaining({ table: 'pokemon_set_art', deleted: key })
    ])
    db.close()
  })
})
