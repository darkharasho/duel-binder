import { createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { vi, type Mock } from 'vitest'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addUser, memoryBucket, noPrintingArt, seededServerDb } from '../portal/helpers'

export const PORTAL = 'https://portal.test'
/** The server's clock: after every desktop edit time the tests use, so nothing is clamped. */
export const SERVER_NOW = new Date('2026-10-26T00:00:00.000Z')

/**
 * The portal Worker in-process over a seeded server database. `fetch` routes `https://portal.test/*`
 * into `handle()`; a request to any other host throws (so a sync that reaches for it fails).
 */
export async function inProcessPortal(): Promise<{
  serverDb: Database.Database
  fetch: typeof fetch
  desktopToken(userId: number): Promise<string>
  addUser(name: string): number
  priceQueue: { soon: Mock<() => Promise<void>> }
  /** The portal's R2 stand-in (images, scan files). */
  images: ReturnType<typeof memoryBucket>
}> {
  const serverDb = await seededServerDb()
  const priceQueue = { soon: vi.fn<() => Promise<void>>(async () => {}) }
  const images = memoryBucket()
  const deps: AppDeps = {
    db: serverDb,
    assets: { fetch: async () => new Response('nope', { status: 404 }) },
    images,
    printingArt: noPrintingArt,
    prices: priceQueue,
    env: {
      PUBLIC_URL: PORTAL,
      SITE_URL: 'https://site.test',
      DISCORD_CLIENT_ID: 'c',
      DISCORD_CLIENT_SECRET: 's',
      ADMIN_TOKEN: 'a',
      PRICE_WORKER_URL: 'https://prices.test'
    },
    now: () => SERVER_NOW,
    fetch: (async (input: RequestInfo | URL) => {
      throw new Error(`The portal must not fetch ${String(input)}`)
    }) as typeof fetch
  }

  const portalFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    if (new URL(req.url).origin !== PORTAL) throw new Error(`Unexpected request to ${req.url}`)
    return handle(req, deps)
  }) as typeof fetch

  let users = 0
  return {
    serverDb,
    fetch: portalFetch,
    async desktopToken(userId) {
      const token = randomBytes(24).toString('base64url')
      serverDb
        .prepare(
          "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
        )
        .run(
          createHash('sha256').update(token).digest('hex'),
          userId,
          SERVER_NOW.toISOString(),
          new Date(SERVER_NOW.getTime() + 30 * 86_400_000).toISOString()
        )
      return token
    },
    addUser: (name) => addUser(serverDb, `discord-${++users}-${name}`, name),
    priceQueue,
    images
  }
}
