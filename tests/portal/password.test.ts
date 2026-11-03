import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../workers/portal/src/password'

describe('passwords', () => {
  it('hashes verify and differ per salt', async () => {
    const a = await hashPassword('hunter2hunter2')
    const b = await hashPassword('hunter2hunter2')
    expect(a).not.toBe(b)
    expect(await verifyPassword('hunter2hunter2', a)).toBe(true)
    expect(await verifyPassword('hunter2hunter2', b)).toBe(true)
  })
  it('a wrong password fails', async () => {
    expect(await verifyPassword('nope-nope-nope', await hashPassword('hunter2hunter2'))).toBe(false)
  })
  it('the stored format names its iterations', async () => {
    expect(await hashPassword('hunter2hunter2')).toMatch(/^pbkdf2-sha256\$100000\$[\w-]+\$[\w-]+$/)
  })
  it('a malformed stored hash verifies false', async () => {
    for (const s of ['', 'garbage', 'pbkdf2-sha256$x$a$b', 'md5$100000$a$b', 'pbkdf2-sha256$100000$a'])
      expect(await verifyPassword('hunter2hunter2', s)).toBe(false)
  })
})
