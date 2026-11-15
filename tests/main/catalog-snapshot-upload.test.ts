import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { uploadSnapshot } from '../../scripts/catalog/snapshotUpload'
import { catalogShape, snapshotFileKey } from '../../src/shared/catalogSnapshot'

const BYTES = Buffer.from('0123456789abcdefghijklmno') // 25 bytes

function file(): string {
  const f = join(mkdtempSync(join(tmpdir(), 'snap-up-')), 'mtg.sqlite.gz')
  writeFileSync(f, BYTES)
  return f
}

type Call = { method: string; path: string; body?: string | number; auth: string | null }

function portal(failPart?: number): { calls: Call[]; fetchFn: typeof fetch } {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = init.body
    const call: Call = {
      method,
      path: url.pathname + url.search,
      auth: new Headers(init.headers).get('authorization')
    }
    if (body instanceof Uint8Array) call.body = body.byteLength
    else if (typeof body === 'string') call.body = body
    calls.push(call)
    if (url.pathname.endsWith('/upload') && method === 'POST')
      return Response.json({ uploadId: 'u1' })
    if (url.pathname.endsWith('/upload') && method === 'PUT') {
      const part = Number(url.searchParams.get('part'))
      if (part === failPart) return new Response('boom', { status: 500 })
      return Response.json({ etag: `e${part}` })
    }
    return Response.json({ ok: true })
  }) as typeof fetch
  return { calls, fetchFn }
}

const base = {
  game: 'mtg' as const,
  shape: catalogShape(),
  cursor: 42,
  dbVersion: 'v7',
  builtAt: '2026-11-15T00:00:00.000Z'
}

describe('uploadSnapshot', () => {
  it('uploads in parts then publishes the manifest', async () => {
    const { calls, fetchFn } = portal()
    const key = snapshotFileKey('mtg', base.shape, 42)
    const m = await uploadSnapshot({
      portalUrl: 'https://portal.test/',
      token: 'admin',
      file: file(),
      manifest: base,
      fetchFn,
      partBytes: 10
    })
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'POST /api/admin/catalog-snapshot/upload',
      'PUT /api/admin/catalog-snapshot/upload',
      'PUT /api/admin/catalog-snapshot/upload',
      'PUT /api/admin/catalog-snapshot/upload',
      'POST /api/admin/catalog-snapshot/complete',
      'PUT /api/admin/catalog-snapshot/manifest'
    ])
    expect(calls.every((c) => c.auth === 'Bearer admin')).toBe(true)
    expect(calls.slice(1, 4).map((c) => c.body)).toEqual([10, 10, 5])
    expect(calls[1].path).toContain('part=1')
    expect(JSON.parse(calls[4].body as string)).toEqual({
      parts: [
        { partNumber: 1, etag: 'e1' },
        { partNumber: 2, etag: 'e2' },
        { partNumber: 3, etag: 'e3' }
      ]
    })
    expect(m).toEqual({
      ...base,
      key,
      bytes: 25,
      sha256: createHash('sha256').update(BYTES).digest('hex')
    })
    expect(JSON.parse(calls[5].body as string)).toEqual(m)
  })

  it('stops before publishing when a part fails', async () => {
    const { calls, fetchFn } = portal(2)
    await expect(
      uploadSnapshot({
        portalUrl: 'https://portal.test',
        token: 'admin',
        file: file(),
        manifest: base,
        fetchFn,
        partBytes: 10
      })
    ).rejects.toThrow('500')
    expect(calls.some((c) => c.path.includes('/manifest'))).toBe(false)
    expect(calls.some((c) => c.path.includes('/complete'))).toBe(false)
  })
})
