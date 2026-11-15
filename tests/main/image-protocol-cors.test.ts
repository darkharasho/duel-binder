import { beforeEach, describe, expect, it, vi } from 'vitest'

let handler: (req: Request) => Promise<Response>
vi.mock('electron', () => ({
  protocol: {
    handle: (_s: string, h: typeof handler) => (handler = h),
    registerSchemesAsPrivileged: vi.fn()
  },
  net: {
    fetch: vi.fn(
      async () => new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' } })
    )
  }
}))

import { handleImageProtocol } from '../../src/main/images/protocol'

describe('ygo-img protocol', () => {
  beforeEach(() => {
    handleImageProtocol({ get: async () => '/tmp/x.jpg' } as never)
  })

  it('lets a canvas read a served image', async () => {
    const res = await handler(new Request('ygo-img://small/46986414'))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.text()).toBe('img')
  })

  it('leaves a 404 alone', async () => {
    handleImageProtocol({ get: async () => null } as never)
    const res = await handler(new Request('ygo-img://small/1'))
    expect(res.status).toBe(404)
  })
})
