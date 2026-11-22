import { describe, expect, it, vi } from 'vitest'
import { adminHandlers } from '../../src/main/ipc/adminHandlers'
import { createAdminRuns } from '../../src/main/adminRuns'
import { CloudOfflineError, createCloudClient } from '../../src/main/cloud/client'

function make(isAdmin = true) {
  const admin = vi.fn(async (path: string, _body?: unknown): Promise<unknown> => {
    if (path === '/admin/merges') return { merges: [{ closedId: 3 }] }
    if (path === '/admin/testers') return { testers: [{ id: 1 }] }
    if (path === '/admin/merges/undo') return undefined
    return { ok: true }
  })
  const runs = { runs: vi.fn(async () => []), jobs: vi.fn(async () => []) }

  const capture = {
    save: vi.fn(async () => '/x/k00001.jpg'),
    remove: vi.fn(async () => undefined),
    note: vi.fn(async () => undefined),
    openFolder: vi.fn(async () => undefined)
  }
  const status = () => ({ user: isAdmin ? { admin: true } : {} })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = adminHandlers({ admin: admin as any, status: status as any }, runs, capture) as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >
  return { h, admin, runs, capture }
}

const FIELDS = {
  phrase: ' blue eyes ',
  kind: 'nickname',
  targetKind: 'card',
  target: { cardIds: [4] }
}

describe('admin handlers: search terms', () => {
  it('reads a game and status, decides and adds with checked bodies', async () => {
    const { h, admin } = make()
    admin.mockResolvedValueOnce({ terms: [{ id: 9 }] })
    expect(await h['admin:terms']('pkm', 'pending')).toEqual([{ id: 9 }])
    expect(admin).toHaveBeenLastCalledWith('/admin/terms?status=pending&game=pkm')
    await h['admin:decideTerm'](9, 'rejected')
    expect(admin).toHaveBeenLastCalledWith('/admin/terms/decide', { id: 9, status: 'rejected' })
    await h['admin:decideTerm'](9, 'approved', FIELDS)
    expect(admin).toHaveBeenLastCalledWith('/admin/terms/decide', {
      id: 9,
      status: 'approved',
      ...FIELDS,
      phrase: 'blue eyes'
    })
    await h['admin:addTerm']('ygo', FIELDS)
    expect(admin).toHaveBeenLastCalledWith('/admin/terms/add', {
      game: 'ygo',
      ...FIELDS,
      phrase: 'blue eyes'
    })
  })

  it('rejects bad arguments before calling the portal', async () => {
    const { h, admin } = make()
    await expect(h['admin:decideTerm'](1, 'pending')).rejects.toThrow('Bad status')
    await expect(h['admin:decideTerm']('1', 'approved')).rejects.toThrow('Bad id')
    await expect(h['admin:terms']('pkm', 'all')).rejects.toThrow('Bad status')
    await expect(h['admin:terms']('nope', 'pending')).rejects.toThrow('Bad game')
    await expect(h['admin:addTerm']('pkm', { ...FIELDS, kind: 'x' })).rejects.toThrow('Bad term')
    await expect(h['admin:addTerm']('pkm', { ...FIELDS, phrase: 'a b c d e' })).rejects.toThrow(
      'Bad term'
    )
    expect(admin).not.toHaveBeenCalled()
  })

  it('says why a phrase clash or a refused body failed', async () => {
    const { h, admin } = make()
    admin.mockRejectedValueOnce(new Error('duplicate'))
    await expect(h['admin:addTerm']('pkm', FIELDS)).rejects.toThrow('already used by another term')
    admin.mockRejectedValueOnce(new Error('duplicate-rejected'))
    await expect(h['admin:addTerm']('pkm', FIELDS)).rejects.toThrow(
      'already used by a rejected term in this game. Restore it from the Rejected list.'
    )
    admin.mockRejectedValueOnce(new Error('duplicate-pending'))
    await expect(h['admin:addTerm']('pkm', FIELDS)).rejects.toThrow('a pending term')
    admin.mockRejectedValueOnce(new Error('Bad request'))
    await expect(h['admin:decideTerm'](1, 'approved', FIELDS)).rejects.toThrow('refused')
  })
})

describe('admin handlers: seats', () => {
  it('reads the seats and posts each action to its route', async () => {
    const { h, admin } = make()
    await h['admin:seats']()
    expect(admin).toHaveBeenLastCalledWith('/admin/seats')
    admin.mockResolvedValueOnce({ ok: true, invited: 3 })
    await expect(h['admin:seatsAction']({ action: 'cap', cap: 50 })).resolves.toEqual({
      invited: 3
    })
    expect(admin).toHaveBeenLastCalledWith('/admin/seats/cap', { cap: 50 })
    await h['admin:seatsAction']({ action: 'fill' })
    expect(admin).toHaveBeenLastCalledWith('/admin/seats/fill', {})
    await h['admin:seatsAction']({ action: 'invite', id: 4 })
    expect(admin).toHaveBeenLastCalledWith('/admin/seats/invite', { id: 4 })
  })

  it('rejects bad arguments and says why an invite failed', async () => {
    const { h, admin } = make()
    await expect(h['admin:seatsAction']({ action: 'cap', cap: -1 })).rejects.toThrow('Bad cap')
    await expect(h['admin:seatsAction']({ action: 'nuke' })).rejects.toThrow('Bad action')
    await expect(h['admin:seatsAction']({ action: 'invite', id: 'x' })).rejects.toThrow('Bad id')
    expect(admin).not.toHaveBeenCalled()
    // What the real client throws for the portal's 409 { error: 'joined' }.
    const client = createCloudClient({
      baseUrl: 'https://portal.test',
      token: 't',
      fetch: (async () => Response.json({ error: 'joined' }, { status: 409 })) as typeof fetch
    })
    admin.mockImplementationOnce((path, body) => client.admin(path as `/admin/${string}`, body))
    await expect(h['admin:seatsAction']({ action: 'resend', id: 1 })).rejects.toThrow(
      'That person already has an account.'
    )
    admin.mockRejectedValueOnce(new CloudOfflineError('The portal failed (502)'))
    await expect(h['admin:seatsAction']({ action: 'invite', id: 1 })).rejects.toThrow(
      "invite email didn't go out"
    )
  })
})

describe('admin handlers: phone beta', () => {
  it('reads, decides and deletes beta requests', async () => {
    const { h, admin } = make()
    await h['admin:beta']()
    expect(admin).toHaveBeenLastCalledWith('/admin/beta')
    await h['admin:decideBeta'](1, 'added')
    expect(admin).toHaveBeenLastCalledWith('/admin/beta/decide', { id: 1, status: 'added' })
    await h['admin:deleteBeta'](2)
    expect(admin).toHaveBeenLastCalledWith('/admin/beta/delete', { id: 2 })
  })

  it('rejects bad arguments before calling the portal', async () => {
    const { h, admin } = make()
    await expect(h['admin:decideBeta'](1, 'pending')).rejects.toThrow('Bad status')
    await expect(h['admin:decideBeta']('1', 'added')).rejects.toThrow('Bad id')
    await expect(h['admin:deleteBeta']('x')).rejects.toThrow('Bad id')
    expect(admin).not.toHaveBeenCalled()
  })

  it("says App Store Connect wouldn't add the tester when the portal answers 502", async () => {
    const { h, admin } = make()
    admin.mockRejectedValueOnce(new CloudOfflineError('The portal failed (502)'))
    await expect(h['admin:decideBeta'](1, 'added')).rejects.toThrow(
      "App Store Connect wouldn't add them to the TestFlight group"
    )
  })
})

describe('admin handlers', () => {
  it('reads unwrap the portal answers', async () => {
    const { h, admin } = make()
    expect(await h['admin:merges']()).toEqual([{ closedId: 3 }])
    expect(await h['admin:testers']()).toEqual([{ id: 1 }])
    await h['admin:photos']()
    expect(admin).toHaveBeenLastCalledWith('/admin/training')
    await h['admin:costs'](7)
    expect(admin).toHaveBeenLastCalledWith('/admin/costs?days=7')
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
    await expect(h['admin:costs'](3)).rejects.toThrow('Bad days')
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

  it('rip capture is for a signed-in admin only', async () => {
    const yes = make()
    const jpeg = new ArrayBuffer(4)
    await yes.h['admin:captureSave']('20261109-081500', 'k00001.jpg', jpeg, { sharp: 1 })
    expect(yes.capture.save).toHaveBeenCalledWith('20261109-081500', 'k00001.jpg', jpeg, {
      sharp: 1
    })
    await yes.h['admin:captureOpenFolder']()
    expect(yes.capture.openFolder).toHaveBeenCalledWith(null)
    const no = make(false)
    await expect(
      no.h['admin:captureSave']('20261109-081500', 'k00001.jpg', jpeg, {})
    ).rejects.toThrow('Not found')
    await expect(no.h['admin:captureRemove']('20261109-081500', 'k00001.jpg')).rejects.toThrow(
      'Not found'
    )
    await expect(no.h['admin:captureNote']('20261109-081500', 'good')).rejects.toThrow('Not found')
    await yes.h['admin:captureNote']('20261109-081500', 'good data')
    expect(yes.capture.note).toHaveBeenCalledWith('20261109-081500', 'good data')
    expect(no.capture.save).not.toHaveBeenCalled()
  })
})
