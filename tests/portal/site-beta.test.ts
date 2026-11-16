import { describe, expect, it } from 'vitest'
import { handleSite } from '../../workers/portal/src/site/handler'
import { renderPage } from '../../workers/portal/src/site/page'
import { pickDownloads } from '../../workers/portal/src/site/releases'
import { WASHES } from '../../workers/portal/src/site/washes'
import { releaseV021 } from './fixtures/release'

const appUrl = 'https://app.test'
const deps = {
  appUrl,
  assets: { fetch: async () => new Response('asset', { status: 404 }) },
  downloads: async () => pickDownloads(releaseV021)
}
const get = async (path: string): Promise<{ status: number; body: string }> => {
  const res = await handleSite(new Request('https://site.test' + path), deps)
  return { status: res.status, body: await res.text() }
}

describe('beta page', () => {
  it('serves the disclaimer and a form that posts to the app', async () => {
    const { status, body } = await get('/beta')
    expect(status).toBe(200)
    expect(body).toContain(`<form method="post" action="${appUrl}/beta"`)
    expect(body).toMatch(/<input[^>]*name="agree"[^>]*required/)
    expect(body).toContain('value="android"')
    expect(body).toContain('value="ios"')
    expect(body).toMatch(/<input[^>]*name="email"[^>]*type="email"[^>]*required/)
    expect(body).toMatch(/<input[^>]*name="name"[^>]*required/)
    expect(body).toContain('name="referred"')
    expect(body).toMatch(/<input[^>]*name="website"[^>]*tabindex="-1"/)
    expect(body).toContain('may crash')
    expect(body).toContain('not synced yet')
    expect(body).toContain('only to invite you through Google or Apple')
  })

  it('thanks the person after sending, without the form', async () => {
    const { body } = await get('/beta?sent=1')
    expect(body).toContain("you'll get an email when you're in")
    expect(body).not.toContain('<form')
  })

  it('explains each error above the form', async () => {
    const messages: Record<string, string> = {
      agree: 'Tick the box',
      platform: 'Pick Android or iPhone',
      email: 'That email doesn',
      name: 'Add your name',
      referred: 'shorter',
      limit: 'Too many requests',
      nonsense: 'Something went wrong'
    }
    for (const [code, text] of Object.entries(messages)) {
      const { body } = await get(`/beta?error=${code}`)
      expect(body).toContain(text)
      expect(body).toContain('<form')
    }
  })

  it("links from the home page's Phone section", () => {
    const html = renderPage({
      downloads: pickDownloads(releaseV021),
      os: null,
      android: false,
      appUrl,
      wash: WASHES[0]
    })
    expect(html).toContain('<a href="/beta">Join the beta</a>')
  })
})
