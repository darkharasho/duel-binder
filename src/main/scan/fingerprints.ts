import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { decodeFingerprints } from '@shared/scan/fingerprintFile'
import { parseFingerprintRefs, type FingerprintRefsFile } from '@shared/scan/fingerprintRefs'
import type { FingerprintStatus } from '@shared/scan/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** A download that hasn't finished by then is given up on; the file on disk is kept. */
const DOWNLOAD_TIMEOUT_MS = 30_000

interface Meta {
  etag: string | null
  count: number
  checkedAt: string
  /** The refs file's ETag; absent until one is downloaded. */
  refsEtag?: string | null
}

export interface FingerprintStore {
  read(): Promise<ArrayBuffer | null>
  /** The fingerprint refs file on disk (see fingerprintRefs.ts), or null when there is none. */
  readRefs(): Promise<FingerprintRefsFile | null>
  status(): FingerprintStatus
  /** The status after checking the portal; `updated` when it wrote a new file to disk. */
  refresh(opts?: { force?: boolean }): Promise<FingerprintStatus>
}

/**
 * The card-art fingerprint file, downloaded from the portal and kept in `dir` (`<userData>/scan`),
 * with the refs file that says which printings its printing scans show. The refs are extras: a
 * portal without them, or trouble getting them, leaves the fingerprints as they would be alone.
 */
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
  const refsPath = join(dir, 'fingerprint-refs.json')

  const loadMeta = (): Meta | null => {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Meta
      const count = decodeFingerprints(readFileSync(binPath)).count
      return {
        etag: meta.etag ?? null,
        count,
        checkedAt: meta.checkedAt,
        refsEtag: meta.refsEtag ?? null
      }
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
    const wrote = await downloadFingerprints()
    // Only beside a fingerprint file, and never failing the refresh.
    const wroteRefs = meta ? await downloadRefs().catch(() => false) : false
    return wrote || wroteRefs
  }

  /** Resolves true when it wrote a new refs file. */
  async function downloadRefs(): Promise<boolean> {
    const etag = meta?.refsEtag
    const headers: Record<string, string> =
      etag && existsSync(refsPath) ? { 'If-None-Match': etag } : {}
    const res = await doFetch(`${portal}/scan/fingerprint-refs`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
      await res.body?.cancel()
      return false
    }
    const text = await res.text()
    parseFingerprintRefs(text)
    writeFileSync(`${refsPath}.tmp`, text)
    renameSync(`${refsPath}.tmp`, refsPath)
    if (meta) saveMeta({ ...meta, refsEtag: res.headers.get('ETag') })
    return true
  }

  /** Resolves true when it wrote a new fingerprint file. */
  async function downloadFingerprints(): Promise<boolean> {
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
    saveMeta({ ...meta, etag: res.headers.get('ETag'), count, checkedAt: now().toISOString() })
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
    async readRefs() {
      try {
        return parseFingerprintRefs(await readFile(refsPath, 'utf8'))
      } catch {
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
