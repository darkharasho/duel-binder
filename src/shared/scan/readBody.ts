/**
 * A response's bytes, reporting the share that has arrived as they come. No Content-Length, or
 * one a compressed body doesn't match, reports nothing, and the bytes are still read in full.
 */
export async function readBody(
  res: Response,
  onProgress: (share: number) => void
): Promise<Uint8Array> {
  const total = Number(res.headers.get('Content-Length'))
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (received <= total) onProgress(received / total)
  }
  const bytes = new Uint8Array(received)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}
