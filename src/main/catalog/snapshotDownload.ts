import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'
import type { SnapshotOffer } from '../../shared/catalogSnapshot'
import type { CloudClient } from '../cloud/client'

const size = (file: string): Promise<number> =>
  fs.stat(file).then(
    (s) => s.size,
    () => 0
  )

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Fetches what `part` is missing of the offer, with a Range request when it has a start. */
async function fetchRest(
  client: Pick<CloudClient, 'download'>,
  offer: SnapshotOffer,
  part: string
): Promise<void> {
  let have = await size(part)
  if (have > offer.bytes) {
    await fs.rm(part, { force: true })
    have = 0
  }
  if (have === offer.bytes) return
  const res = await client.download!(
    offer.url,
    have > 0 ? { headers: { range: `bytes=${have}-` } } : undefined
  )
  if ((res.status !== 200 && res.status !== 206) || !res.body)
    throw new Error(`Snapshot download failed (${res.status})`)
  // A 200 to a Range request is the whole file again.
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream),
    createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' })
  )
}

/**
 * Downloads an offered snapshot into `dir` and unpacks it; resolves to the unpacked SQLite file.
 * A `.part` left by a cut-off download is carried on with a Range request. The file must match the
 * offer's size and sha256, or it is deleted and this throws. A download cut off or refused is
 * tried `attempts` times in all (carrying on from what landed), then its `.part` is deleted and
 * this throws. Other files of the game in `dir`
 * (older snapshots) are deleted first.
 */
export async function downloadSnapshot(
  client: Pick<CloudClient, 'download'>,
  offer: SnapshotOffer,
  dir: string,
  opts: { attempts?: number; retryDelayMs?: number } = {}
): Promise<string> {
  if (!client.download) throw new Error('This client cannot download snapshots')
  await fs.mkdir(dir, { recursive: true })
  const name = `${offer.game}-${offer.cursor}.sqlite`
  const part = join(dir, `${name}.gz.part`)
  const out = join(dir, name)
  for (const f of await fs.readdir(dir))
    if (f.startsWith(`${offer.game}-`) && f !== `${name}.gz.part`)
      await fs.rm(join(dir, f), { force: true })

  const attempts = opts.attempts ?? 3
  for (let i = 1; ; i++) {
    try {
      await fetchRest(client, offer, part)
      break
    } catch (e) {
      // Cut off or refused: carry on from what landed, a few times, then give up cleanly.
      if (i >= attempts) {
        await fs.rm(part, { force: true })
        throw e
      }
      await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 2000) * i))
    }
  }
  if ((await size(part)) !== offer.bytes || (await sha256(part)) !== offer.sha256) {
    await fs.rm(part, { force: true })
    throw new Error("Snapshot download didn't match")
  }
  try {
    await pipeline(createReadStream(part), createGunzip(), createWriteStream(out))
  } catch (e) {
    await fs.rm(out, { force: true })
    throw e
  } finally {
    await fs.rm(part, { force: true })
  }
  return out
}
