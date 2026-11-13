import { describe, expect, it, vi } from 'vitest'
import { withChromiumFallback } from '../../src/main/netFallback'

const ok = (): Promise<Response> => Promise.resolve(new Response('ok'))
const fails = (): Promise<Response> => Promise.reject(new TypeError('fetch failed'))

describe('withChromiumFallback', () => {
  it('uses Node fetch while it works', async () => {
    const node = vi.fn(ok)
    const chromium = vi.fn(ok)
    const f = withChromiumFallback(node, chromium)
    await f('https://app.duelbinder.com/a')
    expect(node).toHaveBeenCalledTimes(1)
    expect(chromium).not.toHaveBeenCalled()
    expect(f.usingChromium()).toBe(false)
  })

  it('retries a network failure through Chromium and stays there', async () => {
    const node = vi.fn(fails)
    const chromium = vi.fn(ok)
    const onSwitch = vi.fn()
    const f = withChromiumFallback(node, chromium, onSwitch)
    const init = { method: 'POST', body: '{"code":"c"}', redirect: 'error' as const }
    const res = await f('https://app.duelbinder.com/auth/desktop/token', init)
    expect(await res.text()).toBe('ok')
    expect(chromium).toHaveBeenCalledWith('https://app.duelbinder.com/auth/desktop/token', init)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(f.usingChromium()).toBe(true)
    await f('https://app.duelbinder.com/b')
    expect(node).toHaveBeenCalledTimes(1)
    expect(chromium).toHaveBeenCalledTimes(2)
  })

  it('stays on Node when Chromium fails too', async () => {
    const f = withChromiumFallback(vi.fn(fails), vi.fn(fails))
    await expect(f('https://app.duelbinder.com/a')).rejects.toThrow('fetch failed')
    expect(f.usingChromium()).toBe(false)
  })

  it('never retries an aborted request', async () => {
    const ac = new AbortController()
    ac.abort()
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const chromium = vi.fn(ok)
    const f = withChromiumFallback(() => Promise.reject(abortErr), chromium)
    await expect(f('https://x.test/', { signal: ac.signal })).rejects.toBe(abortErr)
    const f2 = withChromiumFallback(() => Promise.reject(abortErr), chromium)
    await expect(f2('https://x.test/')).rejects.toBe(abortErr)
    expect(chromium).not.toHaveBeenCalled()
  })

  it('never retries a streamed body or a non-http URL', async () => {
    const chromium = vi.fn(ok)
    const f = withChromiumFallback(vi.fn(fails), chromium)
    const body = new ReadableStream()
    await expect(f('https://x.test/', { method: 'POST', body })).rejects.toThrow()
    await expect(f('file:///tmp/a')).rejects.toThrow()
    expect(chromium).not.toHaveBeenCalled()
  })
})
