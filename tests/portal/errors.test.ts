import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { JSDOM } from 'jsdom'
import { adminPage } from '../../workers/portal/src/adminPage'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { collectErrors } from '../../workers/portal/src/errors'
import { migrateServer } from '../../workers/portal/src/migrate'
import { MIGRATIONS } from '../../src/main/db/schema'
import { renderPrivacy } from '../../workers/portal/src/site/privacy'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const good = { platform: 'desktop', appVersion: '1.2.3', message: 'boom', stack: 'at x' }

describe('error reports', () => {
  let db: Database.Database
  let deps: AppDeps
  let now: Date
  let userId: number

  const session = (id: number, token: string, kind: string): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update(token).digest('hex'),
      id,
      kind,
      '2026-10-01T00:00:00.000Z',
      '2027-10-01T00:00:00.000Z'
    )
  }

  beforeEach(async () => {
    db = await seededServerDb()
    now = new Date('2026-10-31T12:00:00.000Z')
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'admin-secret',
        ADMIN_DISCORD_ID: '999',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => now,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    userId = addUser(db, '111', 'alice')
    session(userId, 'tok-desk', 'desktop')
    session(userId, 'tok-web', 'web')
    session(addUser(db, '999', 'owner'), 'tok-admin', 'web')
  })

  const post = (
    body: unknown,
    headers: Record<string, string> = { authorization: 'Bearer tok-desk' }
  ): Promise<Response> =>
    handle(
      new Request(BASE + '/api/errors', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      }),
      deps
    )
  const rows = (): Record<string, unknown>[] =>
    db.prepare('SELECT * FROM error_reports ORDER BY id').all() as Record<string, unknown>[]

  it('stores the report with no trace of who sent it', async () => {
    expect((await post(good)).status).toBe(204)
    const row = rows()[0]
    expect(row).toEqual({
      id: 1,
      day: '2026-10-31',
      platform: 'desktop',
      app_version: '1.2.3',
      message: 'boom',
      stack: 'at x'
    })
    const cols = (db.prepare('PRAGMA table_info(error_reports)').all() as { name: string }[]).map(
      (c) => c.name
    )
    expect(cols).toEqual(['id', 'day', 'platform', 'app_version', 'message', 'stack'])
    expect(JSON.stringify(row)).not.toMatch(/alice|111/)
  })

  it('scrubs again, whatever the sender did', async () => {
    await post({
      ...good,
      message: 'open /home/alice/x for jane@example.com',
      stack: 'at C:\\Users\\Alice Smith\\a.js\nBearer abc123def'
    })
    expect(rows()[0]).toMatchObject({
      message: 'open /home/~/x for [email]',
      stack: 'at C:\\Users\\~\\a.js\nBearer [token]'
    })
  })

  it('drops fields it did not ask for', async () => {
    await post({ ...good, userId: 7, email: 'a@b.co', page: 'sets', os: 'linux' })
    expect(JSON.stringify(rows()[0])).not.toMatch(/a@b|sets|linux/)
  })

  it('needs a session, and the web cookie only from the app origin', async () => {
    expect((await post(good, {})).status).toBe(401)
    expect((await post(good, { cookie: 'session=tok-web' })).status).toBe(403)
    expect(
      (await post({ ...good, platform: 'web' }, { cookie: 'session=tok-web', origin: BASE })).status
    ).toBe(204)
    expect(rows()).toHaveLength(1)
  })

  it('refuses bad reports and other methods', async () => {
    for (const body of [null, { ...good, platform: 'tv' }, { ...good, message: '' }])
      expect((await post(body)).status).toBe(400)
    const get = await handle(
      new Request(BASE + '/api/errors', { headers: { authorization: 'Bearer tok-desk' } }),
      deps
    )
    expect(get.status).toBe(405)
    expect(rows()).toEqual([])
  })

  it('caps an account at 20 an hour, and nothing about that is stored', async () => {
    for (let i = 0; i < 20; i++) expect((await post(good)).status).toBe(204)
    expect((await post(good)).status).toBe(429)
    expect(rows()).toHaveLength(20)
    now = new Date(now.getTime() + 61 * 60 * 1000)
    expect((await post(good)).status).toBe(204)
  })

  it('prunes reports older than 30 days as new ones arrive', async () => {
    const add = db.prepare(
      "INSERT INTO error_reports (day, platform, app_version, message) VALUES (?, 'web', '1', ?)"
    )
    add.run('2026-09-30', 'old')
    add.run('2026-10-01', 'on the line')
    await post(good)
    expect(rows().map((r) => r.message)).toEqual(['on the line', 'boom'])
  })

  it('keeps reports when an account is deleted: nothing ties them to it', async () => {
    await post(good)
    const res = await handle(
      new Request(BASE + '/api/account/delete', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-desk', 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete' })
      }),
      deps
    )
    expect(res.status).toBe(204)
    expect(rows()).toHaveLength(1)
  })

  it('is a server-only table: the desktop migrations never create it', () => {
    expect(MIGRATIONS.some((m) => m.sql.includes('error_reports'))).toBe(false)
    expect(() => migrateServer(db)).not.toThrow()
  })

  describe('admin', () => {
    const admin = (headers: Record<string, string>): Promise<Response> =>
      handle(new Request(BASE + '/admin/errors', { headers }), deps)

    it('is the owner’s only', async () => {
      expect((await admin({})).status).toBe(401)
      expect((await admin({ authorization: 'Bearer tok-desk' })).status).toBe(401)
      expect((await admin({ cookie: 'session=tok-admin' })).status).toBe(200)
      expect((await admin({ authorization: 'Bearer admin-secret' })).status).toBe(200)
    })

    it('groups the latest 200 by message', async () => {
      const add = db.prepare(
        "INSERT INTO error_reports (day, platform, app_version, message, stack) VALUES ('2026-10-31', ?, '1', ?, ?)"
      )
      add.run('web', 'too old to show', null)
      for (let i = 0; i < 199; i++) add.run('desktop', 'common', `s${i}`)
      add.run('phone', 'rare', null)
      const groups = collectErrors(deps)
      expect(groups.map((g) => [g.message, g.count])).toEqual([
        ['rare', 1],
        ['common', 199]
      ])
      expect(groups[0].reports[0]).toEqual({
        day: '2026-10-31',
        platform: 'phone',
        appVersion: '1',
        stack: null
      })
    })

    it('renders report text as text, on the real page and script', async () => {
      const evil = '<img src=x onerror="window.pwned=1">'
      const groups = [
        {
          message: evil,
          count: 2,
          reports: [{ day: '2026-10-31', platform: 'web', appVersion: evil, stack: evil }]
        }
      ]
      const html = await adminPage().text()
      const stats = await handle(
        new Request(BASE + '/admin/stats', { headers: { cookie: 'session=tok-admin' } }),
        deps
      ).then((r) => r.json())
      const dom = new JSDOM(html, {
        url: BASE + '/admin#errors',
        runScripts: 'dangerously',
        beforeParse(window) {
          ;(window as unknown as { fetch: unknown }).fetch = async (path: string) => {
            if (String(path).startsWith('https:')) throw new Error('offline')
            return new Response(JSON.stringify(path === '/admin/errors' ? groups : stats))
          }
        }
      })
      const doc = dom.window.document
      await expect
        .poll(() => doc.querySelector('#errors details'), { timeout: 2000 })
        .not.toBeNull()
      const section = doc.getElementById('errors')!
      expect(section.hidden).toBe(false)
      expect(section.querySelector('img')).toBeNull()
      expect(section.querySelector('summary')!.textContent).toContain(evil)
      expect(section.querySelector('pre')!.textContent).toBe(evil)
      expect((dom.window as unknown as { pwned?: number }).pwned).toBeUndefined()
      expect(html).not.toContain('innerHTML')
      dom.window.close()
    })
  })

  it('the privacy page says what is sent and that the usage setting covers it', () => {
    const html = renderPrivacy({ appUrl: BASE })
    expect(html).toContain('Error reports')
    expect(html).toContain('on unless you turn it off')
    expect(html).toContain('30 days')
    expect(html).toContain('aren’t linked to you')
    expect(html).toContain('so they can’t be traced back to you')
  })
})
