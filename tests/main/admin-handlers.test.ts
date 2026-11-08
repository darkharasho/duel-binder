import { describe, expect, it, vi } from 'vitest'
import { adminHandlers } from '../../src/main/ipc/adminHandlers'
import { createAdminRuns } from '../../src/main/adminRuns'

function make() {
  const admin = vi.fn(async (path: string, _body?: unknown): Promise<unknown> => {
    if (path === '/admin/merges') return { merges: [{ closedId: 3 }] }
    if (path === '/admin/testers') return { testers: [{ id: 1 }] }
    if (path === '/admin/merges/undo') return undefined
    return { ok: true }
  })
  const runs = { runs: vi.fn(async () => []), jobs: vi.fn(async () => []) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = adminHandlers({ admin: admin as any }, runs) as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >
  return { h, admin, runs }
}

describe('admin handlers', () => {
  it('reads unwrap the portal answers', async () => {
    const { h, admin } = make()
    expect(await h['admin:merges']()).toEqual([{ closedId: 3 }])
    expect(await h['admin:testers']()).toEqual([{ id: 1 }])
    await h['admin:photos']()
    expect(admin).toHaveBeenLastCalledWith('/admin/training')
  })

  it('writes send checked bodies', async () => {
    const { h, admin } = make()
    await h['admin:addTester']('op', 'discordUsername', '  Dub ')
    expect(admin).toHaveBeenLastCalledWith('/admin/testers', { game: 'op', discordUsername: 'Dub' })
    await h['admin:removeAdmin'](7)
    expect(admin).toHaveBeenLastCalledWith('/admin/admins/remove', { userId: 7 })
    expect(await h['admin:undoMerge'](3)).toEqual([])
  })

  it('rejects bad arguments before calling the portal', async () => {
    const { h, admin, runs } = make()
    await expect(h['admin:addTester']('nope', 'username', 'x')).rejects.toThrow('Bad game')
    await expect(h['admin:addTester']('op', 'email', 'x')).rejects.toThrow('Bad tester kind')
    await expect(h['admin:addAdmin']('   ')).rejects.toThrow('Bad username')
    await expect(h['admin:removeTester']('1')).rejects.toThrow('Bad id')
    await expect(h['admin:undoMerge'](1.5)).rejects.toThrow('Bad id')
    await expect(h['admin:runs']('../x', 6)).rejects.toThrow('Bad workflow')
    expect(admin).not.toHaveBeenCalled()
    expect(runs.runs).not.toHaveBeenCalled()
  })
})

describe('admin runs', () => {
  it('asks again with the ETag and reuses the kept answer on 304', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workflow_runs: [{ id: 1 }] }), {
          status: 200,
          headers: { etag: '"a"' }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const r = createAdminRuns(fetch as unknown as typeof globalThis.fetch)
    expect(await r.runs('catalog.yml', 6)).toEqual([{ id: 1 }])
    expect(await r.runs('catalog.yml', 6)).toEqual([{ id: 1 }])
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/darkharasho/duel-binder/actions/workflows/catalog.yml/runs?per_page=6'
    )
    expect(fetch.mock.calls[1][1].headers['if-none-match']).toBe('"a"')
  })

  it('says when the GitHub limit is reached', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }))
    const r = createAdminRuns(fetch as unknown as typeof globalThis.fetch)
    await expect(r.jobs(5)).rejects.toThrow('GitHub limit reached')
  })
})

describe('cloud client admin calls', () => {
  it('GETs without a body, POSTs with one, and a 204 resolves to undefined', async () => {
    const { createCloudClient } = await import('../../src/main/cloud/client')
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ merges: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const c = createCloudClient({
      baseUrl: 'https://portal.test',
      token: 'tok',
      fetch: fetch as unknown as typeof globalThis.fetch
    })
    expect(await c.admin('/admin/merges')).toEqual({ merges: [] })
    expect(await c.admin('/admin/merges/undo', { closedId: 3 })).toBeUndefined()
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' })
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: '{"closedId":3}',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }
    })
  })
})
