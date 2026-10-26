import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { decodeFingerprints } from '@shared/scan/fingerprintFile'
import type { FingerprintStatus } from '@shared/scan/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** A download that hasn't finished by then is given up on; the file on disk is kept. */
const DOWNLOAD_TIMEOUT_MS = 30_000

interface Meta {
  etag: string | null
  count: number
  checkedAt: string
}

export interface FingerprintStore {
  read(): Promise<ArrayBuffer | null>
  status(): FingerprintStatus
  /** The status after checking the portal; `updated` when it wrote a new file to disk. */
  refresh(opts?: { force?: boolean }): Promise<FingerprintStatus>
}

/** The card-art fingerprint file, downloaded from the portal and kept in `dir` (`<userData>/scan`). */
export function createFingerprintStore(opts: {
  dir: string
  portal: string
  fetch?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}): FingerprintStore {
  const { dir, portal } = opts
  const doFetch = opts.fetch ?? fetch
  const now = opts.now ?? ((): Date => new Date())
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS
  const binPath = join(dir, 'fingerprints.bin')
  const metaPath = join(dir, 'fingerprints.json')

  const loadMeta = (): Meta | null => {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Meta
      const count = decodeFingerprints(readFileSync(binPath)).count
      return { etag: meta.etag ?? null, count, checkedAt: meta.checkedAt }
    } catch {
      return null
    }
  }

  let meta = loadMeta()
  let downloading = false
  let failed = false
  let inFlight: Promise<FingerprintStatus> | null = null

  const status = (): FingerprintStatus => {
    if (meta) return { state: 'ready', count: meta.count }
    if (downloading) return { state: 'downloading', count: 0 }
    return { state: failed ? 'error' : 'missing', count: 0 }
  }

  const saveMeta = (next: Meta): void => {
    writeFileSync(metaPath, JSON.stringify(next))
    meta = next
  }

  /** Resolves true when it wrote a new file. */
  async function download(): Promise<boolean> {
    const headers: Record<string, string> = meta?.etag ? { 'If-None-Match': meta.etag } : {}
    // The timeout covers the body too: arrayBuffer() rejects once the signal aborts.
    const res = await doFetch(`${portal}/scan/fingerprints`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (res.status === 404) return false
    if (res.status === 304 && meta) {
      saveMeta({ ...meta, checkedAt: now().toISOString() })
      return false
    }
    if (!res.ok) throw new Error(`Fingerprint download failed (${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const count = decodeFingerprints(bytes).count
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${binPath}.tmp`, bytes)
    renameSync(`${binPath}.tmp`, binPath)
    saveMeta({ etag: res.headers.get('ETag'), count, checkedAt: now().toISOString() })
    return true
  }

  /** The file on disk went bad: forget it, so the next refresh downloads a fresh one. */
  const forget = (): void => {
    meta = null
    rmSync(metaPath, { force: true })
  }

  return {
    status,
    async read() {
      if (!meta) return null
      try {
        const buf = await readFile(binPath)
        const bytes = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength
        ) as ArrayBuffer
        decodeFingerprints(bytes)
        return bytes
      } catch {
        forget()
        return null
      }
    },
    refresh({ force = false } = {}) {
      if (inFlight) return inFlight
      if (!force && meta && now().getTime() - Date.parse(meta.checkedAt) < DAY_MS) {
        return Promise.resolve(status())
      }
      downloading = true
      failed = false
      inFlight = download()
        .catch(() => {
          failed = true
          return false
        })
        .then((updated) => {
          downloading = false
          inFlight = null
          return updated ? { ...status(), updated: true } : status()
        })
      return inFlight
    }
  }
}
