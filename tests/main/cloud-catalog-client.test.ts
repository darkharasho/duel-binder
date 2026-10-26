import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudAuthError, createCloudClient } from '../../src/main/cloud/client'
import type { ContributedPrinting } from '../../src/shared/catalogFeed'
import { inProcessPortal, PORTAL } from './cloudHelpers'

type Portal = Awaited<ReturnType<typeof inProcessPortal>>
let portal: Portal
let token: string

beforeEach(async () => {
  portal = await inProcessPortal()
  token = await portal.desktopToken(portal.addUser('alice'))
})
afterEach(() => portal.serverDb.close())

describe('catalog feed client calls', () => {
  it('catalogChanges(0) returns the seeded catalog rows', async () => {
    const client = createCloudClient({ baseUrl: PORTAL, token, fetch: portal.fetch })
    const page = await client.catalogChanges(0)
    expect(page.changes.length).toBeGreaterThan(0)
    expect(page.cursor).toBeGreaterThan(0)
    expect(page.more).toBe(false)
    expect(page.changes.some((c) => c.table === 'cards')).toBe(true)
  })

  it('pages with limit, and leaves limit out of the query when not given', async () => {
    const urls: string[] = []
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      return portal.fetch(input, init)
    }) as unknown as typeof fetch
    const client = createCloudClient({ baseUrl: PORTAL, token, fetch: spy })
    const page = await client.catalogChanges(0, 2)
    expect(page.changes).toHaveLength(2)
    expect(page.more).toBe(true)
    await client.catalogChanges(page.cursor)
    expect(urls[0]).toBe(`${PORTAL}/api/catalog/changes?since=0&limit=2`)
    expect(urls[1]).toBe(`${PORTAL}/api/catalog/changes?since=${page.cursor}`)
  })

  it('contribute([]) resolves to an empty result list', async () => {
    const client = createCloudClient({ baseUrl: PORTAL, token, fetch: portal.fetch })
    expect(await client.contribute([])).toEqual([])
  })

  it('maps server errors like the other calls', async () => {
    const client = createCloudClient({ baseUrl: PORTAL, token, fetch: portal.fetch })
    const many = Array.from({ length: 501 }, () => ({}) as ContributedPrinting)
    await expect(client.contribute(many)).rejects.toThrow('too-many')
    const stranger = createCloudClient({ baseUrl: PORTAL, token: 'nope', fetch: portal.fetch })
    await expect(stranger.catalogChanges(0)).rejects.toBeInstanceOf(CloudAuthError)
  })
})
