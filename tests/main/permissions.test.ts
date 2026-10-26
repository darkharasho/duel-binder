import { describe, expect, it, vi } from 'vitest'
import { isAppUrl, restrictPermissions } from '../../src/main/permissions'

type RequestHandler = (
  wc: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string; mediaTypes?: string[] }
) => void
type CheckHandler = (
  wc: unknown,
  permission: string,
  origin: string,
  details: { mediaType?: string }
) => boolean

function handlers(devUrl: string | undefined): { request: RequestHandler; check: CheckHandler } {
  let request: RequestHandler = () => {}
  let check: CheckHandler = () => true
  restrictPermissions(
    {
      setPermissionRequestHandler: (h: unknown) => (request = h as RequestHandler),
      setPermissionCheckHandler: (h: unknown) => (check = h as CheckHandler)
    } as never,
    devUrl
  )
  return { request, check }
}

const ask = (
  request: RequestHandler,
  permission: string,
  url: string,
  mediaTypes = ['video']
): boolean => {
  const cb = vi.fn()
  request(null, permission, cb, { requestingUrl: url, mediaTypes })
  return cb.mock.calls[0][0] as boolean
}

describe('restrictPermissions', () => {
  it('grants the camera to the bundled pages only', () => {
    const { request, check } = handlers(undefined)
    expect(ask(request, 'media', 'file:///app/out/renderer/index.html')).toBe(true)
    expect(ask(request, 'media', 'https://evil.example/')).toBe(false)
    expect(ask(request, 'media', 'file:///app/index.html', ['video', 'audio'])).toBe(false)
    expect(ask(request, 'notifications', 'file:///app/index.html')).toBe(false)
    expect(check(null, 'media', 'file:///', { mediaType: 'video' })).toBe(true)
    expect(check(null, 'media', 'file:///', { mediaType: 'audio' })).toBe(false)
    expect(check(null, 'media', 'https://evil.example', { mediaType: 'video' })).toBe(false)
    expect(check(null, 'geolocation', 'file:///', {})).toBe(false)
  })

  it('in dev, grants it to the dev server origin only', () => {
    const { request, check } = handlers('http://localhost:5173')
    expect(ask(request, 'media', 'http://localhost:5173/#scan')).toBe(true)
    expect(ask(request, 'media', 'http://localhost:5174/')).toBe(false)
    expect(ask(request, 'media', 'file:///tmp/x.html')).toBe(false)
    expect(check(null, 'media', 'http://localhost:5173', { mediaType: 'video' })).toBe(true)
  })

  it('rejects unparseable urls', () => {
    expect(isAppUrl('not a url', undefined)).toBe(false)
  })
})
