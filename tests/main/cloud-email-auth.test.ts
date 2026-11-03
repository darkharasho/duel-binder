import { emailAuthRequest, emailSignInEnabled } from '../../src/main/cloud/emailAuth'

const PORTAL = 'https://portal.test'

describe('emailAuthRequest', () => {
  it('posts JSON to the step and returns the reply', async () => {
    const doFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ next: 'password', email: 'a@b.co' })
    )
    const out = await emailAuthRequest(`${PORTAL}/`, 'check', { email: 'a@b.co' }, doFetch)
    expect(out).toEqual({ next: 'password', email: 'a@b.co' })
    const [url, init] = doFetch.mock.calls[0]
    expect(String(url)).toBe(`${PORTAL}/auth/email/check`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.co' })
  })

  it("rejects with the portal's error text", async () => {
    const doFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "That password doesn't match." }, { status: 401 })
    )
    await expect(emailAuthRequest(PORTAL, 'password', {}, doFetch)).rejects.toThrow(
      "That password doesn't match."
    )
  })

  it("rejects with Couldn't reach Duel Binder offline", async () => {
    const doFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(emailAuthRequest(PORTAL, 'check', {}, doFetch)).rejects.toThrow(
      "Couldn't reach Duel Binder"
    )
  })

  it('does not surface the email-off code, or a reply without a step', async () => {
    const off = vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'email-off' }, { status: 404 })
    )
    await expect(emailAuthRequest(PORTAL, 'check', {}, off)).rejects.not.toThrow('email-off')
    const odd = vi.fn<typeof fetch>(async () => Response.json({ hello: 1 }))
    await expect(emailAuthRequest(PORTAL, 'check', {}, odd)).rejects.toThrow()
  })
})

describe('emailSignInEnabled', () => {
  it('reads enabled, and any failure counts as off', async () => {
    expect(await emailSignInEnabled(PORTAL, async () => Response.json({ enabled: true }))).toBe(
      true
    )
    expect(await emailSignInEnabled(PORTAL, async () => Response.json({ enabled: false }))).toBe(
      false
    )
    expect(await emailSignInEnabled(PORTAL, async () => new Response('x', { status: 500 }))).toBe(
      false
    )
    expect(
      await emailSignInEnabled(PORTAL, async () => {
        throw new Error('down')
      })
    ).toBe(false)
  })
})
