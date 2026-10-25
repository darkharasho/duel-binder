import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

/** Dev-only screenshot capture for the marketing site (YGO_CAPTURE_DIR); never runs when packaged. */
export interface Shot {
  file: string
  clicks: string[]
}

export const SHOTS: Shot[] = [
  { file: 'collection.png', clicks: ['Collection'] },
  { file: 'dashboard.png', clicks: ['Dashboard'] },
  { file: 'sets.png', clicks: ['Sets', 'Legend of Blue Eyes White Dragon'] }
]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// A label matches a control's own text or a span inside it (set cards put the name in a span).
const clickScript = (label: string): string => `(() => {
  const want = ${JSON.stringify(label)}
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const el = [...document.querySelectorAll('button, a, [role=button]')]
    .find(
      (e) =>
        visible(e) &&
        [e, ...e.querySelectorAll('span')].some((n) => (n.textContent || '').trim() === want)
    )
  if (!el) return false
  el.click()
  return true
})()`

const IMAGES_DONE = `[...document.images].every((i) => i.complete)`

async function waitForImages(win: Pick<BrowserWindow, 'webContents'>): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if ((await win.webContents.executeJavaScript(IMAGES_DONE)) === true) break
    await sleep(250)
  }
  await sleep(500)
}

/** Runs each shot's clicks, waits for images to load, and saves the window as a PNG in `dir`. */
export async function captureShots(
  win: Pick<BrowserWindow, 'webContents'>,
  dir: string,
  shots: Shot[] = SHOTS
): Promise<string[]> {
  mkdirSync(dir, { recursive: true })
  const written: string[] = []
  for (const shot of shots) {
    for (const label of shot.clicks) {
      const found = await win.webContents.executeJavaScript(clickScript(label))
      if (found !== true) throw new Error(`No button found with the text "${label}"`)
      await sleep(400)
    }
    await waitForImages(win)
    const image = await win.webContents.capturePage()
    const path = join(dir, shot.file)
    writeFileSync(path, image.toPNG())
    written.push(path)
  }
  return written
}
