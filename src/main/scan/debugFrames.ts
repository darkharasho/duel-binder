import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/** Frames kept per app run: about 12 minutes of scanning, and 4 GB at worst. */
const MAX_FRAMES = 800

const runDir = new Date().toISOString().replace(/[:.]/g, '-')
let saved = 0

/**
 * Keeps a live camera frame and its note (one JSON line of index.jsonl) under
 * userData/scan-debug, for replaying a failure the photo tests can't reproduce. Dev builds only:
 * nothing is written by a packaged app, and nothing here leaves the machine.
 */
export async function saveDebugFrame(jpeg: ArrayBuffer, note: string): Promise<void> {
  if (app.isPackaged || saved >= MAX_FRAMES) return
  const n = saved++
  const dir = join(app.getPath('userData'), 'scan-debug', runDir)
  await mkdir(dir, { recursive: true })
  const file = `${String(n).padStart(4, '0')}.jpg`
  await writeFile(join(dir, file), Buffer.from(jpeg))
  await appendFile(join(dir, 'index.jsonl'), `${JSON.stringify({ file, at: Date.now(), note })}\n`)
}
