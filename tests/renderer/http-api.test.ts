import { describe, expect, it, vi, type Mock } from 'vitest'
import { GAME_KEY, createHttpApi } from '../../src/renderer/src/web/httpApi'
import { INVOKE_CHANNELS, type Api } from '../../src/shared/ipc'
import { PORTAL_CHANNELS } from '../../src/shared/portal'

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const items = new Map<string, string>()
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v)
  }
}

const setup = (res: Response | Error, storage = memoryStorage()) => {
  const fetch = vi.fn(async () => {
    if (res instanceof Error) throw res
    return res
  })
  const onSignedOut = vi.fn()
  const api = createHttpApi({
    fetch: fetch as unknown as typeof globalThis.fetch,
    onSignedOut,
    storage
  })
  return { api, fetch, onSignedOut }
}

const OWNER_ME = {
  id: 1,
  username: 'owner',
  displayName: null,
  avatarUrl: null,
  games: ['ygo', 'pkm']
}

/** A portal answering `/api/me` with `me` and every RPC with null; `fetch` records the calls. */
const portalFor = (
  me: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'>
): { api: Api; fetch: Mock<(url: string) => Promise<Response>>; rpcHeaders(): unknown[] } => {
  const fetch = vi.fn(async (url: string) =>
    url === '/api/me' ? reply(200, me) : reply(200, { result: null })
  )
  const api = createHttpApi({
    fetch: fetch as unknown as typeof globalThis.fetch,
    onSignedOut: vi.fn(),
    storage
  })
  const rpcHeaders = (): unknown[] =>
    fetch.mock.calls
      .filter(([url]) => url.startsWith('/api/rpc/'))
      .map((c) => (c as unknown as [string, RequestInit])[1].headers)
  return { api, fetch, rpcHeaders }
}

describe('createHttpApi', () => {
  it('posts args and resolves result', async () => {
    const { api, fetch } = setup(reply(200, { result: { id: 3 } }))
    await expect(api.collection.update(3, { quantity: 2 })).resolves.toEqual({ id: 3 })
    expect(fetch).toHaveBeenCalledWith('/api/rpc/collection:update', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-duel-game': 'ygo' },
      body: '{"args":[3,{"quantity":2}]}',
      credentials: 'same-origin'
    })
  })

  it('routes every portal channel to its own URL', async () => {
    for (const channel of PORTAL_CHANNELS) {
      const [ns, method] = channel.split(':')
      const { api, fetch } = setup(reply(200, { result: null }))
      await (api as never as Record<string, Record<string, () => Promise<unknown>>>)[ns][method]()
      expect(fetch.mock.calls[0]).toEqual([`/api/rpc/${channel}`, expect.anything()])
    }
  })

  it('401 sends the visitor to the sign-in page', async () => {
    const { api, onSignedOut } = setup(reply(401, { error: 'no' }))
    await expect(api.stats.get()).rejects.toThrow('Signed out')
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('400 rejects with the server message', async () => {
    const msg = 'Quantity must be a whole number of at least 1'
    const { api } = setup(reply(400, { error: msg }))
    await expect(api.collection.update(1, { quantity: 0 })).rejects.toThrow(msg)
  })

  it('500 without a message rejects generically', async () => {
    const { api } = setup(reply(500, {}))
    await expect(api.stats.get()).rejects.toThrow('Request failed (500)')
  })

  it('a non-JSON error body rejects generically', async () => {
    const { api } = setup(reply(502, '<html>Bad gateway</html>'))
    await expect(api.stats.get()).rejects.toThrow('Request failed (502)')
  })

  it('a non-JSON success body rejects instead of leaking a parse error', async () => {
    const { api } = setup(reply(200, 'oops'))
    await expect(api.stats.get()).rejects.toThrow('Request failed (200)')
  })

  it('a network failure rejects with a readable error', async () => {
    const { api } = setup(new TypeError('Failed to fetch'))
    await expect(api.stats.get()).rejects.toThrow('Could not reach Duel Binder')
  })

  it('desktop-only calls never hit the network', async () => {
    const { api, fetch } = setup(reply(200, {}))
    expect(api.window.platform).toBe('web')
    await expect(api.app.updateStatus()).resolves.toMatchObject({ state: 'idle' })
    await expect(api.sync.status()).resolves.toMatchObject({ state: 'idle', cardCount: 1 })
    await expect(api.window.isMaximized()).resolves.toBe(false)
    await expect(api.app.version()).resolves.toBe('web')
    await expect(api.images.cacheSize()).rejects.toThrow('Not available on the web')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('every Api invoke method exists', () => {
    const { api } = setup(reply(200, {}))
    for (const channel of INVOKE_CHANNELS) {
      const [ns, method] = channel.split(':')
      const fn = (api as never as Record<string, Record<string, unknown>>)[ns][method]
      expect(typeof fn, channel).toBe('function')
    }
  })

  it('every on* subscription returns an unsubscribe function', () => {
    const { api } = setup(reply(200, {}))
    let count = 0
    for (const ns of Object.values(api) as Record<string, unknown>[]) {
      for (const [name, fn] of Object.entries(ns)) {
        if (!/^on[A-Z]/.test(name)) continue
        count++
        expect(typeof (fn as (cb: () => void) => unknown)(() => {}), name).toBe('function')
      }
    }
    expect(count).toBe(7)
  })

  it('account calls reject on the web without fetching', async () => {
    const { api, fetch } = setup(reply(200, {}))
    await expect(api.account.status()).rejects.toThrow('Not available on the web')
    await expect(api.account.signIn()).rejects.toThrow('Not available on the web')
    await expect(api.account.signOut()).rejects.toThrow('Not available on the web')
    await expect(api.account.syncNow()).rejects.toThrow('Not available on the web')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('deleteAccount posts the confirmation with the cookie, then leaves the page', async () => {
    const { api, fetch, onSignedOut } = setup(new Response(null, { status: 204 }))
    await expect(api.account.deleteAccount()).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"confirm":"delete"}',
      credentials: 'same-origin'
    })
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('deleteAccount rejects on a failure and stays on the page', async () => {
    const { api, onSignedOut } = setup(reply(500, {}))
    await expect(api.account.deleteAccount()).rejects.toThrow("Couldn't delete your account")
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('deleteAccount when signed out goes to the sign-in page', async () => {
    const { api, onSignedOut } = setup(reply(401, { error: 'signed-out' }))
    await expect(api.account.deleteAccount()).rejects.toThrow('Signed out')
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('deleteAccount offline rejects with a readable error', async () => {
    const { api } = setup(new TypeError('Failed to fetch'))
    await expect(api.account.deleteAccount()).rejects.toThrow(/offline|connect/i)
  })

  it('sends x-duel-game: pkm after setActive, and the choice survives a reload', async () => {
    const storage = memoryStorage()
    const first = portalFor(OWNER_ME, storage)
    await expect(first.api.games.available()).resolves.toEqual(['ygo', 'pkm'])
    await expect(first.api.games.active()).resolves.toBe('ygo')
    const reload = vi.fn()
    first.api.app.onDataChanged(reload)
    await first.api.games.setActive('pkm')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(storage.getItem(GAME_KEY)).toBe('pkm')
    await first.api.collection.list({} as never)
    expect(first.rpcHeaders().at(-1)).toMatchObject({ 'x-duel-game': 'pkm' })

    const second = portalFor(OWNER_ME, storage)
    await expect(second.api.games.active()).resolves.toBe('pkm')
    await second.api.stats.get()
    expect(second.rpcHeaders()).toEqual([
      { 'content-type': 'application/json', 'x-duel-game': 'pkm' }
    ])
  })

  it('setActive rejects a game the account may not use', async () => {
    const storage = memoryStorage()
    const { api, rpcHeaders } = portalFor({ ...OWNER_ME, games: undefined }, storage)
    await expect(api.games.available()).resolves.toEqual(['ygo'])
    await expect(api.games.setActive('pkm')).rejects.toThrow("isn't available")
    expect(storage.getItem(GAME_KEY)).toBeNull()
    await api.stats.get()
    expect(rpcHeaders()).toEqual([{ 'content-type': 'application/json', 'x-duel-game': 'ygo' }])
  })

  it('a remembered game the signed-in account may not use falls back to ygo', async () => {
    const storage = memoryStorage()
    storage.setItem(GAME_KEY, 'pkm')
    const { api, rpcHeaders } = portalFor({ ...OWNER_ME, games: ['ygo'] }, storage)
    await expect(api.games.active()).resolves.toBe('ygo')
    expect(storage.getItem(GAME_KEY)).toBe('ygo')
    await api.stats.get()
    expect(rpcHeaders()).toEqual([{ 'content-type': 'application/json', 'x-duel-game': 'ygo' }])
  })

  it('available asks /api/me once, and again after a failure', async () => {
    const storage = memoryStorage()
    let fail = true
    const fetch = vi.fn(async () => (fail ? reply(500, {}) : reply(200, OWNER_ME)))
    const api = createHttpApi({ fetch: fetch as never, onSignedOut: vi.fn(), storage })
    await expect(api.games.available()).rejects.toThrow('Request failed (500)')
    fail = false
    await expect(api.games.available()).resolves.toEqual(['ygo', 'pkm'])
    await expect(api.games.available()).resolves.toEqual(['ygo', 'pkm'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('defaults to localStorage', async () => {
    localStorage.removeItem(GAME_KEY)
    const fetch = vi.fn(async (url: string) =>
      url === '/api/me' ? reply(200, OWNER_ME) : reply(200, { result: null })
    )
    const api = createHttpApi({ fetch: fetch as never, onSignedOut: vi.fn() })
    await api.games.setActive('pkm')
    expect(localStorage.getItem(GAME_KEY)).toBe('pkm')
    localStorage.removeItem(GAME_KEY)
  })
})
