import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import {
  CARDS_PER_SHEET,
  PLACEHOLDER_STYLES,
  rarityChip,
  type PlaceholderCard,
  type PlaceholderRequest
} from '../shared/placeholders'

/** A big set's art arrives through the image queue; past this the PDF goes without what's left. */
const ART_TIMEOUT_MS = 5 * 60 * 1000

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const CSS = `
@page { size: 8.5in 11in; margin: 0 }
* { box-sizing: border-box; margin: 0 }
body { font: 7pt system-ui, sans-serif; background: #fff }
.sheet { width: 8.5in; height: 11in; display: grid; break-after: page; gap: 0.08in;
  grid-template-columns: repeat(3, 2.5in); grid-template-rows: repeat(3, 3.5in);
  justify-content: center; align-content: center }
.sheet:last-child { break-after: auto }
.pocket { position: relative; overflow: hidden; border-radius: 3mm; background: #e9e9ee }
.pocket canvas, .pocket img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.name { position: absolute; inset: 0 0 0.35in; display: grid; place-items: center; padding: 0.2in;
  text-align: center; font-size: 11pt; color: #3c3c3c }
.rail { position: absolute; inset: auto 0 0; height: 0.35in; display: flex; background: #14151c; color: #fff }
.text { flex: 1; min-width: 0; padding: 0 0.08in; display: flex; flex-direction: column; justify-content: center }
.text div { overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
.set { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase }
.sub { color: #9799a8; font-size: 6pt }
.chip { padding: 0 0.08in; display: grid; place-items: center; font-weight: 700; color: #9799a8;
  border-left: 1px solid #3f4047 }
`

function pocket(card: PlaceholderCard, req: PlaceholderRequest): string {
  const chip = rarityChip(card.rarity)
  const sub = [card.number, card.rarity].filter(Boolean).join(' · ')
  return `<div class="pocket">
<div class="name">${escapeHtml(card.name)}</div>
<img src="ygo-img://full/${card.imageId}" alt="">
<div class="rail"><div class="text"><div class="set">${escapeHtml(req.setName)}</div><div class="sub">${escapeHtml(sub)}</div></div>
<div class="chip"${chip ? ` style="background:${chip.color};color:#14151c"` : ''}>${escapeHtml(chip?.text ?? req.setCode)}</div></div>
</div>`
}

export function placeholderHtml(req: PlaceholderRequest): string {
  const sheets: string[] = []
  for (let i = 0; i < req.cards.length; i += CARDS_PER_SHEET) {
    const pockets = req.cards.slice(i, i + CARDS_PER_SHEET).map((c) => pocket(c, req))
    sheets.push(`<section class="sheet">${pockets.join('')}</section>`)
  }
  return `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${sheets.join('')}`
}

/**
 * Waits for the art, and paints it through a canvas when it's drained: a CSS filter would print as
 * a low resolution bitmap. A card with no art keeps its name, so the pocket still says what goes there.
 */
const settleArt = (saturation: number, timeoutMs: number): string => `(async () => {
  const load = (img) => img.complete ? Promise.resolve() : new Promise((done) => {
    img.onload = img.onerror = done
  })
  const images = [...document.images]
  await Promise.race([
    Promise.all(images.map(load)),
    new Promise((done) => setTimeout(done, ${timeoutMs}))
  ])
  for (const img of images) {
    if (!img.naturalWidth) { img.remove(); continue }
    if (${saturation} === 1) continue
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.filter = 'saturate(${saturation})'
    ctx.drawImage(img, 0, 0)
    img.replaceWith(canvas)
  }
})()`

/** Renders the sheets off screen. The caller owns the file name. */
export async function renderPlaceholderPdf(req: PlaceholderRequest): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'duel-binder-placeholders-'))
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    const page = join(dir, 'sheets.html')
    await writeFile(page, placeholderHtml(req), 'utf8')
    await win.loadFile(page)
    const { saturation } = PLACEHOLDER_STYLES[req.style]
    await win.webContents.executeJavaScript(settleArt(saturation, ART_TIMEOUT_MS))
    return await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  } finally {
    win.destroy()
    await rm(dir, { recursive: true, force: true })
  }
}

/** Asks where to save, then writes the PDF. Null when the dialog is cancelled. */
export async function savePlaceholders(req: PlaceholderRequest): Promise<string | null> {
  const name = req.setName.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${name} placeholders.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return null
  await writeFile(filePath, await renderPlaceholderPdf(req))
  return filePath
}
