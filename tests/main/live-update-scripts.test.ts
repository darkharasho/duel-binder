import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signedMessage, type ManifestEntry } from '../../src/shared/appBundles'
import { fingerprint } from '../../scripts/live-update/fingerprint'
import { buildManifest, sign } from '../../scripts/live-update/publish'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('live update scripts', () => {
  it('fingerprint changes with a plugin version', () => {
    const files = [{ path: 'a.swift', bytes: enc('x') }]
    const a = fingerprint(files, { '@capgo/capacitor-updater': '8.0.0' })
    const b = fingerprint(files, { '@capgo/capacitor-updater': '8.0.1' })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('fingerprint ignores file order', () => {
    const f1 = { path: 'a', bytes: enc('1') }
    const f2 = { path: 'b', bytes: enc('2') }
    expect(fingerprint([f1, f2], {})).toBe(fingerprint([f2, f1], {}))
  })

  it('buildManifest lists nested files with sha256', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lu-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), 'hi')
    writeFileSync(join(dir, 'assets', 'a.js'), 'js')
    writeFileSync(join(dir, 'ota-builtin-hashes.json'), '{}')
    const m = buildManifest(dir, 'https://x.test')
    const h = (s: string): string => createHash('sha256').update(s).digest('hex')
    expect(m.map((e) => e.file_name).sort()).toEqual(['assets/a.js', 'index.html'])
    const a = m.find((e) => e.file_name === 'assets/a.js')!
    expect(a.file_hash).toBe(h('js'))
    expect(a.download_url).toBe(`https://x.test/api/app-bundles/files/${h('js')}`)
  })

  it('sign output verifies with WebCrypto against signedMessage', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const manifest: ManifestEntry[] = [{ file_name: 'index.html', file_hash: 'ab', download_url: 'u' }]
    const msg = signedMessage('ios', '1.2.3', manifest)
    const sig = Buffer.from(sign(msg, pem), 'base64url')
    const key = await crypto.subtle.importKey(
      'spki',
      publicKey.export({ type: 'spki', format: 'der' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, msg)).toBe(true)
  })
})
