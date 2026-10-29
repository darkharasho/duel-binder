import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { DATA_CHANNELS, createDataHandlers } from '../../src/main/ipc/dataHandlers'
import { createAccountService, type AccountService } from '../../src/main/cloud/account'
import type { CloudClient } from '../../src/main/cloud/client'
import { TokenStore, type Cipher } from '../../src/main/cloud/tokenStore'
import type { CatalogService } from '../../src/main/catalog/service'
import { getMeta, setMeta } from '../../src/main/db/meta'
import type { Me } from '../../src/shared/cloud'
import type { GameId } from '../../src/shared/games'
import type { EntryView } from '../../src/shared/types'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from './helpers'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function make(availableGames: () => GameId[] = () => ['ygo']) {
  const db = await seededDb()
  const onEdit = vi.fn()
  const onGameChanged = vi.fn()
  return {
    db,
    onEdit,
    onGameChanged,
    handlers: createDataHandlers({ db, onEdit, availableGames, onGameChanged })
  }
}

const OWNER: Me = {
  id: 1,
  username: 'owner',
  displayName: null,
  avatarUrl: null,
  games: ['ygo', 'pkm']
}
const FRIEND: Me = { id: 2, username: 'friend', displayName: null, avatarUrl: null }
const ALL = { sort: 'name', dir: 'asc' } as const
const NOW = '2026-10-29T12:00:00.000Z'

const fakeCipher: Cipher = {
  encrypt: (plain) => Buffer.from(plain, 'utf8'),
  decrypt: (buf) => buf.toString('utf8')
}

/** A synced entry of `owner` in `game`, written straight to the table. */
function entry(db: Database.Database, owner: number, game: GameId): void {
  const p = db
    .prepare(
      `SELECT p.id, (SELECT image_id FROM card_images WHERE card_id = p.card_id LIMIT 1) AS imageId
       FROM card_printings p WHERE p.game = ? AND p.id NOT IN (SELECT printing_id FROM collection_entries)
       ORDER BY p.id LIMIT 1`
    )
    .get(game) as { id: number; imageId: number }
  db.prepare(
    `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, created_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)`
  ).run(crypto.randomUUID(), owner, game, p.id, p.imageId, NOW, NOW)
}

const games = (rows: unknown, db: Database.Database): string[] =>
  (rows as EntryView[]).map(
    (e) =>
      (db.prepare('SELECT game FROM collection_entries WHERE id = ?').get(e.id) as { game: string })
        .game
  )

const dirs: string[] = []
const services: AccountService[] = []
afterEach(() => {
  for (const s of services.splice(0)) s.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/**
 * The desktop's data handlers over a real account service: sign-in hands over `signInAs`, and the
 * portal is a fake whose `me()` answers `meGames` for the signed-in user.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function withAccount(opts: { storedGame?: GameId } = {}) {
  const db = await seededDb()
  if (opts.storedGame) setMeta(db, 'active_game', opts.storedGame)
  seedPokemon(db)
  for (const owner of [OWNER.id, FRIEND.id]) {
    entry(db, owner, 'ygo')
    entry(db, owner, 'pkm')
  }
  const dir = mkdtempSync(join(tmpdir(), 'duel-binder-games-'))
  dirs.push(dir)
  const state = {
    online: false,
    signInAs: OWNER,
    meGames: OWNER.games as GameId[] | undefined
  }
  const client = {
    me: async (): Promise<Me> => {
      const user: Me = { ...state.signInAs }
      delete user.games
      return state.meGames ? { ...user, games: state.meGames } : user
    },
    push: async () => [],
    pull: async (cursor: number) => ({ entries: [], cursor, more: false }),
    priceChanges: async (since: number) => ({ prices: [], cursor: since, more: false }),
    prices: async () => ({ prices: [], status: null }),
    revoke: async () => {},
    rpc: vi.fn(async () => null)
  } as unknown as CloudClient
  const catalog = {
    status: () => ({ state: 'idle' }),
    update: async () => ({ changed: false, imagesChanged: false })
  } as unknown as CatalogService
  const emitDataChanged = vi.fn()
  const account = createAccountService({
    db,
    tokens: new TokenStore(join(dir, 'account.json'), fakeCipher),
    client: () => client,
    signIn: async () => ({ token: `token-${state.signInAs.id}`, user: state.signInAs }),
    emit: () => {},
    emitDataChanged,
    isOnline: () => state.online,
    catalog,
    onCatalogChanged: () => {}
  })
  services.push(account)
  const handlers = createDataHandlers({
    db,
    onEdit: () => {},
    availableGames: () => account.games(),
    onGameChanged: emitDataChanged
  })
  return { db, state, account, handlers, emitDataChanged, client }
}

describe('data handlers', () => {
  it('covers exactly DATA_CHANNELS', async () => {
    const { handlers } = await make()
    expect(Object.keys(handlers).sort()).toEqual([...DATA_CHANNELS].sort())
  })

  it('every data channel is an INVOKE_CHANNELS member', () => {
    for (const c of DATA_CHANNELS) expect(INVOKE_CHANNELS).toContain(c)
  })

  it('collection:add calls onEdit once and records a snapshot', async () => {
    const { db, onEdit, handlers } = await make()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    await handlers['collection:add']({ ...printing, quantity: 2 })
    expect(onEdit).toHaveBeenCalledTimes(1)
    const rows = db.prepare('SELECT total_cards AS n FROM value_snapshots').all()
    expect(rows).toEqual([{ n: 2 }])
  })

  it('scan:cardsForImages rejects non-integer ids', async () => {
    const { handlers } = await make()
    await expect(handlers['scan:cardsForImages']([1, 'x'])).rejects.toThrow('list of integers')
  })

  it('games:setActive rejects a game the account may not use, and anything not a game', async () => {
    const { db, handlers, onGameChanged } = await make()
    await expect(handlers['games:setActive']('pkm')).rejects.toThrow("isn't available")
    await expect(handlers['games:setActive']('mtg')).rejects.toThrow("isn't available")
    expect(getMeta(db, 'active_game')).toBeNull()
    expect(onGameChanged).not.toHaveBeenCalled()
    await expect(handlers['games:active']()).resolves.toBe('ygo')
  })

  it('games:setActive stores an available game and reloads the pages only on a change', async () => {
    const { db, handlers, onGameChanged } = await make(() => ['ygo', 'pkm'])
    await handlers['games:setActive']('pkm')
    expect(getMeta(db, 'active_game')).toBe('pkm')
    await expect(handlers['games:active']()).resolves.toBe('pkm')
    expect(onGameChanged).toHaveBeenCalledTimes(1)
    await handlers['games:setActive']('pkm')
    expect(onGameChanged).toHaveBeenCalledTimes(1)
  })

  it('games:active writes ygo back over a stored game that is not available', async () => {
    const { db, handlers } = await make()
    db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
    await expect(handlers['games:active']()).resolves.toBe('ygo')
    expect(getMeta(db, 'active_game')).toBe('ygo')
    db.prepare("UPDATE meta SET value = 'nonsense' WHERE key = 'active_game'").run()
    await expect(handlers['games:active']()).resolves.toBe('ygo')
    expect(getMeta(db, 'active_game')).toBe('ygo')
  })

  it('signed out, only Yu-Gi-Oh! is available', async () => {
    const { handlers } = await withAccount()
    await expect(handlers['games:available']()).resolves.toEqual(['ygo'])
    await expect(handlers['games:setActive']('pkm')).rejects.toThrow("isn't available")
  })

  it('the owner can switch to Pokémon, and the collection then shows only Pokémon', async () => {
    const { db, account, handlers, emitDataChanged } = await withAccount()
    await account.signIn()
    await expect(handlers['games:available']()).resolves.toEqual(['ygo', 'pkm'])
    expect(games(await handlers['collection:list'](ALL), db)).toEqual(['ygo'])
    emitDataChanged.mockClear()
    await handlers['games:setActive']('pkm')
    expect(emitDataChanged).toHaveBeenCalledTimes(1)
    await expect(handlers['games:active']()).resolves.toBe('pkm')
    expect(games(await handlers['collection:list'](ALL), db)).toEqual(['pkm'])
  })

  it('signing out, then in as an account without Pokémon, shows Yu-Gi-Oh! with no Pokémon rows', async () => {
    const { db, state, account, handlers } = await withAccount()
    await account.signIn()
    await handlers['games:setActive']('pkm')
    await account.signOut()
    // Before anything asks games:active: the SQL reads must already be back on Yu-Gi-Oh!.
    expect(getMeta(db, 'active_game')).toBe('ygo')
    state.signInAs = FRIEND
    await account.signIn()
    expect(account.status().user?.id).toBe(FRIEND.id)
    expect(games(await handlers['collection:list'](ALL), db)).toEqual(['ygo'])
    await expect(handlers['games:active']()).resolves.toBe('ygo')
    await expect(handlers['games:available']()).resolves.toEqual(['ygo'])
  })

  it('starting signed out with Pokémon stored shows Yu-Gi-Oh! before any read', async () => {
    const { db } = await withAccount({ storedGame: 'pkm' })
    expect(getMeta(db, 'active_game')).toBe('ygo')
  })

  it('signing in as an account without the stored game falls back to Yu-Gi-Oh!', async () => {
    const { db, state, account, handlers, emitDataChanged } = await withAccount()
    // Left over from an account signed in before, with no sign-out on this device (a wiped token file).
    db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
    state.signInAs = FRIEND
    await account.signIn()
    expect(getMeta(db, 'active_game')).toBe('ygo')
    expect(emitDataChanged).toHaveBeenCalled()
    expect(games(await handlers['collection:list'](ALL), db)).toEqual(['ygo'])
  })

  it('a refreshed me() that drops the shown game switches back to Yu-Gi-Oh!', async () => {
    const { db, state, account, handlers, emitDataChanged } = await withAccount()
    await account.signIn()
    await handlers['games:setActive']('pkm')
    emitDataChanged.mockClear()
    state.online = true
    state.meGames = ['ygo']
    await account.syncNow()
    expect(account.status().state).toBe('idle')
    expect(getMeta(db, 'active_game')).toBe('ygo')
    expect(emitDataChanged).toHaveBeenCalled()
    await expect(handlers['games:available']()).resolves.toEqual(['ygo'])
    expect(games(await handlers['collection:list'](ALL), db)).toEqual(['ygo'])
    // Kept for offline use: the cached account has the refreshed games.
    expect(JSON.parse(getMeta(db, 'cloud_user') ?? '{}').games).toEqual(['ygo'])
  })

  it('a refreshed me() that adds a game makes it available without a sign-in', async () => {
    const { state, account, handlers } = await withAccount()
    state.signInAs = { ...OWNER, games: undefined }
    state.meGames = undefined
    await account.signIn()
    await expect(handlers['games:available']()).resolves.toEqual(['ygo'])
    state.online = true
    state.meGames = ['ygo', 'pkm']
    await account.syncNow()
    await expect(handlers['games:available']()).resolves.toEqual(['ygo', 'pkm'])
    await expect(handlers['games:setActive']('pkm')).resolves.toBeUndefined()
  })

  it('portal calls name the shown game', async () => {
    const { account, handlers, client } = await withAccount()
    await account.signIn()
    await account.portal('friends:overview', [])
    await handlers['games:setActive']('pkm')
    await account.portal('friends:overview', [])
    expect(vi.mocked(client.rpc).mock.calls.map((c) => c[2])).toEqual(['ygo', 'pkm'])
  })
})
