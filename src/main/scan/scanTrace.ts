import { appendFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const MB = 1024 * 1024

/** A scan page session: its ISO start time with `:` and `.` made `-`. */
export const TRACE_SESSION = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

export interface ScanTraceWriter {
  /** `userData/scan-trace`. */
  root: string
  /** Opens the folder in the file manager. */
  openFolder(): Promise<void>
  /** Appends a line to the session's trace.jsonl and keeps the JPEG; returns its file name, or null. */
  write(session: string, line: Record<string, unknown>, jpeg?: ArrayBuffer): Promise<string | null>
}

/**
 * The admin scan trace on disk: one folder per scan page session, `trace.jsonl` plus `NNNN.jpg`.
 * Keeps the newest `maxSessions` folders, and older ones only while all of them stay within
 * `maxTotalBytes`. A session keeps at most `maxFrames` JPEGs (lines go on past it), none over
 * `maxJpegBytes`, and nothing more once it holds `maxSessionBytes`. Nothing here leaves the machine.
 */
export function createScanTrace({
  root,
  maxSessions = 20,
  maxFrames = 400,
  maxJpegBytes = 4 * MB,
  maxSessionBytes = 1024 * MB,
  maxTotalBytes = 2048 * MB,
  open: openPath
}: {
  root: string
  maxSessions?: number
  maxFrames?: number
  maxJpegBytes?: number
  maxSessionBytes?: number
  maxTotalBytes?: number
  /** Opens a folder (Electron's `shell.openPath`). */
  open?: (path: string) => Promise<unknown>
}): ScanTraceWriter {
  const frames = new Map<string, number>()
  const bytes = new Map<string, number>()
  // Writes run one at a time so lines and frame numbers keep their order.
  let queue: Promise<unknown> = Promise.resolve()

  async function open(session: string): Promise<string> {
    const dir = join(root, session)
    if (frames.has(session)) return dir
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    frames.set(session, files.filter((f) => f.endsWith('.jpg')).length)
    bytes.set(session, await sizeOf(dir))
    // Oldest first; the session being opened is never pruned, even if its clock reads earlier.
    const others = (await readdir(root))
      .filter((f) => TRACE_SESSION.test(f) && f !== session)
      .sort()
    const sizes = await Promise.all(others.map((f) => sizeOf(join(root, f))))
    let total = sizes.reduce((a, b) => a + b, bytes.get(session) ?? 0)
    let count = others.length + 1
    for (let i = 0; i < others.length && (count > maxSessions || total > maxTotalBytes); i++) {
      await rm(join(root, others[i]!), { recursive: true, force: true })
      frames.delete(others[i]!)
      bytes.delete(others[i]!)
      total -= sizes[i]!
      count--
    }
    return dir
  }

  async function write(
    session: string,
    line: Record<string, unknown>,
    jpeg?: ArrayBuffer
  ): Promise<string | null> {
    if (!TRACE_SESSION.test(session)) throw new Error('Bad trace session')
    const dir = await open(session)
    const n = frames.get(session) ?? 0
    const used = bytes.get(session) ?? 0
    const keep = !!jpeg && n < maxFrames && jpeg.byteLength <= maxJpegBytes
    const frame = keep ? `${String(n).padStart(4, '0')}.jpg` : null
    const text = `${JSON.stringify(frame ? { ...line, frame } : line)}\n`
    const size = Buffer.byteLength(text) + (keep ? jpeg.byteLength : 0)
    // A full session takes nothing more.
    if (used + size > maxSessionBytes) return null
    bytes.set(session, used + size)
    if (frame) {
      frames.set(session, n + 1)
      await writeFile(join(dir, frame), Buffer.from(jpeg!))
    }
    await appendFile(join(dir, 'trace.jsonl'), text)
    return frame
  }

  return {
    root,
    openFolder: async () => {
      await mkdir(root, { recursive: true })
      await openPath?.(root)
    },
    write: (session, line, jpeg) => {
      const next = queue.then(() => write(session, line, jpeg))
      queue = next.catch(() => undefined)
      return next
    }
  }
}

/** Bytes of the files in a folder (a session's folder has no subfolders). */
async function sizeOf(dir: string): Promise<number> {
  const files = await readdir(dir).catch(() => [] as string[])
  const sizes = await Promise.all(
    files.map((f) =>
      stat(join(dir, f)).then(
        (s) => s.size,
        () => 0
      )
    )
  )
  return sizes.reduce((a, b) => a + b, 0)
}

/** The card name and up to 3 set codes of each image, in the order given; unknown ids left out. */
export function describeArt(
  db: Database.Database,
  imageIds: number[]
): { imageId: number; name: string; sets: string[] }[] {
  const card = db.prepare(
    'SELECT c.id, c.name FROM card_images i JOIN cards c ON c.id = i.card_id WHERE i.image_id = ?'
  )
  const sets = db.prepare(
    'SELECT DISTINCT set_code FROM card_printings WHERE card_id = ? ORDER BY set_code LIMIT 3'
  )
  const out: { imageId: number; name: string; sets: string[] }[] = []
  for (const imageId of imageIds) {
    const c = card.get(imageId) as { id: number; name: string } | undefined
    if (!c) continue
    const codes = (sets.all(c.id) as { set_code: string }[]).map((r) => r.set_code)
    out.push({ imageId, name: c.name, sets: codes })
  }
  return out
}
