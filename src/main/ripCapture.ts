import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RipFrameInfo } from '@shared/admin'

/** A capture session's folder name: its local start time, `20261109-081500`. */
export const RIP_SESSION = /^\d{8}-\d{6}$/
/** A key frame's file name in its session: `k00001.jpg`. */
export const RIP_FRAME = /^k\d{5}\.jpg$/
/** A 4K JPEG at high quality is a few MB; anything far past that isn't a frame. */
const MAX_BYTES = 40 * 1024 * 1024
const MAX_NOTE = 4000

export interface RipCapture {
  /** Saves a key frame and a line for it in the session's keyframes.jsonl; returns its path. */
  save(session: string, name: string, jpeg: ArrayBuffer, info: RipFrameInfo): Promise<string>
  remove(session: string, name: string): Promise<void>
  /** The owner's note on a session (what's in it, why it's worth a look) as note.txt; '' clears it. */
  note(session: string, text: string): Promise<void>
  /** Opens the session's folder (or the capture folder with none) in the file manager. */
  openFolder(session: string | null): Promise<void>
}

function check(session: unknown, name?: unknown): void {
  if (typeof session !== 'string' || !RIP_SESSION.test(session)) throw new Error('Bad session')
  if (name !== undefined && (typeof name !== 'string' || !RIP_FRAME.test(name)))
    throw new Error('Bad frame name')
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * The admin Rip capture tab's disk side: key frames picked from a live pack opening, kept as
 * JPEGs under `dir/<session>/` for scanner work. Names are checked, so the renderer can only
 * write `k#####.jpg` files in a session folder.
 */
export function createRipCapture(
  dir: string,
  openPath: (path: string) => Promise<string>
): RipCapture {
  return {
    async save(session, name, jpeg, info) {
      check(session, name)
      if (!(jpeg instanceof ArrayBuffer) || jpeg.byteLength === 0 || jpeg.byteLength > MAX_BYTES)
        throw new Error('Bad frame')
      const folder = join(dir, session)
      await mkdir(folder, { recursive: true })
      const path = join(folder, name)
      await writeFile(path, new Uint8Array(jpeg))
      const line = {
        file: name,
        t: new Date().toISOString(),
        sharp: Math.round(num(info?.sharp)),
        width: num(info?.width),
        height: num(info?.height)
      }
      await appendFile(join(folder, 'keyframes.jsonl'), JSON.stringify(line) + '\n')
      return path
    },
    async remove(session, name) {
      check(session, name)
      await rm(join(dir, session, name), { force: true })
      await appendFile(
        join(dir, session, 'keyframes.jsonl'),
        JSON.stringify({ removed: name, t: new Date().toISOString() }) + '\n'
      ).catch(() => undefined)
    },
    async note(session, text) {
      check(session)
      if (typeof text !== 'string') throw new Error('Bad note')
      const folder = join(dir, session)
      const path = join(folder, 'note.txt')
      const body = text.trim().slice(0, MAX_NOTE)
      if (!body) return rm(path, { force: true })
      await mkdir(folder, { recursive: true })
      await writeFile(path, body + '\n')
    },
    async openFolder(session) {
      if (session !== null) check(session)
      const folder = session ? join(dir, session) : dir
      await mkdir(folder, { recursive: true })
      const error = await openPath(folder)
      if (error) throw new Error(`Couldn't open the folder: ${error}`)
    }
  }
}
