import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signedMessage, type BundleTarget, type ManifestEntry } from '../../src/shared/appBundles'
import {
  createLiveUpdate,
  DOWNLOAD_PLACEHOLDER_URL,
  FAILED_KEY,
  PENDING_KEY,
  type Updater
} from '../../src/phone/liveUpdate'

const subtle: SubtleCrypto =
  (globalThis.crypto?.subtle as SubtleCrypto | undefined) ?? (webcrypto.subtle as SubtleCrypto)

const TARGET: BundleTarget = 'android-play'
const manifest = (v: string): ManifestEntry[] => [
  { file_name: 'index.html', file_hash: 'a'.repeat(64), download_url: `https://x/${v}/index` },
  { file_name: 'assets/app.js', file_hash: 'b'.repeat(64), download_url: `https://x/${v}/app` }
]

const b64url = (buf: ArrayBuffer): string => Buffer.from(buf).toString('base64url')

let pair: CryptoKeyPair
let publicKey: JsonWebKey

beforeEach(async () => {
  pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])) as CryptoKeyPair
  publicKey = await subtle.exportKey('jwk', pair.publicKey)
})

async function offer(version: string, tamper = false): Promise<unknown> {
  const m = manifest(version)
  const sig = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    signedMessage(TARGET, version, m) as Uint8Array<ArrayBuffer>
  )
  const sent = tamper ? m.map((e, i) => (i === 0 ? { ...e, file_hash: 'c'.repeat(64) } : e)) : m
  return { version, manifest: sent, signature: b64url(sig) }
}

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v)
  }
}

interface SetupOpts {
  /** The running bundle's version (deps.current). */
  current?: string
  /** What `current()` reports as the running bundle. */
  running?: { id: string; version: string }
  /** localStorage contents before start-up. */
  seed?: Record<string, string>
  /** Bundles on disk before start-up (besides builtin). */
  bundles?: { id: string; version: string; status?: string }[]
  /** What `getFailedUpdate()` returns once. */
  failedUpdate?: { bundle: { id: string; version: string } } | null
}

function setup(answers: unknown[] | (() => Promise<unknown>), opts: SetupOpts = {}) {
  let failedCb: ((i: { bundle: { version: string } }) => void) | undefined
  let n = 0
  const current = opts.current ?? '0.100.0'
  const disk = new Map<string, { id: string; version: string; status: string }>()
  for (const b of opts.bundles ?? []) disk.set(b.id, { status: 'success', ...b })
  let failedUpdate = opts.failedUpdate ?? null
  const updater = {
    getBuiltinVersion: vi.fn(async () => ({ version: '0.100.0' })),
    download: vi.fn(async (o: { url: string; version: string }) => {
      const b = { id: `id-${o.version}`, version: o.version }
      disk.set(b.id, { ...b, status: 'pending' })
      return b
    }),
    next: vi.fn(async (_o: { id: string }) => ({})),
    set: vi.fn(async (_o: { id: string }) => undefined),
    delete: vi.fn(async (o: { id: string }) => void disk.delete(o.id)),
    setBundleError: vi.fn(async (o: { id: string }) => {
      const b = disk.get(o.id)
      if (b) b.status = 'error'
      return { bundle: b }
    }),
    current: vi.fn(async () => ({
      bundle: opts.running ?? { id: 'builtin', version: current },
      native: '0.100.0'
    })),
    list: vi.fn(async () => ({
      bundles: [{ id: 'builtin', version: '0.100.0', status: 'success' }, ...disk.values()]
    })),
    getFailedUpdate: vi.fn(async () => {
      const f = failedUpdate
      failedUpdate = null
      return f
    }),
    addListener: vi.fn(async (_e: 'updateFailed', cb: typeof failedCb) => {
      failedCb = cb
      return {}
    })
  }
  const doFetch = vi.fn(async (_url: string) => {
    if (typeof answers === 'function') return (await answers()) as Response
    const a = answers[Math.min(n++, answers.length - 1)]
    return new Response(JSON.stringify(a), { status: 200 })
  })
  let t = 1_000_000
  const storage = memoryStorage()
  for (const [k, v] of Object.entries(opts.seed ?? {})) storage.setItem(k, v)
  let visible: () => void = () => undefined
  const live = createLiveUpdate({
    updater: updater as unknown as Updater,
    fetch: doFetch as unknown as typeof fetch,
    storage,
    now: () => t,
    target: TARGET,
    current,
    publicKey,
    on: (_e, cb) => {
      visible = cb
      return () => undefined
    }
  })
  return {
    live,
    updater,
    doFetch,
    storage,
    disk,
    advance: (ms: number) => void (t += ms),
    fail: (v: string) => failedCb?.({ bundle: { version: v } }),
    fireVisible: () => visible()
  }
}

const MIN = 60_000

describe('liveUpdate', () => {
  it('liveUpdate: downloads a newer signed offer and sets it next', async () => {
    const s = setup([await offer('0.101.0')])
    const heard = vi.fn()
    window.addEventListener('duelbinder:live-pending', heard)
    await s.live.check()
    window.removeEventListener('duelbinder:live-pending', heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(s.doFetch.mock.calls[0][0]).toContain('target=android-play')
    expect(s.doFetch.mock.calls[0][0]).toContain('builtin=0.100.0')
    expect(s.doFetch.mock.calls[0][0]).toContain('current=0.100.0')
    expect(s.updater.download).toHaveBeenCalledTimes(1)
    expect(s.updater.download.mock.calls[0][0]).toMatchObject({
      url: DOWNLOAD_PLACEHOLDER_URL
    })
    expect(DOWNLOAD_PLACEHOLDER_URL).toMatch(/\/api\/app-update\/none$/)
    expect(s.updater.next).toHaveBeenCalledWith({ id: 'id-0.101.0' })
    expect(s.live.pending()).toEqual({ id: 'id-0.101.0', version: '0.101.0' })
  })

  it("liveUpdate: refuses an offer whose signature doesn't verify", async () => {
    const s = setup([await offer('0.101.0', true)])
    await s.live.check()
    expect(s.updater.download).not.toHaveBeenCalled()
    expect(s.live.pending()).toBeNull()
  })

  it('liveUpdate: skips a version the plugin rolled back', async () => {
    const s = setup([await offer('0.102.0')])
    s.fail('0.102.0')
    await s.live.check()
    expect(s.updater.download).not.toHaveBeenCalled()
  })

  it('liveUpdate: checks at most every 10 minutes', async () => {
    const s = setup([{ version: null }])
    await s.live.check()
    s.advance(5 * MIN)
    await s.live.check()
    expect(s.doFetch).toHaveBeenCalledTimes(1)
    s.advance(6 * MIN)
    await s.live.check()
    expect(s.doFetch).toHaveBeenCalledTimes(2)
  })

  it('liveUpdate: a newer offer replaces the pending one', async () => {
    const s = setup([await offer('0.101.0'), await offer('0.102.0')])
    await s.live.check()
    s.advance(11 * MIN)
    await s.live.check()
    expect(s.updater.delete).toHaveBeenCalledWith({ id: 'id-0.101.0' })
    expect(s.live.pending()).toEqual({ id: 'id-0.102.0', version: '0.102.0' })
  })

  it('liveUpdate: a failed next() deletes the downloaded bundle', async () => {
    const s = setup([await offer('0.101.0')])
    s.updater.next.mockRejectedValueOnce(new Error('boom'))
    await expect(s.live.check()).resolves.toBeUndefined()
    expect(s.updater.delete).toHaveBeenCalledWith({ id: 'id-0.101.0' })
    expect(s.live.pending()).toBeNull()
  })

  it('liveUpdate: offline is silent', async () => {
    const s = setup(async () => {
      throw new TypeError('offline')
    })
    await expect(s.live.check()).resolves.toBeUndefined()
    expect(s.updater.download).not.toHaveBeenCalled()
  })

  it('liveUpdate: stores shellUpdate from the answer', async () => {
    const s = setup([{ version: null, shellUpdate: { version: '0.103.0', url: 'https://x/a.apk' } }])
    await s.live.check()
    expect(JSON.parse(s.storage.getItem('duelbinder.shellUpdate')!)).toEqual({
      version: '0.103.0',
      url: 'https://x/a.apk'
    })
    // an answer without one clears it
    const t = setup([{ version: null }])
    t.storage.setItem('duelbinder.shellUpdate', '{"version":"1","url":"u"}')
    await t.live.check()
    expect(t.storage.getItem('duelbinder.shellUpdate')).toBeNull()
  })

  it('liveUpdate: announces shellUpdate only when it changes', async () => {
    const same = { version: null, shellUpdate: { version: '0.103.0', url: 'https://x/a.apk' } }
    const s = setup([same, same, { version: null }])
    const heard = vi.fn()
    window.addEventListener('duelbinder:shell-update', heard)
    await s.live.check()
    expect(heard).toHaveBeenCalledTimes(1)
    s.advance(11 * MIN)
    await s.live.check()
    expect(heard).toHaveBeenCalledTimes(1)
    s.advance(11 * MIN)
    await s.live.check()
    window.removeEventListener('duelbinder:shell-update', heard)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('liveUpdate: a return to the foreground runs a check', async () => {
    const s = setup([{ version: null }])
    s.fireVisible()
    await vi.waitFor(() => expect(s.doFetch).toHaveBeenCalledTimes(1))
  })

  it('liveUpdate: applyNow sets the pending bundle', async () => {
    const s = setup([await offer('0.101.0')])
    await s.live.check()
    await s.live.applyNow()
    expect(s.updater.set).toHaveBeenCalledWith({ id: 'id-0.101.0' })
  })

  it('liveUpdate: a rejected set clears pending, so Home stops retrying', async () => {
    const s = setup([await offer('0.101.0')])
    await s.live.check()
    s.updater.set.mockRejectedValueOnce(new Error('gone'))
    await expect(s.live.applyNow()).rejects.toThrow('gone')
    expect(s.live.pending()).toBeNull()
    // the staged bundle no longer launches next: next goes back to the running bundle
    expect(s.updater.next).toHaveBeenLastCalledWith({ id: 'builtin' })
    await s.live.applyNow()
    expect(s.updater.set).toHaveBeenCalledTimes(1)
  })
})

describe('liveUpdate start-up reconciliation', () => {
  const P = (id: string, version: string) => ({ [PENDING_KEY]: JSON.stringify({ id, version }) })

  it('reconcile: after a switch, the running version is not pending', async () => {
    const s = setup([{ version: null }], {
      current: '0.101.0',
      running: { id: 'id-0.101.0', version: '0.101.0' },
      seed: P('id-0.101.0', '0.101.0'),
      bundles: [{ id: 'id-0.101.0', version: '0.101.0' }]
    })
    expect(s.live.pending()).toBeNull()
    await s.live.ready()
    expect(s.live.pending()).toBeNull()
    expect(s.storage.getItem(PENDING_KEY)).toBeNull()
    // the running bundle is never deleted or set again
    expect(s.updater.delete).not.toHaveBeenCalled()
    await s.live.applyNow()
    expect(s.updater.set).not.toHaveBeenCalled()
  })

  it('reconcile: a running id match clears pending even if the version string differs', async () => {
    const s = setup([{ version: null }], {
      running: { id: 'id-x', version: '0.101.0' },
      seed: P('id-x', '0.101.0+b'),
      bundles: [{ id: 'id-x', version: '0.101.0' }]
    })
    await s.live.ready()
    expect(s.live.pending()).toBeNull()
  })

  it('reconcile: getFailedUpdate records the failed version and clears pending', async () => {
    const s = setup([await offer('0.101.0')], {
      seed: P('id-0.101.0', '0.101.0'),
      failedUpdate: { bundle: { id: 'id-0.101.0', version: '0.101.0' } }
    })
    await s.live.ready()
    expect(s.live.pending()).toBeNull()
    expect(JSON.parse(s.storage.getItem(FAILED_KEY)!)).toEqual(['0.101.0'])
    // and the failed version is never downloaded again
    await s.live.check()
    expect(s.updater.download).not.toHaveBeenCalled()
  })

  it('reconcile: a pending id missing from list() is cleared', async () => {
    const s = setup([{ version: null }], { seed: P('id-0.101.0', '0.101.0') })
    await s.live.ready()
    expect(s.live.pending()).toBeNull()
  })

  it('reconcile: a pending bundle in error status is cleared', async () => {
    const s = setup([{ version: null }], {
      seed: P('id-0.101.0', '0.101.0'),
      bundles: [{ id: 'id-0.101.0', version: '0.101.0', status: 'error' }]
    })
    await s.live.ready()
    expect(s.live.pending()).toBeNull()
  })

  it('reconcile: a healthy staged bundle stays pending', async () => {
    const s = setup([await offer('0.101.0')], {
      seed: P('id-0.101.0', '0.101.0'),
      bundles: [{ id: 'id-0.101.0', version: '0.101.0', status: 'pending' }]
    })
    await s.live.ready()
    expect(s.live.pending()).toEqual({ id: 'id-0.101.0', version: '0.101.0' })
  })

  it('reconcile: plugin errors leave a usable instance', async () => {
    const s = setup([{ version: null }], { seed: P('id-0.101.0', '0.101.0') })
    s.updater.list.mockRejectedValue(new Error('x'))
    await expect(s.live.ready()).resolves.toBeUndefined()
  })
})

describe('liveUpdate withdrawn release', () => {
  it('withdraw: a null answer unstages the downloaded bundle', async () => {
    const s = setup([await offer('0.101.0'), { version: null }])
    await s.live.check()
    expect(s.live.pending()).not.toBeNull()
    s.advance(11 * 60_000)
    await s.live.check()
    expect(s.updater.next).toHaveBeenLastCalledWith({ id: 'builtin' })
    // Android ignores next(running): the errored mark is what keeps it from launching
    expect(s.updater.setBundleError).toHaveBeenCalledWith({ id: 'id-0.101.0' })
    expect(s.updater.delete).toHaveBeenCalledWith({ id: 'id-0.101.0' })
    expect(s.live.pending()).toBeNull()
    // withdrawing is not a rollback: the version may be offered again
    expect(s.storage.getItem(FAILED_KEY)).toBeNull()
  })

  it('withdraw: an older fallback answer replaces the staged bundle', async () => {
    const s = setup([await offer('0.102.0'), await offer('0.101.0')])
    await s.live.check()
    s.advance(11 * 60_000)
    await s.live.check()
    expect(s.updater.delete).toHaveBeenCalledWith({ id: 'id-0.102.0' })
    expect(s.live.pending()).toEqual({ id: 'id-0.101.0', version: '0.101.0' })
  })

  it('withdraw: unstaging points next at the running live bundle, not builtin', async () => {
    const s = setup([await offer('0.102.0'), { version: null }], {
      current: '0.101.0',
      running: { id: 'id-0.101.0', version: '0.101.0' },
      bundles: [{ id: 'id-0.101.0', version: '0.101.0' }]
    })
    await s.live.check()
    s.advance(11 * 60_000)
    await s.live.check()
    expect(s.updater.next).toHaveBeenLastCalledWith({ id: 'id-0.101.0' })
    expect(s.live.pending()).toBeNull()
  })

  it('withdraw: an older fallback whose version already failed still unstages', async () => {
    const s = setup([await offer('0.102.0'), await offer('0.101.0')])
    s.fail('0.101.0')
    await s.live.check()
    s.advance(11 * 60_000)
    await s.live.check()
    expect(s.updater.delete).toHaveBeenCalledWith({ id: 'id-0.102.0' })
    expect(s.live.pending()).toBeNull()
  })
})

describe('bundleTarget', () => {
  const load = async (platform: string, channel?: string) => {
    vi.resetModules()
    vi.doMock('@/lib/portal', () => ({
      APP_PLATFORM: platform,
      ANDROID_CHANNEL: channel ?? 'apk',
      PORTAL_ORIGIN: 'https://app.duelbinder.com'
    }))
    return (await import('../../src/phone/liveUpdate')).bundleTarget()
  }
  it('bundleTarget: android play/apk and ios, null on web', async () => {
    expect(await load('android', 'play')).toBe('android-play')
    expect(await load('android', 'apk')).toBe('android-apk')
    expect(await load('ios')).toBe('ios')
    expect(await load('web')).toBeNull()
  })
})
