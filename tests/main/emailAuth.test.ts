import { describe, expect, it } from 'vitest'
import { emailProblem, normalizeEmail, passwordProblem } from '../../src/shared/emailAuth'

describe('email rules', () => {
  it('normalizes by trimming and lowercasing only', () => {
    expect(normalizeEmail(' Ann@Example.COM ')).toBe('ann@example.com')
    expect(normalizeEmail('a.b+c@x.io')).toBe('a.b+c@x.io')
  })
  it('rejects bad addresses', () => {
    expect(emailProblem('a@b.co')).toBeNull()
    expect(emailProblem('a@b')).toBe('Enter a valid email address')
    expect(emailProblem('a b@c.d')).not.toBeNull()
    expect(emailProblem('a'.repeat(243) + '@example.com')).not.toBeNull() // 255 chars
    expect(emailProblem('a'.repeat(242) + '@example.com')).toBeNull() // 254 chars
  })
  it('limits passwords to 8..128', () => {
    expect(passwordProblem('x'.repeat(7))).toBe('Passwords are at least 8 characters')
    expect(passwordProblem('x'.repeat(8))).toBeNull()
    expect(passwordProblem('x'.repeat(128))).toBeNull()
    expect(passwordProblem('x'.repeat(129))).toBe('Passwords are at most 128 characters')
  })
})
