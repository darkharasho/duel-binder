import { describe, expect, it, vi } from 'vitest'
import { createHttpApi } from '../../src/renderer/src/web/httpApi'
import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { PORTAL_CHANNELS } from '../../src/shared/portal'

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

const setup = (res: Response | Error) => {
  const fetch = vi.fn(async () => {
    if (res instanceof Error) throw res
    return res
  })
  const onSignedOut = vi.fn()
  const api = createHttpApi({ fetch: fetch as unknown as typeof globalThis.fetch, onSignedOut })
  return { api, fetch, onSignedOut }
}

describe('createHttpApi', () => {
  it('posts args and resolves result', async () => {
    const { api, fetch } = setup(reply(200, { result: { id: 3 } }))
    await expect(api.collection.update(3, { quantity: 2 })).resolves.toEqual({ id: 3 })
    expect(fetch).toHaveBeenCalledWith('/api/rpc/collection:update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
})
