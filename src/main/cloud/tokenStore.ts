import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

/** Each value is base64 of the cipher's bytes; nothing is stored in plain text. */
interface FileShape {
  token?: string
  revoke?: string[]
}

/**
 * Production cipher backed by Electron safeStorage, imported lazily so plain-node tooling
 * never loads electron. encryptString/decryptString are called unconditionally: on Linux
 * without a keyring safeStorage falls back to basic_text, which is accepted.
 */
export async function electronCipher(): Promise<Cipher> {
  const { safeStorage } = await import('electron')
  return {
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (buf) => safeStorage.decryptString(buf)
  }
}

/** The desktop token, and old tokens still waiting to be revoked, in `<userData>/account.json`. */
export class TokenStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher
  ) {}

  get(): string | null {
    const stored = this.read().token
    return stored === undefined ? null : this.decrypt(stored)
  }

  set(token: string): void {
    const data = this.read()
    data.token = this.encrypt(token)
    this.write(data)
  }

  clear(): void {
    const data = this.read()
    delete data.token
    this.write(data)
  }

  pendingRevokes(): string[] {
    const out: string[] = []
    for (const stored of this.read().revoke ?? []) {
      const token = this.decrypt(stored)
      if (token !== null && !out.includes(token)) out.push(token)
    }
    return out
  }

  addPendingRevoke(token: string): void {
    const data = this.read()
    const revoke = data.revoke ?? []
    if (revoke.some((stored) => this.decrypt(stored) === token)) return
    data.revoke = [...revoke, this.encrypt(token)]
    this.write(data)
  }

  removePendingRevoke(token: string): void {
    const data = this.read()
    if (!data.revoke) return
    // Values that won't decrypt are kept: the keyring may only be unavailable for now.
    data.revoke = data.revoke.filter((stored) => this.decrypt(stored) !== token)
    if (data.revoke.length === 0) delete data.revoke
    this.write(data)
  }

  private encrypt(plain: string): string {
    return this.cipher.encrypt(plain).toString('base64')
  }

  /** Null when the value won't decrypt (another machine's keyring, a damaged file). */
  private decrypt(stored: string): string | null {
    try {
      return this.cipher.decrypt(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      // A corrupt or truncated file reads as signed out rather than wedging every access.
      return {}
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const raw = parsed as Record<string, unknown>
    const data: FileShape = {}
    if (typeof raw.token === 'string') data.token = raw.token
    if (Array.isArray(raw.revoke)) {
      data.revoke = raw.revoke.filter((v): v is string => typeof v === 'string')
    }
    return data
  }

  private write(data: FileShape): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600 })
    chmodSync(this.path, 0o600)
  }
}
