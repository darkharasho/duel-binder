import { describe, expect, it } from 'vitest'
import {
  MAX_ERRORS_PER_SESSION,
  MAX_ERROR_MESSAGE,
  MAX_ERROR_STACK,
  checkErrorReport,
  createErrorGate,
  describeError,
  scrubErrorDetails
} from '../../src/shared/errorReports'

const scrub = (message: string, stack?: string): { message: string; stack?: string } =>
  scrubErrorDetails({ appVersion: '1.0.0', message, stack })
const text = (s: string): string => scrub(s).message

describe('scrubErrorDetails', () => {
  it.each([
    ['/home/alice/.config/Duel Binder/collection.db', '/home/~/.config/Duel Binder/collection.db'],
    ['/var/home/alice/app/main.js:10:4', '/var/home/~/app/main.js:10:4'],
    ['/Users/alice/Library/Logs/x.log', '/Users/~/Library/Logs/x.log'],
    ['/Users/Alice Smith/Library/x', '/Users/~/Library/x'],
    ['C:\\Users\\alice\\AppData\\Roaming\\x.db', 'C:\\Users\\~\\AppData\\Roaming\\x.db'],
    ['C:\\Users\\Alice Smith\\AppData\\x.db', 'C:\\Users\\~\\AppData\\x.db'],
    ['c:\\users\\alice\\x', 'c:\\users\\~\\x'],
    ['C:\\\\Users\\\\alice\\\\x', 'C:\\\\Users\\\\~\\\\x'],
    ['file:///C:/Users/Alice%20Smith/x.js', 'file:///C:/Users/~/x.js'],
    ['/mnt/c/Users/alice/x', '/mnt/c/Users/~/x']
  ])('takes the user out of %s', (input, want) => {
    expect(text(input)).toBe(want)
  })

  it('cleans a real-shaped stack, a home folder at every frame', () => {
    const stack = [
      "Error: ENOENT: no such file or directory, open '/home/alice/.config/db'",
      '    at readFile (node:fs:441:20)',
      '    at load (/home/alice/app/out/main/index.js:120:9)',
      '    at C:\\Users\\Alice Smith\\AppData\\Local\\app\\index.js:3:1'
    ].join('\n')
    const out = scrub('x', stack).stack!
    expect(out).not.toMatch(/alice/i)
    expect(out).toContain('at readFile (node:fs:441:20)')
    expect(out).toContain('(/home/~/app/out/main/index.js:120:9)')
  })

  it.each([
    'mail jane.doe+cards@example.co.uk failed',
    'Refused: USER_99@mail.example.com',
    'to <jane@example.com>'
  ])('redacts the email in %s', (input) => {
    const out = text(input)
    expect(out).toContain('[email]')
    expect(out).not.toMatch(/example|jane|USER_99/)
  })

  it.each([
    // A portal session token: 32 random bytes, base64url.
    ['session pV3kQ9zT1xYb7Lm2Nc8Rf4Ws6Jd0HgAe5UoIy-_ZtMk', 'pV3kQ9zT1xYb'],
    ['Authorization: Bearer abc.DEF-123_456', 'abc.DEF'],
    ['bearer dGhpc2lzYXRva2Vu==', 'dGhpc2lz'],
    ['GET https://app.test/x?token=s3cret&page=2', 's3cret'],
    ['{"access_token":"s3cret"}', 's3cret'],
    ['refresh_token: s3cret', 's3cret'],
    ['api_key=s3cret', 's3cret'],
    ['password="hunter2"', 'hunter2'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'eyJhbGci'],
    ['hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081'],
    ['id 123e4567-e89b-12d3-a456-426614174000', '123e4567'],
    ['discord user 123456789012345678', '123456789012345678']
  ])('redacts the secret in %s', (input, secret) => {
    expect(text(input)).not.toContain(secret)
  })

  it('leaves an ordinary error readable', () => {
    for (const s of [
      "Cannot read properties of undefined (reading 'quantity')",
      'SQLITE_CONSTRAINT: UNIQUE constraint failed: collection_entries.uid',
      'getCollectionEntriesForActiveGameAndLanguage is not a function',
      'at index-BxK3a9Zq.js:12:345',
      'Error 503 at 2026-10-31'
    ])
      expect(text(s)).toBe(s)
  })

  it('caps the text, and scrubs before it cuts so half a secret never survives', () => {
    const long = scrub('a '.repeat(2000) + 'jane@example.com', 'b '.repeat(9000))
    expect(long.message.length).toBeLessThanOrEqual(MAX_ERROR_MESSAGE)
    expect(long.stack!.length).toBeLessThanOrEqual(MAX_ERROR_STACK)

    const edge = 'x '.repeat(245) + 'jane.doe@example.com'
    expect(text(edge)).not.toContain('jane')
  })

  it('runs twice to the same result, as the portal repeats it', () => {
    const once = scrub('jane@example.com at /home/alice/x token=abc', 'Bearer abc123')
    expect(scrubErrorDetails({ appVersion: '1', ...once })).toEqual({ appVersion: '1', ...once })
  })

  it('stays fast on a hostile string', () => {
    const start = performance.now()
    scrub('a-'.repeat(50_000), '/home/'.repeat(50_000))
    expect(performance.now() - start).toBeLessThan(1000)
  })
})

describe('checkErrorReport', () => {
  const good = { platform: 'desktop', appVersion: '1.2.3', message: 'boom', stack: 'at x' }

  it('keeps only the known fields', () => {
    expect(checkErrorReport({ ...good, userId: 7, email: 'a@b.co', page: 'sets' })).toEqual(good)
    const bare = { platform: 'web', appVersion: 'web', message: 'boom' }
    expect(checkErrorReport(bare)).toEqual(bare)
  })

  it.each([
    [null],
    [[]],
    [{ ...good, platform: 'tv' }],
    [{ ...good, appVersion: '' }],
    [{ ...good, appVersion: 'v'.repeat(33) }],
    [{ ...good, appVersion: 1 }],
    [{ ...good, message: '' }],
    [{ ...good, message: 'm'.repeat(MAX_ERROR_MESSAGE + 1) }],
    [{ ...good, stack: 's'.repeat(MAX_ERROR_STACK + 1) }],
    [{ ...good, stack: 5 }]
  ])('refuses %j', (body) => {
    expect(() => checkErrorReport(body)).toThrow()
  })
})

describe('createErrorGate', () => {
  it('passes an identical error once, and stops at the session cap', () => {
    const pass = createErrorGate()
    expect(pass('a', 's')).toBe(true)
    expect(pass('a', 's')).toBe(false)
    expect(pass('a', 'other')).toBe(true)
    for (let i = 2; i < MAX_ERRORS_PER_SESSION; i++) expect(pass(`e${i}`)).toBe(true)
    expect(pass('one more')).toBe(false)
  })
})

describe('describeError', () => {
  it('reads errors and other values, and survives a hostile one', () => {
    expect(describeError(new TypeError('bad')).message).toBe('bad')
    expect(describeError('plain')).toEqual({ message: 'plain' })
    const hostile = {
      toString() {
        throw new Error('no')
      }
    }
    expect(describeError(hostile)).toEqual({ message: 'Unknown error' })
  })
})
