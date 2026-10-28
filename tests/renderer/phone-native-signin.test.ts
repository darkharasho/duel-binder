import { createHash } from 'node:crypto'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { nativeSignIn, SignInCancelled } from '../../src/phone/nativeSignIn'

const USER = { id: 1, username: 'kaiba', displayName: 'Seto', avatarUrl: null }

type Start = (o: { url: string; callbackScheme: string }) => Promise<{ url: string }>
type TokenFetch = (url: string, init?: RequestInit) => Promise<Response>

/** A sign-in sheet that ends on the app's scheme with `params` (the start URL's state, unless given). */
function sheet(params: Record<string, string> = { code: 'c0de' }): Mock<Start> {
  return vi.fn<Start>(async ({ url }) => {
    const state = new URL(url, 'https://portal.test').searchParams.get('state')!
    return { url: `duelbinder://auth/callback?${new URLSearchParams({ state, ...params })}` }
  })
}
const tokenFetch = (status = 200): Mock<TokenFetch> =>
  vi.fn<TokenFetch>(
    async () => new Response(JSON.stringify({ token: 'tok', user: USER }), { status })
  )

describe('nativeSignIn', () => {
  it('opens the iOS desktop flow and trades the code with its PKCE verifier', async () => {
    const start = sheet()
    const fetch = tokenFetch()
    const result = await nativeSignIn({ start, fetch: fetch as unknown as typeof globalThis.fetch })
    expect(result).toEqual({ token: 'tok', user: USER })

    const opened = start.mock.calls[0][0]
    expect(opened.callbackScheme).toBe('duelbinder')
    const startUrl = new URL(opened.url, 'https://portal.test')
    expect(startUrl.pathname).toBe('/auth/desktop/start')
    expect(startUrl.searchParams.get('app')).toBe('ios')
    expect(startUrl.searchParams.has('port')).toBe(false)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/auth/desktop/token')
    const body = JSON.parse(init!.body as string) as { code: string; verifier: string }
    expect(body.code).toBe('c0de')
    expect(createHash('sha256').update(body.verifier).digest('base64url')).toBe(
      startUrl.searchParams.get('challenge')
    )
  })

  it('refuses a callback for another state, an error or a failed trade', async () => {
    const fetch = tokenFetch() as unknown as typeof globalThis.fetch
    await expect(
      nativeSignIn({ start: sheet({ state: 'other', code: 'c' }), fetch })
    ).rejects.toThrow('signin-failed')
    await expect(nativeSignIn({ start: sheet({ error: 'signin-failed' }), fetch })).rejects.toThrow(
      'signin-failed'
    )
    await expect(
      nativeSignIn({ start: sheet(), fetch: tokenFetch(400) as unknown as typeof globalThis.fetch })
    ).rejects.toThrow('signin-failed')
  })

  it('a closed sheet is a cancel, not a failure', async () => {
    const start = vi.fn(async () => {
      throw Object.assign(new Error('closed'), { code: 'CANCELLED' })
    })
    await expect(nativeSignIn({ start })).rejects.toBeInstanceOf(SignInCancelled)
  })
})
