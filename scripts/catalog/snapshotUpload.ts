import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { snapshotFileKey, type SnapshotManifest } from '../../src/shared/catalogSnapshot'

/** R2 multipart parts must be at least 5 MB (all but the last); Worker request bodies stay well under 100 MB. */
const PART_BYTES = 50 * 1024 * 1024

/**
 * Uploads a gzipped snapshot to the portal in parts (admin token), then publishes its manifest.
 * Nothing is published unless every part and the completion went through. Resolves to the
 * manifest as published.
 */
export async function uploadSnapshot(opts: {
  portalUrl: string
  token: string
  file: string
  manifest: Omit<SnapshotManifest, 'key' | 'bytes' | 'sha256'>
  fetchFn?: typeof fetch
  partBytes?: number
}): Promise<SnapshotManifest> {
  const fetchFn = opts.fetchFn ?? fetch
  const base = opts.portalUrl.replace(/\/+$/, '')
  const partBytes = opts.partBytes ?? PART_BYTES
  const { game, shape, cursor } = opts.manifest
  const key = snapshotFileKey(game, shape, cursor)
  const auth = { authorization: `Bearer ${opts.token}` }
  const send = async <T>(path: string, init: RequestInit): Promise<T> => {
    const res = await fetchFn(`${base}/api/admin/catalog-snapshot/${path}`, {
      ...init,
      headers: { ...auth, ...(init.headers as Record<string, string> | undefined) }
    })
    if (!res.ok) throw new Error(`Snapshot upload ${path.split('?')[0]} failed (${res.status})`)
    return (await res.json()) as T
  }

  const bytes = (await stat(opts.file)).size
  const hash = createHash('sha256')
  const { uploadId } = await send<{ uploadId: string }>(`upload?key=${encodeURIComponent(key)}`, {
    method: 'POST'
  })
  const parts: { partNumber: number; etag: string }[] = []
  const fh = await open(opts.file)
  try {
    for (let at = 0, n = 1; at < bytes; at += partBytes, n++) {
      const chunk = new Uint8Array(Math.min(partBytes, bytes - at))
      await fh.read(chunk, 0, chunk.byteLength, at)
      hash.update(chunk)
      const { etag } = await send<{ etag: string }>(
        `upload?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&part=${n}`,
        { method: 'PUT', body: chunk }
      )
      parts.push({ partNumber: n, etag })
    }
  } finally {
    await fh.close()
  }
  await send(`complete?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parts })
  })
  const manifest: SnapshotManifest = { ...opts.manifest, key, bytes, sha256: hash.digest('hex') }
  await send('manifest', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(manifest)
  })
  return manifest
}
