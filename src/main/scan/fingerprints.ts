import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { decodeFingerprints } from '@shared/scan/fingerprintFile'
import type { GameId } from '@shared/games'
import { parseFingerprintRefs, type FingerprintRefsFile } from '@shared/scan/fingerprintRefs'
import type { FingerprintStatus } from '@shared/scan/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** A download that hasn't finished by then is given up on; the file on disk is kept. */
const DOWNLOAD_TIMEOUT_MS = 30_000

interface Meta {
  etag: string | null
  count: number
  checkedAt: string
  /**
   * The refs file's ETag: null once asked for and the portal had none (or gave none), absent
   * until asked for (an install from before the refs), which asks within the day.
   */
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
 * One game's card-art fingerprint file, downloaded from the portal and kept in `dir`
 * (`<userData>/scan`). Yu-Gi-Oh!'s files keep their original names. Yu-Gi-Oh!'s comes with the refs
 * file that says which printings its printing scans show. The refs are extras: a portal without
 * them, or trouble getting them, leaves the fingerprints as they would be alone.
 */
export function createFingerprintStore(opts: {
  dir: string
  portal: string
  game: GameId
  fetch?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}): FingerprintStore {
  const { dir, portal, game } = opts
  const doFetch = opts.fetch ?? fetch
  const now = opts.now ?? ((): Date => new Date())
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS
  const stem = game === 'ygo' ? 'fingerprints' : `fingerprints-${game}`
  const url =
    game === 'ygo' ? `${portal}/scan/fingerprints` : `${portal}/scan/fingerprints?game=${game}`
  const binPath = join(dir, `${stem}.bin`)
  const metaPath = join(dir, `${stem}.json`)
  const refsPath = join(dir, 'fingerprint-refs.json')
  // Printing scans, and so refs, are Yu-Gi-Oh's only.
  const hasRefs = game === 'ygo'

  const loadMeta = (): Meta | null => {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Meta
      const count = decodeFingerprints(readFileSync(binPath)).count
      return {
        etag: meta.etag ?? null,
        count,
        checkedAt: meta.checkedAt,
        refsEtag: meta.refsEtag
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
    const wroteRefs = meta && hasRefs ? await downloadRefs().catch(() => false) : false
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
      // None on the portal yet: asked, so the daily check asks again rather than every refresh.
      if (res.status === 404 && meta && meta.refsEtag === undefined)
        saveMeta({ ...meta, refsEtag: null })
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
    const res = await doFetch(url, {
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
      if (!hasRefs) return null
      try {
        return parseFingerprintRefs(await readFile(refsPath, 'utf8'))
      } catch {
        return null
      }
    },
    refresh({ force = false } = {}) {
      if (inFlight) return inFlight
      const fresh = !force && meta && now().getTime() - Date.parse(meta.checkedAt) < DAY_MS
      // An install from before the refs gets them now, not at its next daily check.
      if (fresh && (!hasRefs || meta!.refsEtag !== undefined)) return Promise.resolve(status())
      downloading = true
      failed = false
      inFlight = (fresh ? downloadRefs().catch(() => false) : download())
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
