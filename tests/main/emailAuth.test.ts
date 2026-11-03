import { describe, expect, it } from 'vitest'
import {
  emailProblem,
  newPasswordProblem,
  normalizeEmail,
  passwordProblem,
  passwordStrength
} from '../../src/shared/emailAuth'

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

describe('new passwords', () => {
  it('needs the confirmation to match', () => {
    expect(newPasswordProblem('hunter22!', 'hunter22!')).toBeNull()
    expect(newPasswordProblem('hunter22!', 'hunter22')).toBe("Passwords don't match")
    expect(newPasswordProblem('hunter22!', '')).toBe("Passwords don't match")
  })
  it('reports length before a mismatch', () => {
    expect(newPasswordProblem('short', 'other')).toBe(passwordProblem('short'))
  })
})

describe('password strength', () => {
  it('is too short under the minimum', () => {
    expect(passwordStrength('abc12!')).toEqual({ score: 0, label: 'Too short' })
  })
  it('calls common and one-note passwords weak', () => {
    expect(passwordStrength('password').label).toBe('Weak')
    expect(passwordStrength('Password1').label).toBe('Weak')
    expect(passwordStrength('12345678').label).toBe('Weak')
    expect(passwordStrength('aaaaaaaaaaaaaaaa').label).toBe('Weak')
    expect(passwordStrength('abcdefgh').label).toBe('Weak')
  })
  it('rewards length and mixed characters', () => {
    expect(passwordStrength('hunter22').label).toBe('Weak')
    expect(passwordStrength('hunter22!x').label).toBe('Okay')
    expect(passwordStrength('blue-river-stone').label).toBe('Okay')
    expect(passwordStrength('Blue-River-Stone-7').label).toBe('Strong')
    expect(passwordStrength('correct horse battery staple').label).toBe('Strong')
  })
  it('scores 1 to 3 above the minimum', () => {
    expect(passwordStrength('password').score).toBe(1)
    expect(passwordStrength('hunter22!x').score).toBe(2)
    expect(passwordStrength('Blue-River-Stone-7').score).toBe(3)
  })
})
