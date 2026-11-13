import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

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
 * Keeps the newest `maxSessions` folders and at most `maxFrames` JPEGs in each; lines go on past it.
 * Nothing here leaves the machine.
 */
export function createScanTrace({
  root,
  maxSessions = 20,
  maxFrames = 400,
  open: openPath
}: {
  root: string
  maxSessions?: number
  maxFrames?: number
  /** Opens a folder (Electron's `shell.openPath`). */
  open?: (path: string) => Promise<unknown>
}): ScanTraceWriter {
  const frames = new Map<string, number>()
  // Writes run one at a time so lines and frame numbers keep their order.
  let queue: Promise<unknown> = Promise.resolve()

  async function open(session: string): Promise<string> {
    const dir = join(root, session)
    if (frames.has(session)) return dir
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    frames.set(session, files.filter((f) => f.endsWith('.jpg')).length)
    const sessions = (await readdir(root)).filter((f) => TRACE_SESSION.test(f)).sort()
    for (const old of sessions.slice(0, Math.max(0, sessions.length - maxSessions))) {
      await rm(join(root, old), { recursive: true, force: true })
      frames.delete(old)
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
    let frame: string | null = null
    const n = frames.get(session) ?? 0
    if (jpeg && n < maxFrames) {
      frame = `${String(n).padStart(4, '0')}.jpg`
      frames.set(session, n + 1)
      await writeFile(join(dir, frame), Buffer.from(jpeg))
    }
    await appendFile(
      join(dir, 'trace.jsonl'),
      `${JSON.stringify(frame ? { ...line, frame } : line)}\n`
    )
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
