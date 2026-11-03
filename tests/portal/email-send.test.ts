import { describe, expect, it } from 'vitest'
import { changedNotice, codeMessage } from '../../workers/portal/src/emailSend'

describe('branded emails', () => {
  it('puts the code in the subject, the text and a branded html body', () => {
    const m = codeMessage('a@x.io', '123456', 'reset')
    expect(m.subject).toBe('Your Duel Binder code: 123456')
    expect(m.text).toContain('123456')
    expect(m.html).toContain('<h1')
    expect(m.html).toContain('Reset your password')
    expect(m.html).toContain('https://duelbinder.com/apple-touch-icon.png')
    expect(m.html).toContain('>123456</span>')
  })

  it('escapes the new address in the change notice', () => {
    const m = changedNotice('old@x.io', '<b>@x.io')
    expect(m.html).toContain('&lt;b&gt;@x.io')
    expect(m.html).not.toContain('<b>@x.io')
  })
})
