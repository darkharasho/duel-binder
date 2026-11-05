import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const registerSchemesAsPrivileged = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged }, net: {} }))

describe('Rip Replay platform setup', () => {
  // A replay fetches card art into a canvas; a custom scheme without CORS refuses every fetch.
  it('the image scheme allows fetch from the page', async () => {
    const { registerImageScheme } = await import('../../src/main/images/protocol')
    registerImageScheme()
    expect(registerSchemesAsPrivileged.mock.calls[0][0][0].privileges).toMatchObject({
      supportFetchAPI: true,
      corsEnabled: true
    })
  })

  it("the desktop page's CSP lets fetch reach ygo-img:", () => {
    const html = readFileSync('src/renderer/index.html', 'utf8')
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(csp).toMatch(/connect-src [^;]*ygo-img:/)
  })

  // Save Video in the iOS share sheet writes to Photos, which crashes without this key.
  it('iOS says why it adds to Photos', () => {
    const plist = readFileSync('ios/App/App/Info.plist', 'utf8')
    expect(plist).toMatch(/<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>[^<]+<\/string>/)
  })
})
