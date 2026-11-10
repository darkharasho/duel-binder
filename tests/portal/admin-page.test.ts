import { describe, expect, it } from 'vitest'
import { adminPage } from '../../workers/portal/src/adminPage'

describe('admin page', () => {
  it('has a Testers tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('href="#testers"')
    expect(html).toContain('id="testers"')
    expect(html).toContain("fetch('/admin/testers'")
    // The panel lists the testers-only game, and its script stays free of inline handlers.
    expect(html).toContain('"name":"One Piece"')
    expect(html).toContain('"name":"Magic"')
    expect(html).not.toMatch(/ on(click|submit)=/)
  })

  it('has a Photos tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('href="#photos"')
    expect(html).toContain('id="photos"')
    expect(html).toContain("fetch('/admin/training'")
    expect(html).toContain('"bare":"Bare"')
  })

  it('ships a script that parses', async () => {
    const html = await adminPage().text()
    const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1]
    expect(() => new Function(script)).not.toThrow()
  })
})
