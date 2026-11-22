import { describe, expect, it } from 'vitest'
import { adminPage } from '../../workers/portal/src/adminPage'
import { withGameAccess } from '../fixtures/ownerOnlyGame'

withGameAccess('mtg', 'testers')
withGameAccess('op', 'testers')

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

  it('has a Beta tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('href="#beta"')
    expect(html).toContain('id="beta"')
    expect(html).toContain("'beta'")
    expect(html).toContain("fetch('/admin/beta'")
    expect(html).toContain("fetch('/admin/beta/decide'")
    expect(html).toContain("fetch('/admin/beta/delete'")
    // A refused clipboard write falls back to showing the emails to copy by hand.
    expect(html).toContain("prompt('Copy these emails:'")
    expect(html).toContain('of 12')
  })

  it('has a Terms tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('href="#terms"')
    expect(html).toContain('id="terms"')
    expect(html).toContain("'/admin/terms?status='")
    expect(html).toContain("'/admin/terms/decide'")
    expect(html).toContain("'/admin/terms/add'")
    expect(html).toContain('actions/workflows/terms.yml')
    expect(html).toContain('Sets need language:Set name')
    // A Rejected list with Restore, a confirm on Reject and Remove, and clash text naming the status.
    expect(html).toContain("['rejected', 'Rejected']")
    expect(html).toContain("el('button', 'Restore')")
    expect(html).toContain("confirm('Reject \"' + t.phrase")
    expect(html).toContain("confirm('Remove \"' + t.phrase")
    expect(html).toContain(
      'already used by a rejected term in this game. Restore it from the Rejected list.'
    )
    // Phrases and eBay titles are set as text only.
    expect(html).not.toMatch(/innerHTML/)
  })

  it('has a Photos tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('href="#photos"')
    expect(html).toContain('id="photos"')
    expect(html).toContain("fetch('/admin/training'")
    expect(html).toContain('"bare":"Bare"')
  })

  it('has a Costs tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('href="#costs"')
    expect(html).toContain('id="costs"')
    expect(html).toContain("fetch('/admin/costs?days='")
  })

  it('ships a script that parses', async () => {
    const html = await adminPage().text()
    const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1]
    expect(() => new Function(script)).not.toThrow()
  })
})
